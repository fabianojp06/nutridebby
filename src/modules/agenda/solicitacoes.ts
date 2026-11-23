import { and, asc, count, eq, gt, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { appointments, locaisAtendimento, patients, publicBookingRequests, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { logger, nomeDoErro, sqlstateDoErro } from '@/lib/logger';
import { normalizarTexto } from '@/lib/text';
import { agendarLembretes, avisarPaciente, cancelarLembretes, dispararEnvio } from '@/modules/notificacoes/agendar';
import { idValido } from '@/modules/pacientes/base';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { avisarNutriDaConsulta } from './aviso-nutri';
import { MSG_AGENDA, MSG_SOLICITACOES } from './constantes';
import { ConsultaError, type TenantAgenda } from './consultas';
import { prazoDoPedido } from './status';
import { tiposDasConsultas } from './visoes';

/**
 * Plano 23 (US-407 a US-409, RN-420 a RN-428): a fila "Solicitações" e as respostas ao pedido do paciente (a consulta
 * `solicitada`, que o gatilho appointments_regras_pedido decide a partir da chave). O banco recusa toda transição fora da
 * RN-422; aqui ficam as travas, a reconferência sob a trava e os avisos.
 *
 * Travas (RN-427a, AG-D65): paciente (`FOR NO KEY UPDATE`, que basta contra o `KEY SHARE` da FK de `notifications`) →
 * consulta (`FOR UPDATE`) → notificações, em aceitar, recusar, desistir e vencer. A pessoa nova (pedido aguardando em
 * `public_booking_requests`) é da T7: trava do tenant → linha do pedido.
 *
 * Grafo de imports: nunca `notificacoes/enviar.ts`, `push.ts` nem `mensagens.ts` (o motor de envio só no worker).
 */

export type PedidoNaFila =
  | { tipo: 'consulta'; id: string; patientId: string; nome: string; inicio: Date; fim: Date; local: string | null; origem: 'app' | 'pagina'; pedidoEm: Date; respondaAte: Date; primeiraOnline: boolean }
  | { tipo: 'pessoa_nova'; id: string; nome: string; inicio: Date; fim: Date; local: string | null; origem: 'pagina'; pedidoEm: Date; respondaAte: Date };

/** O pedido venceu ou já foi respondido (em outra aba, pela varredura, pelo paciente) entre a tela e a ação. */
export class PedidoMudouError extends Error {
  override name = 'PedidoMudouError';
  constructor() {
    super(MSG_SOLICITACOES.mudou);
  }
}

type Deps = { db?: Db; agora?: Date; appUrl?: string };
type Alvo = { tipo: 'consulta' | 'pessoa_nova'; id: string };

/** RN-400: só a sessão da nutricionista responde pedidos; conferido antes de abrir a transação. */
const exigirNutri = (ctx: TenantContext) => {
  if (ctx.role !== 'nutri') throw new Error('agenda: só a sessão nutri');
};

/** Pedido ainda no prazo de resposta, em SQL (a varredura usa o complemento): `inicio − antecedência > agora`. */
const noPrazo = (antecedenciaMinH: number, agora: Date) => gt(appointments.inicio, new Date(agora.getTime() + antecedenciaMinH * 3_600_000));
/** Veio da página pública: há um pedido em `public_booking_requests` que aponta para a consulta (RN-426). */
const daPagina = sql<boolean>`exists (select 1 from ${publicBookingRequests} b where b.tenant_id = ${appointments.tenantId} and b.appointment_id = ${appointments.id})`;

/**
 * US-409: os pedidos de paciente que ainda estão no prazo, do que vence primeiro ao último (leitura preguiçosa: o vencido
 * e ainda não processado pela varredura não aparece, RN-427). `primeiraOnline`: consulta online com "Primeira consulta"
 * (RN-404, RN-416). A pessoa nova entra na T7. Leitura da agenda: sem `auditRead` (RN-414).
 */
export async function listarSolicitacoes(ctx: TenantContext, tenant: Pick<TenantAgenda, 'antecedenciaMinH'>, deps: Deps = {}): Promise<PedidoNaFila[]> {
  exigirNutri(ctx);
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const rs = await tx
        .select({ c: appointments, nome: patients.nome, local: locaisAtendimento.nome, daPagina: daPagina.mapWith(Boolean) })
        .from(appointments)
        .innerJoin(patients, eq(patients.id, appointments.patientId))
        .leftJoin(locaisAtendimento, and(eq(locaisAtendimento.tenantId, appointments.tenantId), eq(locaisAtendimento.id, appointments.localId)))
        .where(and(eq(appointments.status, 'solicitada'), noPrazo(tenant.antecedenciaMinH, agora)))
        .orderBy(asc(appointments.inicio), asc(appointments.id));
      const tipos = await tiposDasConsultas(tx, rs.filter((r) => r.c.modalidade === 'online').map((r) => r.c.id));
      return rs.map(({ c, nome, local, daPagina: pagina }): PedidoNaFila => ({
        tipo: 'consulta',
        id: c.id,
        patientId: c.patientId,
        nome,
        inicio: c.inicio,
        fim: c.fim,
        local,
        origem: pagina ? 'pagina' : 'app',
        pedidoEm: c.createdAt,
        respondaAte: prazoDoPedido(c.inicio, tenant),
        primeiraOnline: tipos.get(c.id) === 'primeira',
      }));
    },
    deps.db ?? getDb(),
  );
}

