import { and, asc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { availabilityBlocks, availabilityRules, locaisAtendimento, tenants, type LocalRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { normalizarTexto } from '@/lib/text';
import { idValido } from '@/modules/pacientes/base';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { DURACAO_MAX, DURACAO_MIN, MAX_REGRAS, MSG_AGENDA } from './constantes';
import { dataDaAgendaValida, inicioDoDia, paraInstante, somarDias } from './fuso';
import { HORA_HHMM, minutosDe, regraNoLocal, textoAparado, type Intervalo, type LocalDaGeracao, type ModalidadeRegra, type Regra } from './horarios';
import { garantirLocaisIniciais, locaisAtivos, locaisDoSeletor, type LocalDoSeletor } from './locais';

export type RegraSalva = Regra & { id: string };
export type BloqueioSalvo = Intervalo & { id: string; motivo: string };

export class DisponibilidadeError extends Error {
  override name = 'DisponibilidadeError';
  constructor(readonly erros: Record<string, string>) {
    super('Disponibilidade inválida');
  }
}

type Deps = { db?: Db; now?: Date };
const BLOQUEIO_MAX_MS = 366 * 86_400_000;

/** Regras do tenant, na transação já com o contexto: tela, aviso "fora do horário" e horários livres. */
export async function lerRegras(tx: Tx): Promise<RegraSalva[]> {
  const rs = await tx.select().from(availabilityRules).orderBy(asc(availabilityRules.diaSemana), asc(availabilityRules.inicio));
  return rs.map((r) => ({ id: r.id, diaSemana: r.diaSemana, inicio: r.inicio.slice(0, 5), fim: r.fim.slice(0, 5), duracaoMin: r.duracaoMin, modalidade: r.modalidade as ModalidadeRegra, localId: r.localId }));
}

/** Os locais ativos no formato da geração de horários (sessão `nutri`; a ordem de `locaisAtivos`). */
export const paraGeracao = (ls: Pick<LocalRow, 'id' | 'tipo' | 'principal' | 'agendamentoOnline'>[]): LocalDaGeracao[] =>
  ls.map((l) => ({ id: l.id, tipo: l.tipo as LocalDaGeracao['tipo'], principal: l.principal, agendamentoOnline: l.agendamentoOnline }));

const exigirNutri = (ctx: TenantContext) => {
  if (ctx.role !== 'nutri') throw new Error('agenda: só a sessão nutri'); // RN-400, antes de abrir a transação
};

/** AG-D45: os locais iniciais e o local das regras antigas, antes da trava `agenda-regras` (ordem `agenda-locais` → `agenda-regras`). */
async function garantirNoTenant(tx: Tx, tenantId: string): Promise<void> {
  const [t] = await tx.select({ id: tenants.id, enderecoConsultorio: tenants.enderecoConsultorio }).from(tenants).where(eq(tenants.id, tenantId));
  if (t) await garantirLocaisIniciais(tx, t);
}

/** Bloqueios que tocam [de, ate). */
export async function lerBloqueios(tx: Tx, de: Date, ate: Date): Promise<BloqueioSalvo[]> {
  const bs = await tx.select().from(availabilityBlocks).where(and(lt(availabilityBlocks.inicio, ate), gt(availabilityBlocks.fim, de))).orderBy(asc(availabilityBlocks.inicio));
  return bs.map((b) => ({ id: b.id, inicio: b.inicio, fim: b.fim, motivo: b.motivo }));
}

/**
 * Tela "Horários de atendimento". Plano 23 (AG-D45, RN-410a): antes de ler, garante os locais e dá local às regras sem local;
 * a tela agrupa as regras por local (`locais`: os ativos, o principal primeiro). AG-D47: o par "ambas" desdobrado pelo
 * backfill aparece como duas regras, cada uma no seu local, e cada uma se exclui sozinha.
 */
export function listarHorarios(ctx: TenantContext, db: Db = getDb()): Promise<{ regras: RegraSalva[]; locais: LocalDoSeletor[] }> {
  exigirNutri(ctx);
  return withTenant(
    ctx,
    async (tx) => {
      await garantirNoTenant(tx, ctx.tenantId);
      return { regras: await lerRegras(tx), locais: await locaisDoSeletor(tx) };
    },
    db,
  );
}

/** As regras da tela, sem os locais (mesmas garantias de `listarHorarios`). */
export async function listarRegras(ctx: TenantContext, db: Db = getDb()): Promise<RegraSalva[]> {
  return (await listarHorarios(ctx, db)).regras;
}

export function listarBloqueios(ctx: TenantContext, de: Date, ate: Date, db: Db = getDb()): Promise<BloqueioSalvo[]> {
  return withTenant(ctx, (tx) => lerBloqueios(tx, de, ate), db);
}

/**
 * US-030 "Regra inválida" e demais limites; dia e números chegam como texto do formulário. Plano 23 (RN-410): `local` é o
 * local ativo do consultório escolhido no formulário (lido por quem chama, na transação), ou nulo → "Escolha o local."; a
 * modalidade da regra é o tipo do local (o campo `modalidade` do formulário antigo é ignorado).
 */
export function validarRegra(input: Record<string, unknown>, local: Pick<LocalRow, 'id' | 'tipo'> | null | undefined): Regra & { localId: string } {
  const erros: Record<string, string> = {};
  const dia = String(input.diaSemana ?? '');
  if (!/^[0-6]$/.test(dia)) erros.diaSemana = MSG_AGENDA.diaSemana;
  const inicio = textoAparado(input.inicio);
  const fim = textoAparado(input.fim);
  if (!HORA_HHMM.test(inicio)) erros.inicio = MSG_AGENDA.horaInvalida;
  if (!HORA_HHMM.test(fim)) erros.fim = MSG_AGENDA.horaInvalida;
  else if (HORA_HHMM.test(inicio) && minutosDe(fim) <= minutosDe(inicio)) erros.fim = MSG_AGENDA.fimAntesDoInicio;
  const duracao = Number(textoAparado(String(input.duracaoMin ?? '')));
  if (!Number.isInteger(duracao) || duracao < DURACAO_MIN || duracao > DURACAO_MAX) erros.duracaoMin = MSG_AGENDA.duracao;
  else if (!erros.inicio && !erros.fim && minutosDe(fim) - minutosDe(inicio) < duracao) erros.duracaoMin = MSG_AGENDA.naoCabe;
  if (!local) erros.localId = MSG_AGENDA.escolhaOLocal;
  if (Object.keys(erros).length || !local) throw new DisponibilidadeError(erros);
  return { diaSemana: Number(dia), inicio, fim, duracaoMin: duracao, modalidade: local.tipo as ModalidadeRegra, localId: local.id };
}

const marcado = (v: unknown) => v === 'on' || v === true;

/** Local ativo do consultório da sessão (a RLS esconde o de outro), ou nulo. */
async function localAtivo(tx: Tx, id: unknown): Promise<LocalRow | null> {
  if (!idValido(id)) return null;
  const [l] = await tx.select().from(locaisAtendimento).where(and(eq(locaisAtendimento.id, id), isNull(locaisAtendimento.arquivadoEm))).for('share');
  return l ?? null;
}

/**
 * Cria a regra no local escolhido (RN-410). Com "Também atender por videoconferência nestes horários" (`tambemOnline`) numa
 * regra presencial e com um local online ativo, cria também a regra-par no primeiro online ativo (o principal, se for online,
 * senão o mais antigo), na mesma transação: se a segunda não puder entrar, nenhuma fica. Sem local online ativo, a marca é
 * ignorada (a tela só a mostra com um). Teto de MAX_REGRAS regras por consultório (cada metade do par conta; o legado acima
 * do teto continua). A sobreposição é conferida por local (RN-408: a agenda é uma só, mas um horário de atendimento em dois
 * locais é o antigo "ambas"). Devolve os ids criados (a presencial primeiro).
 */
export async function criarRegra(ctx: TenantContext, input: Record<string, unknown>, deps: Deps = {}): Promise<string[]> {
  exigirNutri(ctx);
  const now = deps.now ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      // ordem global das travas: agenda-locais (garantirLocaisIniciais) → agenda-regras; invertida, dá deadlock com ela
      await garantirNoTenant(tx, ctx.tenantId);
      // Uma gravação de regra por vez no tenant: a checagem de sobreposição não pode correr com outra
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('agenda-regras'), hashtext(${ctx.tenantId}))`);
      const r = validarRegra(input, await localAtivo(tx, input.localId));
      const locais = paraGeracao(await locaisAtivos(tx));
      const par = r.modalidade === 'presencial' && marcado(input.tambemOnline) ? (locais.find((l) => l.tipo === 'online' && l.principal) ?? locais.find((l) => l.tipo === 'online')) : undefined;
      const novas: Regra[] = [r, ...(par ? [{ ...r, modalidade: 'online' as const, localId: par.id }] : [])];
      const atuais = await lerRegras(tx);
      if (atuais.length + novas.length > MAX_REGRAS) throw new DisponibilidadeError({ geral: MSG_AGENDA.limiteRegras });
      const choca = (n: Regra) =>
        atuais.some(
          (x) => x.diaSemana === n.diaSemana && minutosDe(x.inicio) < minutosDe(n.fim) && minutosDe(n.inicio) < minutosDe(x.fim) && regraNoLocal(x, locais).some((d) => d.localId === n.localId),
        );
      if (novas.some(choca)) throw new DisponibilidadeError({ inicio: MSG_AGENDA.sobreposicao });
      const ids: string[] = [];
      for (const n of novas) {
        const [g] = await tx.insert(availabilityRules).values({ tenantId: ctx.tenantId, ...n, createdAt: now, updatedAt: now }).returning({ id: availabilityRules.id });
        ids.push(g.id);
      }
      return ids;
    },
    deps.db ?? getDb(),
  );
}

/** Exclui a regra. Plano 23 (AG-D47): com locais, as metades do par desdobrado são regras independentes, cada uma no seu local. */
export async function excluirRegra(ctx: TenantContext, id: string, db: Db = getDb()): Promise<void> {
  exigirNutri(ctx);
  if (!idValido(id)) return;
  await withTenant(
    ctx,
    async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('agenda-regras'), hashtext(${ctx.tenantId}))`);
      await tx.delete(availabilityRules).where(eq(availabilityRules.id, id));
    },
    db,
  );
}

