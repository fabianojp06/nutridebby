import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { appointments, consultations, locaisAtendimento, patients, type TipoDeLocal } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { diaDoAniversario, lerVisao, periodoDaVisao, type Visao } from './calendario';
import { listarConsultasNaTransacao, STATUS_ATIVOS, type Consulta, type TenantAgenda } from './consultas';
import { lerBloqueios, lerRegras, type BloqueioSalvo, type RegraSalva } from './disponibilidade';
import { dataDaAgendaOuHoje, inicioDoDia, partesNoFuso, somarDias } from './fuso';
import { sobrepoe } from './horarios';
import { garantirLocaisIniciais } from './locais';
import { previsoesDeRetorno } from './retorno';
import { SELO_PRESENCA_A_REGISTRAR, selosDaConsulta, sqlEhRetorno } from './status';

/**
 * Plano 23 (US-404, US-405, RN-411 a RN-417): as visões da agenda do painel. Uma transação por tela, que começa por
 * `garantirLocaisIniciais`; consultas, bloqueios, regras, "Retorno" e marcadores em consultas por período (nunca por item,
 * RNF-400); nenhuma leitura auditada (RN-414, AG-D30: nome, hora, local, situação e selos, como a lista de pacientes, P05
 * D10). Só a sessão da nutricionista (RN-400).
 */

/**
 * AG-D73: o filtro "Previsões de retorno" e o item "Retorno previsto" da legenda. No PR 2 não havia onde preencher a
 * previsão; a T9 (campo no atendimento, `retorno.ts`) ligou.
 */
export const MARCADOR_RETORNO_LIGADO = true;

/** AG-D72: o pedido `solicitada` existe a partir da T6/T8; a T8 ligou esta marca (o rótulo "Pedido a responder" da legenda). */
export const PEDIDOS_NA_AGENDA = true;

/** Teto de consultas de uma tela (a Lista do paciente cobre 12 meses; o Mês de um consultório cheio, ~200). */
const LIMITE_DE_CONSULTAS = 5000;
const DIA_MS = 86_400_000;

export type FiltrosDaAgenda = { visao: Visao; data: string; local?: string; paciente?: string; horas24: boolean; retorno: boolean; aniversario: boolean };

const primeiro = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/**
 * Os filtros da URL (§4.1). Aceita `string | string[]` (o `searchParams` do Next; vale o primeiro). A data passa por
 * `dataDaAgendaOuHoje` (teto hoje + 5 anos); local e paciente só se forem uuid — outro valor é ignorado, nunca vira 500.
 */
export function lerFiltros(sp: Record<string, string | string[] | undefined>, hoje: string): FiltrosDaAgenda {
  const local = primeiro(sp.local);
  const paciente = primeiro(sp.paciente);
  return {
    visao: lerVisao(primeiro(sp.visao)),
    data: dataDaAgendaOuHoje(primeiro(sp.data), hoje),
    ...(idValido(local) ? { local } : {}),
    ...(idValido(paciente) ? { paciente } : {}),
    horas24: primeiro(sp.horas) === '24',
    retorno: primeiro(sp.retorno) === '1',
    aniversario: primeiro(sp.aniversario) === '1',
  };
}

/**
 * I-05: a única função que monta os links da agenda (visões, Hoje, Anterior, Próximo, dia do Mês, Limpar filtros e a
 * impressão), sempre na mesma ordem de parâmetros; só leva o que está ligado.
 */