/** "Solicitações ({n})" (abas e Início, T8): quantos pedidos no prazo, na transação de quem chama (sessão `nutri`). */
export async function contarSolicitacoesNaTransacao(tx: Tx, tenant: Pick<TenantAgenda, 'antecedenciaMinH'>, agora: Date): Promise<number> {
  const [r] = await tx.select({ n: count() }).from(appointments).where(and(eq(appointments.status, 'solicitada'), noPrazo(tenant.antecedenciaMinH, agora)));
  return r.n;
}

/**
 * RN-427a: trava o paciente e depois a consulta, e devolve a consulta. Id inválido, de outro consultório ou de outro
 * paciente (RLS) é "já respondido ou venceu" — para quem age, o pedido que estava na tela não existe mais.
 */
async function travarPedido(tx: Tx, id: string) {
  if (!idValido(id)) throw new PedidoMudouError();
  const [antes] = await tx.select({ patientId: appointments.patientId }).from(appointments).where(eq(appointments.id, id));
  if (!antes) throw new PedidoMudouError();
  const [p] = await tx.select({ id: patients.id, nome: patients.nome, status: patients.status }).from(patients).where(eq(patients.id, antes.patientId)).for('no key update');
  const [c] = await tx.select().from(appointments).where(eq(appointments.id, id)).for('update');
  if (!p || !c || c.patientId !== p.id) throw new PedidoMudouError(); // patient_id não muda (gatilho); se mudar, não segue sem a trava certa
  return { c, p };
}

/** Sob a trava: ainda `solicitada` e no prazo (`inicio − antecedência > agora`), senão `PedidoMudouError`. */
function conferirNoPrazo(c: { status: string; inicio: Date }, tenant: Pick<TenantAgenda, 'antecedenciaMinH'>, agora: Date): void {
  if (c.status !== 'solicitada' || prazoDoPedido(c.inicio, tenant).getTime() <= agora.getTime()) throw new PedidoMudouError();
}

/**
 * US-409 "Aceitar": o pedido vira `agendada` (o gatilho só deixa a sessão `nutri`), com os lembretes, o "consulta marcada"
 * ao paciente e o envio já, na mesma transação (RN-428). Paciente arquivado: a nutricionista desarquiva antes (como em
 * `agendarPelaNutri`). A pessoa nova é da T7 (`aceitarPedidoPublico`): até lá, nenhum pedido aguardando existe.
 */
export async function aceitarSolicitacao(ctx: TenantContext, tenant: TenantAgenda, alvo: Alvo, deps: Deps = {}): Promise<void> {
  exigirNutri(ctx);
  if (alvo.tipo !== 'consulta') throw new PedidoMudouError(); // T7: aceitarPedidoPublico
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const { c, p } = await travarPedido(tx, alvo.id);
      conferirNoPrazo(c, tenant, agora);
      if (p.status !== 'ativo') throw new ConsultaError({ geral: MSG_AGENDA.pacienteArquivado });
      await tx.update(appointments).set({ status: 'agendada', updatedAt: agora }).where(eq(appointments.id, c.id));
      const aviso = { tenantId: ctx.tenantId, patientId: c.patientId, appointmentId: c.id, inicio: c.inicio };
      await agendarLembretes(tx, aviso, tenant.fuso, agora);
      await avisarPaciente(tx, aviso, 'consulta_marcada', agora);
      await dispararEnvio(tx, ctx.tenantId);
    },
    deps.db ?? getDb(),
  );
}

/**
 * US-409 "Recusar": `cancelada` com `pedido_recusado` e o motivo, que só a nutricionista vê (AG-D23: nunca no e-mail, no
 * push nem no portal); o paciente recebe o "não confirmado" por e-mail e push — nada por WhatsApp (RN-428).
 */
