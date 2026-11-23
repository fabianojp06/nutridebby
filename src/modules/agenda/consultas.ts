import { and, asc, desc, eq, gt, isNull, lt, ne, sql, type SQL } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { deadlockDetectado, exclusionViolation } from '@/db/errors';
import { appointments, locaisAtendimento, patients, type AppointmentRow, type LocalRow, type TenantRow, type TipoDeLocal } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { agendarLembretes, avisarPaciente, dispararEnvio } from '@/modules/notificacoes/agendar';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { DURACAO_MAX, DURACAO_MIN, MSG_AGENDA } from './constantes';
import { lerBloqueios, lerRegras, paraGeracao } from './disponibilidade';
import { dataDaAgendaValida, paraInstante, partesNoFuso } from './fuso';
import { dentroDoHorario, gerarHorarios, HORA_HHMM, regraNoLocal, sobrepoe, textoAparado, type Horario, type Intervalo, type LocalDaGeracao, type Modalidade } from './horarios';
import { linkSugerido, locaisAtivos, locaisParaAgendamento } from './locais';

export type StatusConsulta = 'agendada' | 'confirmada' | 'cancelada' | 'realizada' | 'faltou';
export type AvisoAgenda = 'fora_do_horario' | 'dentro_de_bloqueio';
export type TenantAgenda = Pick<TenantRow, 'id' | 'fuso' | 'nomeExibicao' | 'enderecoConsultorio' | 'antecedenciaMinH' | 'cancelamentoMinH' | 'status' | 'agendamentoPublicoAtivo'>;
export type Consulta = {
  id: string;
  patientId: string;
  paciente: string;
  /** US-032: paciente que veio da página pública e ainda não teve o cadastro completado. */
  pacienteNovoPublico: boolean;
  inicio: Date;
  fim: Date;
  modalidade: Modalidade;
  linkOnline: string | null;
  status: StatusConsulta;
  origem: 'nutri' | 'paciente';
  confirmadaVia: 'whatsapp' | 'link' | null;
  /** 'sistema': cancelada sozinha ao atender o pedido de exclusão (US-018, fechamento do Plano 05). */
  canceladoPor: 'nutri' | 'paciente' | 'sistema' | null;
  pedidoRemarcacaoEm: Date | null;
  remarcadaDe: string | null;
  /** Plano 23 (RN-407): nulo só na consulta anterior ao Plano 23 (o detalhe mostra "Consultório (endereço do perfil)"). */
  localId: string | null;
  /**
   * Nome e tipo do local, só nas leituras da equipe (`listarAgenda`, `buscarConsulta`/`listarConsultas` na sessão `nutri`);
   * nas outras, nulo: o portal e o link leem o local pela projeção `app_local_da_consulta` (RN-406), nunca pela tabela.
   */
  local: { nome: string; tipo: TipoDeLocal } | null;
};
/**
 * Plano 23 (RN-407): o local é obrigatório e a modalidade é o tipo dele. `modalidade`, se vier (o formulário antigo, de antes
 * do PR 2, em cache no navegador), tem de ser a do tipo do local: trocar presencial ↔ online sem trocar o local é
 * "Escolha o local.", nunca o 23503 da FK composta `(tenant_id, local_id, modalidade)`.
 */
export type EntradaConsulta = { patientId?: unknown; data: unknown; hora: unknown; duracaoMin: unknown; localId: unknown; modalidade?: unknown; linkOnline?: unknown };

export class ConsultaError extends Error {
  override name = 'ConsultaError';
  constructor(readonly erros: Record<string, string>) {
    super('Consulta inválida');
  }
}
export class ConsultaNaoEncontradaError extends Error {
  override name = 'ConsultaNaoEncontradaError';
  constructor() {
    super(MSG_AGENDA.naoEncontrada);
  }
}

