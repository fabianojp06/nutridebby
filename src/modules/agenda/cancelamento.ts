import { eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { appointments, patients, type AppointmentRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { normalizarTexto } from '@/lib/text';
import { avisarPaciente, cancelarLembretes, dispararEnvio } from '@/modules/notificacoes/agendar';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { escolherHorario, gravarConsultaDoPaciente } from './agendamento-paciente';
import { avisarNutriDaConsulta } from './aviso-nutri';
import { MSG_AGENDA } from './constantes';
import { ConsultaError, ConsultaNaoEncontradaError, ehSobreposicao, lerConsultaParaEscrita, STATUS_ATIVOS, type StatusConsulta, type TenantAgenda } from './consultas';
import { noInicioDoLink } from './link-consulta';

/**
 * `inicioDoLink` (D20, revisão da T5): o início que o link assinado carrega — ou o do lembrete do WhatsApp respondido
 * com "1"/"2" (T12). A ação só vale se a consulta ainda está nesse início — conferido sob a trava da consulta (a página
 * confere antes, mas a nutricionista pode mudar o horário entre abrir o link e clicar).
 * `naMesmaTransacao` (T12, WhatsApp): roda na transação da ação, com as mesmas travas (paciente → consulta), quando a
 * ação vale para o paciente — presença confirmada (agora ou antes) ou pedido de remarcação registrado (agora ou antes):
 * é onde o webhook grava a resposta ao paciente, que só existe se a ação valeu.
 */
type Deps = { db?: Db; now?: Date; appUrl?: string; inicioDoLink?: Date; naMesmaTransacao?: (tx: Tx, c: AppointmentRow) => Promise<void> };

/** D20: a consulta mudou de horário depois de o link sair — o link antigo expirou para ela ("Este link expirou."). */
export class ConsultaMudouError extends Error {
  override name = 'ConsultaMudouError';
}

const ativa = (status: string) => STATUS_ATIVOS.includes(status as StatusConsulta);

function conferirInicioDoLink(c: AppointmentRow, deps: Deps): void {
  if (deps.inicioDoLink && !noInicioDoLink(c.inicio, deps.inicioDoLink)) throw new ConsultaMudouError();
}

/** RN-04: o paciente cancela ou remarca até `cancelamento_min_h` antes do início (no limite exato, ainda pode). */
export function podeAlterarPeloPaciente(inicio: Date, cancelamentoMinH: number, agora: Date): boolean {
  return inicio.getTime() - agora.getTime() >= cancelamentoMinH * 3_600_000;
}

/**
 * RN-08 / US-018 (rodada 1 do /code-review): paciente arquivado, bloqueado ou anonimizado não age pela agenda (link,
 * WhatsApp, PWA). Trava o paciente (`FOR SHARE`) antes da consulta — a mesma ordem de moverConsulta (paciente → consulta).
 * Devolve o nome (aviso à nutricionista) ou null.
 */
async function pacienteAtivo(tx: Tx, ctx: TenantContext): Promise<{ nome: string } | null> {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('ação do paciente exige sessão de paciente');
  const [p] = await tx.select({ nome: patients.nome, status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, ctx.patientId)).for('share');
  return p && p.status === 'ativo' && !p.anonimizadoEm ? { nome: p.nome } : null;
}

/**
 * Rodada 1 da T7: o caminho da nutricionista também trava o paciente ANTES da consulta — a ordem de remarcarComoPaciente
 * e moverConsulta. Sem isso, a consulta ficava travada e o INSERT em `notifications` (FK → `FOR KEY SHARE` no paciente)
 * esperava o paciente que a remarcação já segurava: deadlock (40P01). `FOR KEY SHARE` (a trava da própria FK), sem
 * `carregarPacienteParaEscrita`: a nutricionista cancela também consulta de paciente bloqueado ou anonimizado.
 */
export async function travarPacienteDaConsulta(tx: Tx, id: string): Promise<string> {
  if (!idValido(id)) throw new ConsultaNaoEncontradaError();
  const [c] = await tx.select({ patientId: appointments.patientId }).from(appointments).where(eq(appointments.id, id));
  if (!c) throw new ConsultaNaoEncontradaError();
  await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, c.patientId)).for('key share');
  return c.patientId;
}

