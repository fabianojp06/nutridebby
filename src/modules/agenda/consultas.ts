import { and, asc, desc, eq, gt, lt, ne, type SQL } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { exclusionViolation } from '@/db/errors';
import { appointments, patients, type AppointmentRow, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { agendarLembretes, avisarPaciente, dispararEnvio } from '@/modules/notificacoes/agendar';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { dataValida } from '@/modules/pacientes/datas';
import { DURACAO_MAX, DURACAO_MIN, MSG_AGENDA } from './constantes';
import { lerBloqueios, lerRegras } from './disponibilidade';
import { paraInstante, partesNoFuso } from './fuso';
import { dentroDoHorario, gerarHorarios, HORA_HHMM, sobrepoe, textoAparado, type Horario, type Intervalo, type Modalidade } from './horarios';

export type StatusConsulta = 'agendada' | 'confirmada' | 'cancelada' | 'realizada' | 'faltou';
export type AvisoAgenda = 'fora_do_horario' | 'dentro_de_bloqueio';
export type TenantAgenda = Pick<TenantRow, 'id' | 'fuso' | 'nomeExibicao' | 'linkOnlinePadrao' | 'enderecoConsultorio' | 'antecedenciaMinH' | 'cancelamentoMinH' | 'status' | 'agendamentoPublicoAtivo'>;
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
  canceladoPor: 'nutri' | 'paciente' | null;
  pedidoRemarcacaoEm: Date | null;
  remarcadaDe: string | null;
};
export type EntradaConsulta = { patientId?: unknown; data: unknown; hora: unknown; duracaoMin: unknown; modalidade: unknown; linkOnline?: unknown };

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
export const STATUS_ATIVOS: readonly StatusConsulta[] = ['agendada', 'confirmada'];
/** O banco exige `^https://` e até 500 caracteres (appointments_link_online). */
export const linkValido = (v: string) => /^https:\/\/\S+$/.test(v) && v.length <= 500 && URL.canParse(v);
export const ehSobreposicao = (e: unknown) => exclusionViolation(e) === 'appointments_sem_sobreposicao';

type HorarioValidado = Intervalo & { modalidade: Modalidade; linkOnline: string | null };

function validarHorario(tenant: Pick<TenantAgenda, 'fuso' | 'linkOnlinePadrao'>, input: EntradaConsulta, erros: Record<string, string>): HorarioValidado | null {
  const data = textoAparado(input.data);
  const hora = textoAparado(input.hora);
  if (!dataValida(data)) erros.data = MSG_AGENDA.dataInvalida;
  if (!HORA_HHMM.test(hora)) erros.hora = MSG_AGENDA.horaInvalida;
  const duracao = Number(textoAparado(String(input.duracaoMin ?? '')));
  if (!Number.isInteger(duracao) || duracao < DURACAO_MIN || duracao > DURACAO_MAX) erros.duracaoMin = MSG_AGENDA.duracao;
  const modalidade = String(input.modalidade ?? '');
  if (modalidade !== 'presencial' && modalidade !== 'online') erros.modalidade = MSG_AGENDA.modalidade;
  const link = textoAparado(input.linkOnline) || tenant.linkOnlinePadrao || '';
  if (modalidade === 'online' && !linkValido(link)) erros.linkOnline = MSG_AGENDA.linkObrigatorio;
  let inicio: Date | null = null;
  if (!erros.data && !erros.hora) {
    inicio = paraInstante(data, hora, tenant.fuso);
    if (!inicio) erros.hora = MSG_AGENDA.horaInexistente;
  }
  if (Object.keys(erros).length || !inicio) return null;
  return { inicio, fim: new Date(inicio.getTime() + duracao * 60_000), modalidade: modalidade as Modalidade, linkOnline: modalidade === 'online' ? link : null };
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

async function avisosDoHorario(tx: Tx, i: Intervalo, fuso: string): Promise<AvisoAgenda[]> {
  const avisos: AvisoAgenda[] = [];
  if (!dentroDoHorario(i, await lerRegras(tx), fuso)) avisos.push('fora_do_horario');
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
  const erros: Record<string, string> = {};
  const patientId = idValido(input.patientId) ? input.patientId : null;
  if (!patientId) erros.patientId = MSG_AGENDA.pacienteObrigatorio;
  const v = validarHorario(tenant, input, erros);
  if (!v || !patientId) throw new ConsultaError(erros);
  const now = deps.now ?? new Date();
  const db = deps.db ?? getDb();
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const p = await carregarPacienteParaEscrita(tx, patientId);
        if (p.status !== 'ativo') throw new ConsultaError({ patientId: MSG_AGENDA.pacienteArquivado });
        const choque = await mensagemDeConflito(tx, v, tenant.fuso);
        if (choque) throw new ConsultaError({ geral: choque });
        const [c] = await tx
          .insert(appointments)
          .values({ tenantId: ctx.tenantId, patientId: p.id, inicio: v.inicio, fim: v.fim, modalidade: v.modalidade, linkOnline: v.linkOnline, status: 'agendada', origem: 'nutri', createdAt: now, updatedAt: now })
          .returning();
        // RN-05 / US-031: lembretes, "Consulta marcada" ao paciente e o pedido de envio já, na mesma transação
        const alvo = { tenantId: ctx.tenantId, patientId: p.id, appointmentId: c.id, inicio: c.inicio };
        await agendarLembretes(tx, alvo, tenant.fuso, now);
        await avisarPaciente(tx, alvo, 'consulta_marcada', now);
        await dispararEnvio(tx, ctx.tenantId);
        return { id: c.id, avisos: await avisosDoHorario(tx, v, tenant.fuso) };
      },
      db,
    );
  } catch (e) {
    if (ehSobreposicao(e)) return comoConflito(ctx, v, tenant.fuso, db);
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
 * ou o link mantém a situação (R3). Ordem das travas: paciente → consulta.
 */
export async function moverConsulta(ctx: TenantContext, tenant: TenantAgenda, id: string, input: EntradaConsulta, deps: Deps = {}): Promise<{ avisos: AvisoAgenda[] }> {
  const erros: Record<string, string> = {};
  const v = validarHorario(tenant, input, erros);
  if (!v) throw new ConsultaError(erros);
  const now = deps.now ?? new Date();
  const db = deps.db ?? getDb();
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        if (!idValido(id)) throw new ConsultaNaoEncontradaError();
        const [antes] = await tx.select({ patientId: appointments.patientId }).from(appointments).where(eq(appointments.id, id));
        if (!antes) throw new ConsultaNaoEncontradaError();
        await carregarPacienteParaEscrita(tx, antes.patientId);
        const c = await lerConsultaParaEscrita(tx, id);
        if (!STATUS_ATIVOS.includes(c.status as StatusConsulta)) throw new ConsultaError({ geral: MSG_AGENDA.naoAlteravel });
        const choque = await mensagemDeConflito(tx, v, tenant.fuso, id);
        if (choque) throw new ConsultaError({ geral: choque });
        const inicioMudou = v.inicio.getTime() !== c.inicio.getTime();
        const horarioNovo = inicioMudou ? { status: 'agendada', confirmadaVia: null, pedidoRemarcacaoEm: null } : {};
        await tx
          .update(appointments)
          .set({ inicio: v.inicio, fim: v.fim, modalidade: v.modalidade, linkOnline: v.linkOnline, ...horarioNovo, updatedAt: now })
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
    );
  } catch (e) {
    if (ehSobreposicao(e)) return comoConflito(ctx, v, tenant.fuso, db, id);
    throw e;
  }
}