type Deps = { db?: Db; now?: Date };
/** RN-400: marcar e alterar pelo painel são só da sessão da nutricionista; conferido antes de abrir a transação. */
const exigirNutri = (ctx: TenantContext) => {
  if (ctx.role !== 'nutri') throw new Error('agenda: só a sessão nutri');
};
export const STATUS_ATIVOS: readonly StatusConsulta[] = ['agendada', 'confirmada'];
/** O banco exige `^https://` e até 500 caracteres (appointments_link_online). */
export const linkValido = (v: string) => /^https:\/\/\S+$/.test(v) && v.length <= 500 && URL.canParse(v);
export const ehSobreposicao = (e: unknown) => exclusionViolation(e) === 'appointments_sem_sobreposicao';

/**
 * Revisão final: o Postgres põe a tupla no índice GiST e só depois procura conflitos (execIndexing.c), então duas
 * gravações de faixas que se sobrepõem ao mesmo tempo podem esperar uma pela outra — 40P01 em vez de 23P01. A transação
 * desfeita perdeu a corrida: `operacao` (a checagem e a transação inteiras) roda de novo uma vez; na nova tentativa a
 * checagem ou o EXCLUDE esperam a sobrevivente e devolvem o conflito certo. Um segundo 40P01 sobe como erro: nunca vira
 * mensagem de conflito sem a conferência.
 */
export async function repetirSeDeadlock<T>(operacao: () => Promise<T>): Promise<T> {
  try {
    return await operacao();
  } catch (e) {
    if (!deadlockDetectado(e)) throw e;
  }
  return operacao();
}

type DataValidada = Intervalo & { localId: string };
type HorarioValidado = DataValidada & { modalidade: Modalidade; linkOnline: string | null };

/** Data, hora e duração (sem banco) e a forma do local; os erros vão juntos para o formulário. */
function validarData(tenant: Pick<TenantAgenda, 'fuso'>, input: EntradaConsulta, erros: Record<string, string>, now: Date): DataValidada | null {
  const data = textoAparado(input.data);
  const hora = textoAparado(input.hora);
  if (!dataDaAgendaValida(data, hojeNoFuso(tenant.fuso, now))) erros.data = MSG_AGENDA.dataInvalida; // D22: passado vale; teto hoje + 5 anos
  if (!HORA_HHMM.test(hora)) erros.hora = MSG_AGENDA.horaInvalida;
  const duracao = Number(textoAparado(String(input.duracaoMin ?? '')));
  if (!Number.isInteger(duracao) || duracao < DURACAO_MIN || duracao > DURACAO_MAX) erros.duracaoMin = MSG_AGENDA.duracao;
  const localId = idValido(input.localId) ? input.localId : null;
  if (!localId) erros.localId = MSG_AGENDA.escolhaOLocal;
  let inicio: Date | null = null;
  if (!erros.data && !erros.hora) {
    inicio = paraInstante(data, hora, tenant.fuso);
    if (!inicio) erros.hora = MSG_AGENDA.horaInexistente;
  }
  if (Object.keys(erros).length || !inicio || !localId) return null;
  return { inicio, fim: new Date(inicio.getTime() + duracao * 60_000), localId };
}

/**
 * Na transação da gravação: o local ativo do consultório (a RLS esconde o de outro), travado `FOR SHARE` para não ser
 * arquivado entre a conferência e a gravação (ordem: paciente → local → consulta). A modalidade é o tipo do local; o link
 * da chamada, o informado ou a sala fixa do local (`linkSugerido`); no presencial, o link informado é ignorado.
 */
async function comLocal(tx: Tx, input: EntradaConsulta, d: DataValidada): Promise<HorarioValidado> {
  const [l] = await tx.select().from(locaisAtendimento).where(and(eq(locaisAtendimento.id, d.localId), isNull(locaisAtendimento.arquivadoEm))).for('share');
  if (!l || (input.modalidade !== undefined && input.modalidade !== l.tipo)) throw new ConsultaError({ localId: MSG_AGENDA.escolhaOLocal });
  if (l.tipo !== 'online') return { ...d, modalidade: 'presencial', linkOnline: null };
  const link = textoAparado(input.linkOnline) || linkSugerido(l) || '';
  if (!linkValido(link)) throw new ConsultaError({ linkOnline: MSG_AGENDA.linkObrigatorio });
  return { ...d, modalidade: 'online', linkOnline: link };
}