export async function recusarSolicitacao(ctx: TenantContext, tenant: TenantAgenda, alvo: Alvo & { motivo?: unknown }, deps: Deps = {}): Promise<void> {
  exigirNutri(ctx);
  const motivo = normalizarTexto(alvo.motivo);
  if (motivo.length > 300) throw new ConsultaError({ motivo: MSG_AGENDA.motivoCancelamentoLongo });
  if (alvo.tipo !== 'consulta') throw new PedidoMudouError(); // T7: a recusa da pessoa nova
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const { c } = await travarPedido(tx, alvo.id);
      conferirNoPrazo(c, tenant, agora);
      await tx
        .update(appointments)
        .set({ status: 'cancelada', canceladoPor: 'pedido_recusado', canceladaEm: agora, motivoCancelamento: motivo || null, updatedAt: agora })
        .where(eq(appointments.id, c.id));
      await cancelarLembretes(tx, c.id, agora);
      await avisarPaciente(tx, { tenantId: ctx.tenantId, patientId: c.patientId, appointmentId: c.id, inicio: c.inicio }, 'pedido_nao_confirmado', agora);
      await dispararEnvio(tx, ctx.tenantId);
    },
    deps.db ?? getDb(),
  );
}

/**
 * US-408 "Desistir do pedido" (portal, AG-D42, AG-D70): na sessão do paciente, o próprio pedido ainda no prazo vira
 * `cancelada` com `pedido_desistido` (nunca liga o marcador da remarcação: o gatilho garante) e a nutricionista recebe
 * "Pedido de consulta retirado" com o primeiro nome. Nada ao paciente.
 */
export async function desistirDoPedido(ctx: TenantContext, tenant: TenantAgenda, id: string, deps: Deps = {}): Promise<void> {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('desistirDoPedido exige sessão de paciente');
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const { c, p } = await travarPedido(tx, id); // RLS: só o próprio pedido
      conferirNoPrazo(c, tenant, agora);
      await tx.update(appointments).set({ status: 'cancelada', canceladoPor: 'pedido_desistido', canceladaEm: agora, updatedAt: agora }).where(eq(appointments.id, c.id));
      // o aviso da retirada leva só o primeiro nome (§6.2): recortado em avisarNutriDaConsulta
      await avisarNutriDaConsulta(tx, tenant, { id: c.id, inicio: c.inicio, paciente: p.nome }, 'pedido_desistido', deps.appUrl ?? getEnv().APP_URL);
    },
    deps.db ?? getDb(),
  );
}

/**
 * RN-427 / AG-D19 / AG-D67: vence os pedidos com `inicio − antecedencia_min_h ≤ agora` — `cancelada`/`pedido_vencido` e o
 * "não confirmado" ao paciente (RN-428). Seleciona sem trava; depois, **uma transação por pedido**, no papel `worker`,
 * com as travas da RN-427a e a reconferência (respondido ou desistido no meio: pula). O erro de um pedido vai ao log só
 * com o código (regra 3) e não para os outros. Com `tenantId`, só aquele consultório. Idempotente. Devolve quantos venceu.
 * A pessoa nova (aguardando) é da T7.
 */
export async function vencerSolicitacoes(db: Db, agora: Date, o: { tenantId?: string } = {}): Promise<number> {
  const alvos = o.tenantId ? [o.tenantId] : (await listarTenantsParaVarredura(db)).map((t) => t.id);
  let vencidos = 0;
  for (const tenantId of alvos) {
    const ctx: TenantContext = { tenantId, role: 'worker' };
    let candidatos: { id: string; antecedenciaMinH: number }[];
    try {
      candidatos = await withTenant(
        ctx,
        (tx) =>
          tx
            .select({ id: appointments.id, antecedenciaMinH: tenants.antecedenciaMinH })
            .from(appointments)
            .innerJoin(tenants, eq(tenants.id, appointments.tenantId))
            .where(and(eq(appointments.status, 'solicitada'), sql`${appointments.inicio} - make_interval(hours => ${tenants.antecedenciaMinH}) <= ${agora}`))
            .orderBy(asc(appointments.inicio)),
        db,
      );
    } catch (err) {
      logger.warn({ tenantId, err: nomeDoErro(err), sqlstate: sqlstateDoErro(err) }, 'falha ao listar os pedidos de consulta vencidos');
      continue;
    }
    for (const p of candidatos) {
      try {
        const venceu = await withTenant(
          ctx,
          async (tx) => {
            const { c } = await travarPedido(tx, p.id);
            if (c.status !== 'solicitada' || prazoDoPedido(c.inicio, p).getTime() > agora.getTime()) return false;
            await tx.update(appointments).set({ status: 'cancelada', canceladoPor: 'pedido_vencido', canceladaEm: agora, updatedAt: agora }).where(eq(appointments.id, c.id));
            await cancelarLembretes(tx, c.id, agora);
            await avisarPaciente(tx, { tenantId, patientId: c.patientId, appointmentId: c.id, inicio: c.inicio }, 'pedido_nao_confirmado', agora);
            return true;
          },
          db,
        );
        if (venceu) vencidos++;
      } catch (err) {
        if (err instanceof PedidoMudouError) continue; // sumiu no meio (não acontece: o pedido não se apaga); nada a vencer
        logger.warn({ tenantId, consultaId: p.id, err: nomeDoErro(err), sqlstate: sqlstateDoErro(err) }, 'falha ao vencer pedido de consulta');
      }
    }
  }
  return vencidos;
}