/**
 * US-033 / RN-04: a nutricionista cancela a qualquer momento; o paciente, dentro do prazo e se ativo (RN-08). O paciente
 * recebe o aviso (só de consulta que ainda não começou); quando é ele quem cancela, a nutricionista também (D18).
 */
export async function cancelarConsulta(ctx: TenantContext, tenant: TenantAgenda, id: string, o: { por: 'nutri' | 'paciente'; motivo?: unknown }, deps: Deps = {}): Promise<void> {
  if (o.por === 'nutri' && ctx.role !== 'nutri') throw new Error('cancelar como a nutricionista exige sessão da nutricionista');
  const motivo = normalizarTexto(o.motivo);
  if (motivo.length > 300) throw new ConsultaError({ motivo: MSG_AGENDA.motivoCancelamentoLongo });
  const agora = deps.now ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      // travas: paciente → consulta, nos dois caminhos
      const paciente = o.por === 'paciente' ? await pacienteAtivo(tx, ctx) : null;
      if (o.por === 'paciente' && !paciente) throw new ConsultaError({ geral: MSG_AGENDA.foraDoPrazo }); // RN-08
      const travado = o.por === 'paciente' ? ctx.patientId : await travarPacienteDaConsulta(tx, id);
      const c = await lerConsultaParaEscrita(tx, id); // RLS: o paciente só alcança a própria
      if (c.patientId !== travado) throw new ConsultaNaoEncontradaError(); // não acontece (patient_id não muda); se mudar, não segue sem a trava certa
      conferirInicioDoLink(c, deps);
      if (!ativa(c.status)) throw new ConsultaError({ geral: MSG_AGENDA.naoCancelavel });
      if (o.por === 'paciente' && !podeAlterarPeloPaciente(c.inicio, tenant.cancelamentoMinH, agora)) throw new ConsultaError({ geral: MSG_AGENDA.foraDoPrazo });
      await tx
        .update(appointments)
        .set({ status: 'cancelada', canceladoPor: o.por, canceladaEm: agora, motivoCancelamento: motivo || null, pedidoRemarcacaoEm: null, updatedAt: agora })
        .where(eq(appointments.id, id));
      await cancelarLembretes(tx, id, agora);
      await avisarPaciente(tx, { tenantId: ctx.tenantId, patientId: c.patientId, appointmentId: id, inicio: c.inicio }, 'consulta_cancelada', agora);
      if (paciente) await avisarNutriDaConsulta(tx, tenant, { id, inicio: c.inicio, paciente: paciente.nome }, 'cancelada', deps.appUrl ?? getEnv().APP_URL);
      await dispararEnvio(tx, ctx.tenantId);
    },
    deps.db ?? getDb(),
  );
}

/**
 * US-033 / D17: o paciente remarca = cancela a antiga e cria a nova (`remarcada_de`) numa transação; o horário
 * novo é validado ignorando a própria consulta. Travas: paciente → consulta (mesma ordem de moverConsulta).
 * Review Focus 6 (rodada 1): `escolherHorario` abre a própria transação (contexto publico) — por isso roda ANTES desta,
 * nunca dentro (seria uma segunda conexão com a trava do paciente e da consulta presa; pool max: 10). Dentro, o
 * EXCLUDE revalida o horário (outro paciente pode ter marcado no meio: "Esse horário acabou de ser ocupado").
 */