/** Mensagem de conflito com o nome e a hora da consulta que já ocupa o horário (só a equipe vê). */
async function mensagemDeConflito(tx: Tx, i: Intervalo, fuso: string, ignorarId?: string): Promise<string | null> {
  const [c] = await tx
    .select({ nome: patients.nome, inicio: appointments.inicio })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(and(ne(appointments.status, 'cancelada'), lt(appointments.inicio, i.fim), gt(appointments.fim, i.inicio), ignorarId ? ne(appointments.id, ignorarId) : undefined))
    .orderBy(asc(appointments.inicio))
    .limit(1);
  return c ? MSG_AGENDA.conflito(c.nome, partesNoFuso(c.inicio, fuso).hora) : null;
}

/** Plano 23: "Fora do seu horário de atendimento" é pelas regras do local da consulta (as sem local pela RN-410a). */
async function avisosDoHorario(tx: Tx, i: Intervalo & { localId: string }, fuso: string): Promise<AvisoAgenda[]> {
  const avisos: AvisoAgenda[] = [];
  const locais = paraGeracao(await locaisAtivos(tx));
  const doLocal = (await lerRegras(tx)).filter((r) => regraNoLocal(r, locais).some((d) => d.localId === i.localId));
  if (!dentroDoHorario(i, doLocal, fuso)) avisos.push('fora_do_horario');
  if ((await lerBloqueios(tx, i.inicio, i.fim)).some((b) => sobrepoe(b, i))) avisos.push('dentro_de_bloqueio');
  return avisos;
}

/** Corrida perdida para outra gravação (23P01 depois da checagem): lê o conflito numa transação nova. */
async function comoConflito(ctx: TenantContext, i: Intervalo, fuso: string, db: Db, ignorarId?: string): Promise<never> {
  const msg = await withTenant(ctx, (tx) => mensagemDeConflito(tx, i, fuso, ignorarId), db);
  throw new ConsultaError({ geral: msg ?? MSG_AGENDA.ocupado });
}

/**
 * US-031 / D22: a nutricionista marca em qualquer data e horário (fora das regras ou num bloqueio, com aviso).
 * Paciente arquivado não é agendado; bloqueado/anonimizado → PacienteBloqueadoError (carregarPacienteParaEscrita).
 */
export async function agendarPelaNutri(ctx: TenantContext, tenant: TenantAgenda, input: EntradaConsulta, deps: Deps = {}): Promise<{ id: string; avisos: AvisoAgenda[] }> {
  exigirNutri(ctx);
  const erros: Record<string, string> = {};
  const patientId = idValido(input.patientId) ? input.patientId : null;
  if (!patientId) erros.patientId = MSG_AGENDA.pacienteObrigatorio;
  const now = deps.now ?? new Date();
  const d = validarData(tenant, input, erros, now);
  if (!d || !patientId) throw new ConsultaError(erros);
  const db = deps.db ?? getDb();
  try {
    return await repetirSeDeadlock(() => withTenant(
      ctx,
      async (tx) => {
        const p = await carregarPacienteParaEscrita(tx, patientId);
        if (p.status !== 'ativo') throw new ConsultaError({ patientId: MSG_AGENDA.pacienteArquivado });
        const v = await comLocal(tx, input, d);
        const choque = await mensagemDeConflito(tx, v, tenant.fuso);
        if (choque) throw new ConsultaError({ geral: choque });
        const [c] = await tx
          .insert(appointments)
          .values({ tenantId: ctx.tenantId, patientId: p.id, inicio: v.inicio, fim: v.fim, modalidade: v.modalidade, localId: v.localId, linkOnline: v.linkOnline, status: 'agendada', origem: 'nutri', createdAt: now, updatedAt: now })
          .returning();
        // RN-05 / US-031: lembretes, "Consulta marcada" ao paciente e o pedido de envio já, na mesma transação
        const alvo = { tenantId: ctx.tenantId, patientId: p.id, appointmentId: c.id, inicio: c.inicio };
        await agendarLembretes(tx, alvo, tenant.fuso, now);
        await avisarPaciente(tx, alvo, 'consulta_marcada', now);
        await dispararEnvio(tx, ctx.tenantId);
        return { id: c.id, avisos: await avisosDoHorario(tx, v, tenant.fuso) };
      },
      db,
    ));
  } catch (e) {
    if (ehSobreposicao(e)) return comoConflito(ctx, d, tenant.fuso, db);
    throw e;
  }
}

