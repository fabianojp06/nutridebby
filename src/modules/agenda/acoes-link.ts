import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { appointments, patients, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { encryptionKey } from '@/lib/crypto';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { buscarTenant } from '@/modules/plataforma/tenant-status';
import { horariosParaPaciente } from './agendamento-paciente';
import { cancelarConsulta, confirmarPresenca, ConsultaMudouError, LinkRevogadoError, pedirRemarcacao, podeAlterarPeloPaciente, remarcarComoPaciente } from './cancelamento';
import { MSG_AGENDA } from './constantes';
import { ConsultaNaoEncontradaError, STATUS_ATIVOS, type StatusConsulta } from './consultas';
import { quandoComFuso } from './fuso';
import { horariosVisiveis, type HorarioVisivel, type Modalidade } from './horarios';
import { chaveDosLinks, lerLinkConsulta, noInicioDoLink, normalizarEmailDoLink } from './link-consulta';

/** Link que não serve (inválido, expirado ou indisponível): a mensagem é o texto da tela. */
export class LinkError extends Error {
  override name = 'LinkError';
}

export type DepsLink = { db?: Db; agora?: Date; chave?: Buffer; ip?: string | null; appUrl?: string };
export type EstadoLink =
  | { estado: 'invalido' | 'expirado' | 'indisponivel' }
  | {
      estado: 'ok';
      nutri: string;
      quando: string;
      modalidade: Modalidade;
      local: string | null;
      status: StatusConsulta;
      ativa: boolean;
      podeAlterar: boolean;
      confirmada: boolean;
      pedidoRemarcacao: boolean;
      temOnline: boolean;
      fuso: string;
    };

type Resolvido = { tenant: TenantRow; appointmentId: string; patientId: string; inicioDoLink: Date; emailDoLink: string; agora: Date; db: Db };
type Falha = { estado: 'invalido' | 'expirado' | 'indisponivel' };

/**
 * Token → tenant ativo + dono da consulta (lido no contexto `publico`: só o `patient_id`, o e-mail, o início e a situação
 * do paciente). A assinatura é conferida com o e-mail ATUAL do paciente (decisão do dono, fechamento): e-mail corrigido
 * depois do link → "invalido". Até a assinatura conferir, toda falha é "invalido" (tenant ou consulta inexistente
 * inclusive) — nada do tenant nem do paciente é revelado por um token que não foi emitido. Depois: expirado (a consulta
 * já começou, ou não está mais no início do token — a nutricionista mudou o horário depois do link, revisão da T5; o
 * paciente recebeu outro link na "Consulta marcada" do horário novo); indisponível: tenant suspenso (RN-15) e paciente
 * arquivado, bloqueado ou anonimizado (RN-08, US-018, rodada 1). Uma conexão por vez: o tenant é lido antes da transação.
 */
async function resolver(token: string, deps: DepsLink): Promise<Resolvido | Falha> {
  const agora = deps.agora ?? new Date();
  const db = deps.db ?? getDb();
  // o token chega como argumento de Server Action (o cliente manda o que quiser): lerLinkConsulta só aceita texto
  const lido = await lerLinkConsulta(token, deps.chave ?? chaveDosLinks(encryptionKey()), agora, async (ids) => {
    const tenant = await buscarTenant(db, ids.tenantId);
    if (!tenant) return null;
    const [c] = await withTenant(
      { tenantId: tenant.id, role: 'publico' },
      (tx) =>
        tx
          .select({ patientId: appointments.patientId, inicio: appointments.inicio, email: patients.email, status: patients.status, anonimizadoEm: patients.anonimizadoEm })
          .from(appointments)
          .innerJoin(patients, eq(patients.id, appointments.patientId))
          .where(eq(appointments.id, ids.appointmentId)),
      db,
    );
    return c ? { ...c, tenant } : null;
  });
  if (!lido) return { estado: 'invalido' };
  const { link: l, dados: c } = lido;
  if (l.expirado) return { estado: 'expirado' };
  if (c.tenant.status !== 'ativa') return { estado: 'indisponivel' }; // RN-15
  if (c.status !== 'ativo' || c.anonimizadoEm) return { estado: 'indisponivel' };
  if (!noInicioDoLink(c.inicio, l.expiraEm)) return { estado: 'expirado' };
  return { tenant: c.tenant, appointmentId: l.appointmentId, patientId: c.patientId, inicioDoLink: l.expiraEm, emailDoLink: normalizarEmailDoLink(c.email), agora, db };
}

/** D20: as ações rodam como o próprio paciente (RLS por paciente), sem ator, com o IP de quem clicou. */
const comoPaciente = (r: Resolvido, ip?: string | null): TenantContext => ({ tenantId: r.tenant.id, role: 'paciente', patientId: r.patientId, ip: ip ?? null });
/** O início do token e o e-mail com que ele conferiu vão junto: a ação confere de novo sob as travas (a nutricionista pode mudar no meio). */
const depsDaAcao = (r: Resolvido, deps: DepsLink) => ({ db: r.db, now: r.agora, appUrl: deps.appUrl, inicioDoLink: r.inicioDoLink, emailDoLink: r.emailDoLink });

/** O texto de cada link que não serve — o mesmo na página e nas ações. */
export const MENSAGEM_DO_LINK: Record<Falha['estado'], string> = { invalido: MSG_AGENDA.linkInvalido, expirado: MSG_AGENDA.linkExpirado, indisponivel: MSG_AGENDA.contaIndisponivel };

async function exigir(token: string, deps: DepsLink): Promise<Resolvido> {
  const r = await resolver(token, deps);
  if ('tenant' in r) return r;
  throw new LinkError(MENSAGEM_DO_LINK[r.estado]);
}

/**
 * O que muda entre abrir o link e agir vira o mesmo estado do resolver, nunca 500: paciente bloqueado/anonimizado
 * (rodada 1) → indisponível; consulta movida (revisão da T5) → expirado; e-mail corrigido (fechamento), consulta ou paciente
 * que sumiu → link inválido.
 */
async function comoLink<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof PacienteBloqueadoError) throw new LinkError(MSG_AGENDA.contaIndisponivel);
    if (e instanceof ConsultaMudouError) throw new LinkError(MSG_AGENDA.linkExpirado);
    if (e instanceof LinkRevogadoError) throw new LinkError(MSG_AGENDA.linkInvalido);
    if (e instanceof ConsultaNaoEncontradaError || e instanceof PacienteNaoEncontradoError) throw new LinkError(MSG_AGENDA.linkInvalido);
    throw e;
  }
}