/**
 * Sem hora: dias inteiros no fuso do tenant (00:00 do primeiro dia até 00:00 do dia seguinte ao último).
 * Com hora: o intervalo exato. Hora que não existe no dia (horário de verão) é recusada (D8).
 */
export async function criarBloqueio(ctx: TenantContext, tenant: { fuso: string }, input: Record<string, unknown>, deps: Deps = {}): Promise<string> {
  const erros: Record<string, string> = {};
  const dataInicio = textoAparado(input.dataInicio);
  const dataFimInformada = textoAparado(input.dataFim);
  const dataFim = dataFimInformada || dataInicio;
  const horaInicio = textoAparado(input.horaInicio);
  const horaFim = textoAparado(input.horaFim);
  const motivo = normalizarTexto(input.motivo);
  const now = deps.now ?? new Date();
  const hoje = hojeNoFuso(tenant.fuso, now);
  if (!dataDaAgendaValida(dataInicio, hoje)) erros.dataInicio = MSG_AGENDA.dataInvalida;
  if (dataFimInformada && !dataDaAgendaValida(dataFimInformada, hoje)) erros.dataFim = MSG_AGENDA.dataInvalida;
  if (horaInicio && !HORA_HHMM.test(horaInicio)) erros.horaInicio = MSG_AGENDA.horaInvalida;
  if (horaFim && !HORA_HHMM.test(horaFim)) erros.horaFim = MSG_AGENDA.horaInvalida;
  if (motivo.length > 120) erros.motivo = MSG_AGENDA.motivoLongo;
  let inicio: Date | null = null;
  let fim: Date | null = null;
  if (!erros.dataInicio && !erros.dataFim && !erros.horaInicio && !erros.horaFim) {
    inicio = horaInicio ? paraInstante(dataInicio, horaInicio, tenant.fuso) : inicioDoDia(dataInicio, tenant.fuso);
    fim = horaFim ? paraInstante(dataFim, horaFim, tenant.fuso) : inicioDoDia(somarDias(dataFim, 1), tenant.fuso);
    if (!inicio) erros.horaInicio = MSG_AGENDA.horaInexistente;
    if (!fim) erros.horaFim = MSG_AGENDA.horaInexistente;
    // revisão final: data final antes da inicial é erro da data; com as datas em ordem (mesmo dia), é a hora de fim
    if (inicio && fim && fim.getTime() <= inicio.getTime()) {
      if (dataFim < dataInicio) erros.dataFim = MSG_AGENDA.dataFinalAntes;
      else erros.horaFim = MSG_AGENDA.fimAntesDoInicio;
    } else if (inicio && fim && fim.getTime() - inicio.getTime() > BLOQUEIO_MAX_MS) erros.dataFim = MSG_AGENDA.bloqueioLongo;
  }
  if (Object.keys(erros).length) throw new DisponibilidadeError(erros);
  return withTenant(
    ctx,
    async (tx) => {
      const [b] = await tx.insert(availabilityBlocks).values({ tenantId: ctx.tenantId, inicio: inicio!, fim: fim!, motivo, createdAt: now }).returning({ id: availabilityBlocks.id });
      return b.id;
    },
    deps.db ?? getDb(),
  );
}

export async function excluirBloqueio(ctx: TenantContext, id: string, db: Db = getDb()): Promise<void> {
  if (!idValido(id)) return;
  await withTenant(ctx, (tx) => tx.delete(availabilityBlocks).where(eq(availabilityBlocks.id, id)), db);
}