/** Consulta travada para escrita; outro tenant ou outro paciente (RLS) → não encontrada. */
export async function lerConsultaParaEscrita(tx: Tx, id: string): Promise<AppointmentRow> {
  if (!idValido(id)) throw new ConsultaNaoEncontradaError();
  const [c] = await tx.select().from(appointments).where(eq(appointments.id, id)).for('update');
  if (!c) throw new ConsultaNaoEncontradaError();
  return c;
}

/**
 * D17: "Alterar data e hora" pela nutricionista — a mesma consulta. Se o início muda, volta a "agendada" e
 * perde a confirmação e o pedido de remarcação (eram do horário antigo); mudar só a duração, a modalidade
 * ou o link mantém a situação (R3). Ordem das travas: paciente → local → consulta. Plano 23: o local entra na alteração
 * (RN-407; a consulta antiga sem local ganha o escolhido); o link vazio de uma consulta online é a sala do local, nunca o
 * link que a consulta tinha (o formulário só reapresenta o link gravado com o mesmo local).
 */
export async function moverConsulta(ctx: TenantContext, tenant: TenantAgenda, id: string, input: EntradaConsulta, deps: Deps = {}): Promise<{ avisos: AvisoAgenda[] }> {
  exigirNutri(ctx);
  const erros: Record<string, string> = {};
  const now = deps.now ?? new Date();
  const d = validarData(tenant, input, erros, now);
  if (!d) throw new ConsultaError(erros);
  const db = deps.db ?? getDb();
  try {
    return await repetirSeDeadlock(() => withTenant(
      ctx,
      async (tx) => {
        if (!idValido(id)) throw new ConsultaNaoEncontradaError();
        const [antes] = await tx.select({ patientId: appointments.patientId }).from(appointments).where(eq(appointments.id, id));
        if (!antes) throw new ConsultaNaoEncontradaError();
        await carregarPacienteParaEscrita(tx, antes.patientId);
        const v = await comLocal(tx, input, d);
        const c = await lerConsultaParaEscrita(tx, id);
        if (!STATUS_ATIVOS.includes(c.status as StatusConsulta)) throw new ConsultaError({ geral: MSG_AGENDA.naoAlteravel });
        const choque = await mensagemDeConflito(tx, v, tenant.fuso, id);
        if (choque) throw new ConsultaError({ geral: choque });
        const inicioMudou = v.inicio.getTime() !== c.inicio.getTime();
        const horarioNovo = inicioMudou ? { status: 'agendada', confirmadaVia: null, pedidoRemarcacaoEm: null } : {};
        await tx
          .update(appointments)
          .set({ inicio: v.inicio, fim: v.fim, modalidade: v.modalidade, localId: v.localId, linkOnline: v.linkOnline, ...horarioNovo, updatedAt: now })
          .where(eq(appointments.id, id));
        if (inicioMudou) {
          // R3 / D17: lembretes do horário novo como linhas novas (os pendentes do horário antigo viram ignorados
          // `consulta_remarcada`; os já enviados ficam como estão: linha enviada é imutável, D6), "Consulta marcada"
          // ao paciente e o pedido de envio já. Mudar só a duração, a modalidade ou o link não passa por aqui: os
          // pendentes saem com os dados novos, lidos no envio.
          const alvo = { tenantId: ctx.tenantId, patientId: c.patientId, appointmentId: id, inicio: v.inicio };
          await agendarLembretes(tx, alvo, tenant.fuso, now);
          await avisarPaciente(tx, alvo, 'consulta_marcada', now);
          await dispararEnvio(tx, ctx.tenantId);
        }
        return { avisos: await avisosDoHorario(tx, v, tenant.fuso) };
      },
      db,
    ));
  } catch (e) {
    if (ehSobreposicao(e)) return comoConflito(ctx, d, tenant.fuso, db, id);
    throw e;
  }
}