export async function remarcarComoPaciente(ctx: TenantContext, tenant: TenantAgenda, id: string, novo: { inicio: unknown; modalidade: unknown }, deps: Deps = {}): Promise<{ id: string; inicio: Date }> {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('remarcarComoPaciente exige sessão de paciente');
  if (tenant.status !== 'ativa') throw new ConsultaError({ geral: MSG_AGENDA.contaIndisponivel });
  const db = deps.db ?? getDb();
  const agora = deps.now ?? new Date();
  const h = await escolherHorario(tenant, novo.inicio, novo.modalidade, agora, { db, ignorarConsultaId: id });
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const p = await carregarPacienteParaEscrita(tx, ctx.patientId!); // bloqueado/anonimizado → PacienteBloqueadoError
        if (p.status !== 'ativo') throw new ConsultaError({ geral: MSG_AGENDA.naoAgendavel }); // RN-08
        const c = await lerConsultaParaEscrita(tx, id);
        conferirInicioDoLink(c, deps);
        if (!ativa(c.status)) throw new ConsultaError({ geral: MSG_AGENDA.naoAlteravel });
        if (!podeAlterarPeloPaciente(c.inicio, tenant.cancelamentoMinH, agora)) throw new ConsultaError({ geral: MSG_AGENDA.foraDoPrazo });
        await tx
          .update(appointments)
          .set({ status: 'cancelada', canceladoPor: 'paciente', canceladaEm: agora, motivoCancelamento: 'Remarcada pelo paciente', pedidoRemarcacaoEm: null, updatedAt: agora })
          .where(eq(appointments.id, id));
        await cancelarLembretes(tx, id, agora);
        const novoId = await gravarConsultaDoPaciente(tx, tenant, p, h, { agora, appUrl: deps.appUrl ?? getEnv().APP_URL, evento: 'remarcada', remarcadaDe: id });
        return { id: novoId, inicio: h.inicio };
      },
      db,
    );
  } catch (e) {
    if (ehSobreposicao(e)) throw new ConsultaError({ inicio: MSG_AGENDA.ocupado });
    throw e;
  }
}

/** US-035: "1" no WhatsApp ou "Confirmar presença" no link. Idempotente; só antes do início e só de paciente ativo (RN-08). */
export async function confirmarPresenca(ctx: TenantContext, id: string, via: 'whatsapp' | 'link', deps: Deps = {}): Promise<'confirmada' | 'ja_confirmada' | 'nao_confirmavel'> {
  const agora = deps.now ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      if (!(await pacienteAtivo(tx, ctx))) return 'nao_confirmavel';
      const c = await lerConsultaParaEscrita(tx, id);
      conferirInicioDoLink(c, deps);
      if (!ativa(c.status) || c.inicio.getTime() <= agora.getTime()) return 'nao_confirmavel';
      if (c.status === 'confirmada') {
        await deps.naMesmaTransacao?.(tx, c);
        return 'ja_confirmada';
      }
      await tx.update(appointments).set({ status: 'confirmada', confirmadaVia: via, pedidoRemarcacaoEm: null, updatedAt: agora }).where(eq(appointments.id, id));
      await deps.naMesmaTransacao?.(tx, c);
      return 'confirmada';
    },
    deps.db ?? getDb(),
  );
}

/** US-035 "Preciso remarcar": marca o pedido e avisa a nutricionista — uma vez só (repetir não avisa de novo); só paciente ativo. */
export async function pedirRemarcacao(ctx: TenantContext, tenant: TenantAgenda, id: string, deps: Deps = {}): Promise<boolean> {
  const agora = deps.now ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const paciente = await pacienteAtivo(tx, ctx);
      if (!paciente) return false;
      const c = await lerConsultaParaEscrita(tx, id);
      conferirInicioDoLink(c, deps);
      if (!ativa(c.status) || c.inicio.getTime() <= agora.getTime()) return false;
      if (c.pedidoRemarcacaoEm) {
        await deps.naMesmaTransacao?.(tx, c); // já pedido (pelo link ou antes): a nutricionista não é avisada de novo
        return false;
      }
      await tx.update(appointments).set({ pedidoRemarcacaoEm: agora, updatedAt: agora }).where(eq(appointments.id, id));
      await avisarNutriDaConsulta(tx, tenant, { id, inicio: c.inicio, paciente: paciente.nome }, 'pedido_remarcacao', deps.appUrl ?? getEnv().APP_URL);
      await deps.naMesmaTransacao?.(tx, c);
      return true;
    },
    deps.db ?? getDb(),
  );
}