/** Leitura da página (GET): nunca muda estado — a pré-visualização de link do WhatsApp abre a URL. */
export async function abrirLinkConsulta(token: string, deps: DepsLink = {}): Promise<EstadoLink> {
  const r = await resolver(token, deps);
  if (!('tenant' in r)) return r;
  const [c] = await withTenant(comoPaciente(r), (tx) => tx.select().from(appointments).where(eq(appointments.id, r.appointmentId)), r.db);
  if (!c) return { estado: 'invalido' };
  if (!noInicioDoLink(c.inicio, r.inicioDoLink)) return { estado: 'expirado' }; // movida entre as duas leituras
  if (c.inicio.getTime() <= r.agora.getTime()) return { estado: 'expirado' };
  const modalidade = c.modalidade as Modalidade;
  const ativa = STATUS_ATIVOS.includes(c.status as StatusConsulta);
  return {
    estado: 'ok',
    nutri: r.tenant.nomeExibicao,
    quando: quandoComFuso(c.inicio, r.tenant.fuso),
    modalidade,
    local: modalidade === 'online' ? c.linkOnline : r.tenant.enderecoConsultorio,
    status: c.status as StatusConsulta,
    ativa,
    podeAlterar: ativa && podeAlterarPeloPaciente(c.inicio, r.tenant.cancelamentoMinH, r.agora),
    confirmada: c.status === 'confirmada',
    pedidoRemarcacao: !!c.pedidoRemarcacaoEm,
    temOnline: !!r.tenant.linkOnlinePadrao,
    fuso: r.tenant.fuso,
  };
}

/** Horários para remarcar (a própria consulta não ocupa), no contexto `publico`: só intervalos (D11); recorte de uma semana. */
export async function horariosDoLink(token: string, de: Date, ate: Date, deps: DepsLink = {}): Promise<HorarioVisivel[]> {
  const r = await resolver(token, deps);
  if (!('tenant' in r)) return [];
  return horariosVisiveis(await horariosParaPaciente(r.tenant, r.agora, { db: r.db, de, ate, ignorarConsultaId: r.appointmentId }), r.tenant.fuso);
}

/** US-035: o que a tela diz depois de "Confirmar presença" (texto do paciente quando não dá mais para confirmar). */
export function retornoDaConfirmacao(r: 'confirmada' | 'ja_confirmada' | 'nao_confirmavel'): { ok: string } | { erro: string } {
  return r === 'nao_confirmavel' ? { erro: MSG_AGENDA.naoConfirmavel } : { ok: MSG_AGENDA.presencaConfirmada };
}

export async function confirmarPeloLink(token: string, deps: DepsLink = {}): Promise<'confirmada' | 'ja_confirmada' | 'nao_confirmavel'> {
  const r = await exigir(token, deps);
  return comoLink(() => confirmarPresenca(comoPaciente(r, deps.ip), r.appointmentId, 'link', depsDaAcao(r, deps)));
}

export async function cancelarPeloLink(token: string, deps: DepsLink = {}): Promise<void> {
  const r = await exigir(token, deps);
  await comoLink(() => cancelarConsulta(comoPaciente(r, deps.ip), r.tenant, r.appointmentId, { por: 'paciente' }, depsDaAcao(r, deps)));
}

export async function remarcarPeloLink(token: string, input: { inicio: unknown; modalidade: unknown }, deps: DepsLink = {}): Promise<{ quando: string }> {
  const r = await exigir(token, deps);
  const novo = await comoLink(() => remarcarComoPaciente(comoPaciente(r, deps.ip), r.tenant, r.appointmentId, input, depsDaAcao(r, deps)));
  return { quando: quandoComFuso(novo.inicio, r.tenant.fuso) };
}

/** Fora do prazo do RN-04: o paciente só consegue avisar a nutricionista (US-035 "Preciso remarcar"). true = avisou agora. */
export async function avisarRemarcacaoPeloLink(token: string, deps: DepsLink = {}): Promise<boolean> {
  const r = await exigir(token, deps);
  return comoLink(() => pedirRemarcacao(comoPaciente(r, deps.ip), r.tenant, r.appointmentId, depsDaAcao(r, deps)));
}