const COLUNAS = {
  c: appointments,
  paciente: patients.nome,
  origemPaciente: patients.origem,
  nascimento: patients.dataNascimento,
};
type Linha = { c: AppointmentRow; paciente: string; origemPaciente: string; nascimento: string | null };
const comoConsulta = ({ c, paciente, origemPaciente, nascimento }: Linha): Consulta => ({
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
});

/** D10: a agenda (nome, hora, situação) não é leitura auditada — mesmo critério da lista de pacientes. */
export async function listarAgenda(ctx: TenantContext, de: Date, ate: Date, db: Db = getDb()): Promise<Consulta[]> {
  const rs = await withTenant(
    ctx,
    (tx) => tx.select(COLUNAS).from(appointments).innerJoin(patients, eq(patients.id, appointments.patientId)).where(and(lt(appointments.inicio, ate), gt(appointments.fim, de))).orderBy(asc(appointments.inicio)),
    db,
  );
  return rs.map(comoConsulta);
}

/** Listas do painel (pendências, novidades): mesmo formato da agenda, com o nome numa consulta só; sem leitura auditada (D10). */
export async function listarConsultas(ctx: TenantContext, onde: SQL | undefined, o: { ordem: 'asc' | 'desc'; limite: number }, db: Db = getDb()): Promise<Consulta[]> {
  const rs = await withTenant(
    ctx,
    (tx) =>
      tx
        .select(COLUNAS)
        .from(appointments)
        .innerJoin(patients, eq(patients.id, appointments.patientId))
        .where(onde)
        .orderBy(o.ordem === 'asc' ? asc(appointments.inicio) : desc(appointments.inicio))
        .limit(o.limite),
    db,
  );
  return rs.map(comoConsulta);
}

export async function buscarConsulta(ctx: TenantContext, id: string, db: Db = getDb()): Promise<Consulta | null> {
  if (!idValido(id)) return null;
  const [r] = await withTenant(ctx, (tx) => tx.select(COLUNAS).from(appointments).innerJoin(patients, eq(patients.id, appointments.patientId)).where(eq(appointments.id, id)), db);
  return r ? comoConsulta(r) : null;
}

/**
 * D11: horários livres no contexto `publico` (sem ator): lê regras, bloqueios e só início/fim das consultas
 * não canceladas, e devolve só intervalos — nunca quem ocupa. A margem de 8 h depois de `ate` pega
 * bloqueio/consulta que começa depois do fim da janela mas cruza o último horário.
 */
export async function horariosLivres(tenant: Pick<TenantAgenda, 'id' | 'fuso' | 'linkOnlinePadrao'>, de: Date, ate: Date, opts: { db?: Db; ignorarConsultaId?: string } = {}): Promise<Horario[]> {
  const margem = new Date(ate.getTime() + 8 * 3_600_000);
  return withTenant(
    { tenantId: tenant.id, role: 'publico' },
    async (tx) => {
      const regras = await lerRegras(tx);
      const bloqueios = await lerBloqueios(tx, de, margem);
      const ocupadas = await tx
        .select({ id: appointments.id, inicio: appointments.inicio, fim: appointments.fim })
        .from(appointments)
        .where(and(ne(appointments.status, 'cancelada'), lt(appointments.inicio, margem), gt(appointments.fim, de)));
      const ocupados = ocupadas.filter((o) => o.id !== opts.ignorarConsultaId);
      return gerarHorarios({ regras, bloqueios, ocupados, de, ate, fuso: tenant.fuso, online: !!tenant.linkOnlinePadrao });
    },
    opts.db ?? getDb(),
  );
}