const COLUNAS = {
  c: appointments,
  paciente: patients.nome,
  origemPaciente: patients.origem,
  nascimento: patients.dataNascimento,
};
/** Plano 23: o nome e o tipo do local, só nas leituras da equipe (`locais_atendimento` é staff_only, RN-406). */
const COLUNAS_COM_LOCAL = { ...COLUNAS, localNome: locaisAtendimento.nome, localTipo: locaisAtendimento.tipo };
const doLocal = and(eq(locaisAtendimento.tenantId, appointments.tenantId), eq(locaisAtendimento.id, appointments.localId));
type Linha = { c: AppointmentRow; paciente: string; origemPaciente: string; nascimento: string | null; localNome?: string | null; localTipo?: LocalRow['tipo'] | null };
const comoConsulta = ({ c, paciente, origemPaciente, nascimento, localNome, localTipo }: Linha): Consulta => ({
  id: c.id,
  patientId: c.patientId,
  paciente,
  pacienteNovoPublico: origemPaciente === 'agendamento_publico' && !nascimento,
  inicio: c.inicio,
  fim: c.fim,
  modalidade: c.modalidade as Modalidade,
  linkOnline: c.linkOnline,
  status: c.status as StatusConsulta,
  origem: c.origem as Consulta['origem'],
  confirmadaVia: c.confirmadaVia as Consulta['confirmadaVia'],
  canceladoPor: c.canceladoPor as Consulta['canceladoPor'],
  pedidoRemarcacaoEm: c.pedidoRemarcacaoEm,
  remarcadaDe: c.remarcadaDe,
  localId: c.localId,
  local: localNome && localTipo ? { nome: localNome, tipo: localTipo as TipoDeLocal } : null,
});

/** D10: a agenda (nome, hora, situação) não é leitura auditada — mesmo critério da lista de pacientes. Só a equipe. */
export async function listarAgenda(ctx: TenantContext, de: Date, ate: Date, db: Db = getDb()): Promise<Consulta[]> {
  return withTenant(ctx, (tx) => listarAgendaNaTransacao(tx, de, ate), db);
}

/** listarAgenda dentro de uma transação já aberta (o Início lê tudo numa só). Só na sessão da equipe (lê o local). */
export async function listarAgendaNaTransacao(tx: Tx, de: Date, ate: Date): Promise<Consulta[]> {
  const rs = await tx
    .select(COLUNAS_COM_LOCAL)
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .leftJoin(locaisAtendimento, doLocal)
    .where(and(lt(appointments.inicio, ate), gt(appointments.fim, de)))
    .orderBy(asc(appointments.inicio));
  return rs.map(comoConsulta);
}

/**
 * Listas do painel (pendências, novidades) e do portal: mesmo formato da agenda, com o nome numa consulta só; sem leitura
 * auditada (D10). O local (nome e tipo) só na sessão `nutri`.
 */
export async function listarConsultas(ctx: TenantContext, onde: SQL | undefined, o: { ordem: 'asc' | 'desc'; limite: number }, db: Db = getDb()): Promise<Consulta[]> {
  return withTenant(ctx, (tx) => listarConsultasNaTransacao(tx, onde, { ...o, comLocal: ctx.role === 'nutri' }), db);
}

export async function listarConsultasNaTransacao(tx: Tx, onde: SQL | undefined, o: { ordem: 'asc' | 'desc'; limite: number; comLocal?: boolean }): Promise<Consulta[]> {
  const base = o.comLocal
    ? tx.select(COLUNAS_COM_LOCAL).from(appointments).innerJoin(patients, eq(patients.id, appointments.patientId)).leftJoin(locaisAtendimento, doLocal)
    : tx.select(COLUNAS).from(appointments).innerJoin(patients, eq(patients.id, appointments.patientId));
  const rs = await base
    .where(onde)
    .orderBy(o.ordem === 'asc' ? asc(appointments.inicio) : desc(appointments.inicio))
    .limit(o.limite);
  return rs.map(comoConsulta);
}