export function hrefDaAgenda(f: Partial<FiltrosDaAgenda>, base: '/painel/agenda' | '/painel/agenda/imprimir' = '/painel/agenda'): string {
  const q = new URLSearchParams();
  if (f.visao) q.set('visao', f.visao);
  if (f.data) q.set('data', f.data);
  if (f.local) q.set('local', f.local);
  if (f.paciente) q.set('paciente', f.paciente);
  if (f.horas24) q.set('horas', '24');
  if (f.retorno) q.set('retorno', '1');
  if (f.aniversario) q.set('aniversario', '1');
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export type TipoConsulta = 'primeira' | 'retorno';
export type ItemDaAgenda = Consulta & { tipoConsulta: TipoConsulta; selos: string[]; local: { nome: string; tipo: TipoDeLocal } | null };
export type Marcador = { patientId: string; nome: string; data: string };
export type AgendaDoPeriodo = {
  itens: ItemDaAgenda[];
  bloqueios: BloqueioSalvo[];
  retornos: Marcador[];
  aniversarios: Marcador[];
  regras: RegraSalva[];
  /** Os dias da visão e os vizinhos ("Anterior", "Próximo"), de `periodoDaVisao`. */
  periodo: ReturnType<typeof periodoDaVisao>;
  /** Opções dos filtros, na mesma transação: os locais ativos (e o filtrado, se arquivado) e os pacientes ativos (e o filtrado). */
  opcoes: { locais: { id: string; nome: string; tipo: TipoDeLocal }[]; pacientes: { id: string; nome: string }[] };
};

/**
 * RN-416 por consulta (a T6 usa em `primeiraOnline`, a T8 no aviso do TCLE): uma consulta só, com o critério de
 * `sqlEhRetorno`. Ids de outro consultório não voltam (RLS).
 */
export async function tiposDasConsultas(tx: Tx, ids: string[]): Promise<Map<string, TipoConsulta>> {
  const validos = ids.filter(idValido);
  if (!validos.length) return new Map();
  const rs = await tx
    .select({ id: appointments.id, retorno: sqlEhRetorno(appointments, consultations).mapWith(Boolean) })
    .from(appointments)
    .where(inArray(appointments.id, validos));
  return new Map(rs.map((r) => [r.id, r.retorno ? 'retorno' : 'primeira']));
}

/**
 * RN-416 por período: o primeiro início das realizadas e a primeira data dos atendimentos de cada paciente da tela, numa
 * consulta. "Retorno" = realizada que começou antes desta ou atendimento com data anterior ao dia desta (no fuso).
 */
async function primeirosPorPaciente(tx: Tx, ids: string[]): Promise<Map<string, { realizada: Date | null; atendimento: string | null }>> {
  if (!ids.length) return new Map();
  const r = await tx.execute<{ id: string; realizada: Date | string | null; atendimento: string | null }>(sql`
    select p.id,
      (select min(a.inicio) from ${appointments} a where a.tenant_id = p.tenant_id and a.patient_id = p.id and a.status = 'realizada') as realizada,
      (select min(c.data)::text from ${consultations} c where c.tenant_id = p.tenant_id and c.patient_id = p.id) as atendimento
    from ${patients} p
    where p.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
  return new Map(r.rows.map((x) => [x.id, { realizada: x.realizada ? new Date(x.realizada) : null, atendimento: x.atendimento }]));
}

const bissexto = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;

/**
 * RN-414: "Aniversário" dos dias da visão — paciente ativo, não anonimizado, com data de nascimento, pelo dia e mês (29/02
 * cai em 28/02 no ano não bissexto); só o id, o nome de registro e o dia. Uma consulta por tela; não depende da
 * autorização de mensagens.
 */
async function aniversariosDoPeriodo(tx: Tx, dias: string[], paciente: string | undefined): Promise<Marcador[]> {
  const chaves = new Set<string>();
  for (const d of dias) {
    chaves.add(d.slice(5));
    if (d.slice(5) === '02-28' && !bissexto(Number(d.slice(0, 4)))) chaves.add('02-29');
  }
  if (!chaves.size) return [];
  const rs = await tx
    .select({ id: patients.id, nome: patients.nome, nascimento: patients.dataNascimento })
    .from(patients)
    .where(
      and(
        eq(patients.status, 'ativo'),
        isNull(patients.anonimizadoEm),
        sql`${patients.dataNascimento} is not null`,
        sql`to_char(${patients.dataNascimento}, 'MM-DD') in (${sql.join([...chaves].map((c) => sql`${c}`), sql`, `)})`,
        paciente ? eq(patients.id, paciente) : undefined,
      ),
    )
    .orderBy(asc(patients.nome));
  const noPeriodo = new Set(dias);
  const anos = [...new Set(dias.map((d) => Number(d.slice(0, 4))))];
  return rs
    .flatMap((p) => anos.map((ano) => diaDoAniversario(p.nascimento!, ano)).filter((d) => noPeriodo.has(d)).map((data) => ({ patientId: p.id, nome: p.nome, data })))
    .sort((a, b) => a.data.localeCompare(b.data) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** As opções dos filtros "Local" e "Paciente" (sem leitura auditada: só id e nome, como a lista de pacientes). */
async function opcoesDosFiltros(tx: Tx, f: FiltrosDaAgenda): Promise<AgendaDoPeriodo['opcoes']> {
  const locais = await tx
    .select({ id: locaisAtendimento.id, nome: locaisAtendimento.nome, tipo: locaisAtendimento.tipo })
    .from(locaisAtendimento)
    .where(f.local ? or(isNull(locaisAtendimento.arquivadoEm), eq(locaisAtendimento.id, f.local)) : isNull(locaisAtendimento.arquivadoEm))
    .orderBy(desc(locaisAtendimento.principal), asc(locaisAtendimento.createdAt), asc(locaisAtendimento.id));
  const ativos = and(eq(patients.status, 'ativo'), isNull(patients.anonimizadoEm));
  const pacientes = await tx
    .select({ id: patients.id, nome: patients.nome })
    .from(patients)
    .where(f.paciente ? or(ativos, and(eq(patients.id, f.paciente), isNull(patients.anonimizadoEm))) : ativos)
    .orderBy(asc(patients.nome), asc(patients.id));
  return { locais: locais.map((l) => ({ ...l, tipo: l.tipo as TipoDeLocal })), pacientes };
}

/** RN-413: canceladas fora da grade (Dia, Semana e Mês); só a Lista as mostra. */
const naGrade = (c: Pick<Consulta, 'status'>) => c.status !== 'cancelada';

/** RN-417: a mesma regra de `pendenciasDePresenca` (US-037): agendada ou confirmada que terminou há mais de 24 h. */
const presencaARegistrar = (c: Pick<Consulta, 'status' | 'fim'>, agora: Date) => STATUS_ATIVOS.includes(c.status) && c.fim.getTime() < agora.getTime() - DIA_MS;

/** `agendaDoPeriodo` numa transação já aberta (a impressão lê e grava o `exportar` na mesma, RN-419). Sessão `nutri`. */
export async function agendaDoPeriodoNaTransacao(tx: Tx, tenant: Pick<TenantAgenda, 'id' | 'fuso' | 'enderecoConsultorio'>, f: FiltrosDaAgenda, agora: Date): Promise<AgendaDoPeriodo> {
  await garantirLocaisIniciais(tx, tenant); // AG-D45: o consultório criado depois da migration ganha o "Consultório"
  const hoje = hojeNoFuso(tenant.fuso, agora);
  const periodo = periodoDaVisao(f.visao, f.data, { comPaciente: !!f.paciente, hoje });
  const de = inicioDoDia(periodo.de, tenant.fuso);
  const ate = inicioDoDia(somarDias(periodo.ate, 1), tenant.fuso);
  const filtros: (SQL | undefined)[] = [
    lt(appointments.inicio, ate),
    gt(appointments.fim, de),
    f.local ? eq(appointments.localId, f.local) : undefined,
    f.paciente ? eq(appointments.patientId, f.paciente) : undefined,
  ];
  const lidas = await listarConsultasNaTransacao(tx, and(...filtros), { ordem: 'asc', limite: LIMITE_DE_CONSULTAS, comLocal: true });
  const consultas = f.visao === 'lista' ? lidas : lidas.filter(naGrade);
  const bloqueios = await lerBloqueios(tx, de, ate);
  const regras = (await lerRegras(tx)).filter((r) => !f.local || r.localId === f.local || r.localId === null);
  const primeiros = await primeirosPorPaciente(tx, [...new Set(consultas.map((c) => c.patientId))]);
  const itens: ItemDaAgenda[] = consultas.map((c) => {
    const p = primeiros.get(c.patientId);
    const dia = partesNoFuso(c.inicio, tenant.fuso).data;
    const retorno = (!!p?.realizada && p.realizada.getTime() < c.inicio.getTime()) || (!!p?.atendimento && p.atendimento < dia);
    const selos = selosDaConsulta(c, bloqueios.some((b) => sobrepoe(b, c)));
    if (presencaARegistrar(c, agora)) selos.push(SELO_PRESENCA_A_REGISTRAR);
    return { ...c, tipoConsulta: retorno ? 'retorno' : 'primeira', selos };
  });
  const aniversarios = f.aniversario && f.visao !== 'lista' ? await aniversariosDoPeriodo(tx, periodo.dias, f.paciente) : [];
  // RN-430: o marcador vale nos dias da visão (fora da Lista), para qualquer local — a previsão não tem local
  const retornos = MARCADOR_RETORNO_LIGADO && f.retorno && f.visao !== 'lista' ? await previsoesDeRetorno(tx, periodo.de, periodo.ate, { patientId: f.paciente }, agora) : [];
  return { itens, bloqueios, retornos, aniversarios, regras, periodo, opcoes: await opcoesDosFiltros(tx, f) };
}

/**
 * A agenda de uma visão (US-404, US-405). Marcadores só quando ligados, fora da Lista: "Aniversário" e "Retorno previsto"
 * (`previsoesDeRetorno`, RN-430). Sem `auditRead` (AG-D30), inclusive com o filtro de paciente.
 */
export async function agendaDoPeriodo(ctx: TenantContext, tenant: Pick<TenantAgenda, 'id' | 'fuso' | 'enderecoConsultorio'>, f: FiltrosDaAgenda, deps: { db?: Db; agora?: Date } = {}): Promise<AgendaDoPeriodo> {
  if (ctx.role !== 'nutri') throw new Error('agenda: só a sessão nutri'); // RN-400, antes de abrir a transação
  return withTenant(ctx, (tx) => agendaDoPeriodoNaTransacao(tx, tenant, f, deps.agora ?? new Date()), deps.db ?? getDb());
}