/** A consulta; o local (nome e tipo) só na sessão `nutri` (o portal lê pela projeção). */
export async function buscarConsulta(ctx: TenantContext, id: string, db: Db = getDb()): Promise<Consulta | null> {
  if (!idValido(id)) return null;
  const [r] = await withTenant(ctx, (tx) => listarConsultasNaTransacao(tx, eq(appointments.id, id), { ordem: 'asc', limite: 1, comLocal: ctx.role === 'nutri' }), db);
  return r ?? null;
}

/**
 * Revisão final: o motivo que a nutricionista escreveu ao cancelar ("Só você vê." no formulário), para a página da consulta
 * no painel. Só dela: sessão de outro papel é erro de programação; o motivo do paciente ("Remarcada pelo paciente") não
 * entra. Nunca vai para o link da consulta, e-mail, WhatsApp, PWA nem para a exportação (exportacao-job leva só o do
 * paciente). Leitura da agenda: sem auditRead (D10).
 */
export async function motivoDoCancelamentoDaNutri(ctx: TenantContext, id: string, db: Db = getDb()): Promise<string | null> {
  if (ctx.role !== 'nutri') throw new Error('o motivo do cancelamento é só da nutricionista');
  if (!idValido(id)) return null;
  const [r] = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ motivo: appointments.motivoCancelamento })
        .from(appointments)
        .where(and(eq(appointments.id, id), eq(appointments.status, 'cancelada'), eq(appointments.canceladoPor, 'nutri'))),
    db,
  );
  return r?.motivo ?? null;
}

/**
 * D11: horários livres no contexto `publico` (sem ator): lê regras, bloqueios e só início/fim das consultas
 * não canceladas, e devolve só intervalos — nunca quem ocupa. A margem de 8 h depois de `ate` pega
 * bloqueio/consulta que começa depois do fim da janela mas cruza o último horário.
 * Plano 23 (RN-409, RN-410a, AG-D62): os locais vêm da projeção `app_locais_para_agendamento()` (todos os ativos, sem a sala);
 * cada regra vale no local da RN-410a e só os locais com "Aceita agendamento pelo paciente" oferecem horário (recorte depois
 * da atribuição); os pedidos da pessoa nova aguardando também ocupam (`app_pedidos_aguardando`, só intervalos). `localId`
 * recorta um local. Cada horário leva só `inicio`, `fim`, `modalidades` e `localId` (CS-401).
 */
export async function horariosLivres(tenant: Pick<TenantAgenda, 'id' | 'fuso'>, de: Date, ate: Date, opts: { db?: Db; ignorarConsultaId?: string; localId?: string } = {}): Promise<Horario[]> {
  const margem = new Date(ate.getTime() + 8 * 3_600_000);
  return withTenant(
    { tenantId: tenant.id, role: 'publico' },
    async (tx) => {
      const regras = await lerRegras(tx);
      const locais: LocalDaGeracao[] = (await locaisParaAgendamento(tx)).map((l) => ({ id: l.id, tipo: l.tipo, principal: l.principal, agendamentoOnline: l.agendamentoOnline }));
      const bloqueios = await lerBloqueios(tx, de, margem);
      const ocupadas = await tx
        .select({ id: appointments.id, inicio: appointments.inicio, fim: appointments.fim })
        .from(appointments)
        .where(and(ne(appointments.status, 'cancelada'), lt(appointments.inicio, margem), gt(appointments.fim, de)));
      const aguardando = await tx.execute<{ inicio: Date | string; fim: Date | string }>(sql`select lower(r) as inicio, upper(r) as fim from app_pedidos_aguardando(${de}, ${margem}) as t(r)`);
      const ocupados: Intervalo[] = [
        ...ocupadas.filter((o) => o.id !== opts.ignorarConsultaId).map(({ inicio, fim }) => ({ inicio, fim })),
        ...aguardando.rows.map((r) => ({ inicio: new Date(r.inicio), fim: new Date(r.fim) })),
      ];
      const hs = gerarHorarios({ regras, locais, bloqueios, ocupados, de, ate, fuso: tenant.fuso, soAgendamentoOnline: true });
      return opts.localId ? hs.filter((h) => h.localId === opts.localId) : hs;
    },
    opts.db ?? getDb(),
  );
}
