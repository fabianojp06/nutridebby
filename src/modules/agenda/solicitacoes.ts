import { and, asc, count, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { appointments, locaisAtendimento, patients, publicBookingRequests, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getEnv } from '@/env';
import { logger, nomeDoErro, sqlstateDoErro } from '@/lib/logger';
import { normalizarTexto } from '@/lib/text';
import { agendarLembretes, avisarPaciente, cancelarLembretes, dispararEnvio, emHorarioSilencioso, fimDoSilencio } from '@/modules/notificacoes/agendar';
import { idValido } from '@/modules/pacientes/base';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { travarPedidosDoTenant } from './agendamento-paciente';
import { aceitarPedidoPublico } from './agendamento-publico';
import { avisarNutriDaConsulta } from './aviso-nutri';
import { MSG_AGENDA } from './constantes';
import { ConsultaError, type TenantAgenda } from './consultas';
import { quandoComFuso } from './fuso';
import { linkDeOutroHorario } from './link-outro-horario';
import { PedidoMudouError } from './pedido-mudou';
import { prazoDoPedido } from './status';
import { tiposDasConsultas } from './visoes';

export { PedidoMudouError };

/**
 * Plano 23 (US-407 a US-409, RN-420 a RN-428): a fila "Solicitações" e as respostas ao pedido do paciente (a consulta
 * `solicitada`, que o gatilho appointments_regras_pedido decide a partir da chave). O banco recusa toda transição fora da
 * RN-422; aqui ficam as travas, a reconferência sob a trava e os avisos.
 *
 * Travas (RN-427a, AG-D65): paciente (`FOR NO KEY UPDATE`, que basta contra o `KEY SHARE` da FK de `notifications`) →
 * consulta (`FOR UPDATE`) → notificações, em aceitar, recusar, desistir e vencer. A pessoa nova (pedido aguardando em
 * `public_booking_requests`, T7): trava do tenant → linha do pedido (e, no aceite, o paciente do e-mail).
 *
 * AG-D75: o "não confirmado" (recusa e vencimento) que cairia entre 21h e 8h no fuso do consultório sai às 08:00 — a linha
 * de `notifications` do paciente com `agendada_para` e o e-mail da pessoa nova com o `startAfter` do pg-boss.
 *
 * Grafo de imports: nunca `notificacoes/enviar.ts`, `push.ts` nem `mensagens.ts` (o motor de envio só no worker).
 */

export type PedidoNaFila =
  | { tipo: 'consulta'; id: string; patientId: string; nome: string; inicio: Date; fim: Date; local: string | null; origem: 'app' | 'pagina'; pedidoEm: Date; respondaAte: Date; primeiraOnline: boolean }
  | { tipo: 'pessoa_nova'; id: string; nome: string; inicio: Date; fim: Date; local: string | null; origem: 'pagina'; pedidoEm: Date; respondaAte: Date };

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
/** O pedido da pessoa nova ainda aguardando a resposta (T7). */
const aguardandoResposta = and(isNotNull(publicBookingRequests.aguardandoDesde), isNull(publicBookingRequests.resolvidoEm));
/** AG-D75: o instante em que o aviso do "não confirmado" pode sair — já, ou às 08:00 se `agora` cai entre 21h e 8h. */
const quandoAvisar = (agora: Date, fuso: string) => (emHorarioSilencioso(agora, fuso) ? fimDoSilencio(agora, fuso) : agora);

/**
 * US-409: os pedidos de paciente que ainda estão no prazo, do que vence primeiro ao último (leitura preguiçosa: o vencido
 * e ainda não processado pela varredura não aparece, RN-427). `primeiraOnline`: consulta online com "Primeira consulta"
 * (RN-404, RN-416). A pessoa nova (T7): "Nova pessoa: {nome}" na tela, origem `pagina`, `pedidoEm` = quando passou a
 * aguardar; nunca o e-mail, o telefone nem o IP. Leitura da agenda: sem `auditRead` (RN-414).
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
      const limite = new Date(agora.getTime() + tenant.antecedenciaMinH * 3_600_000);
      const novas = await tx
        .select({
          id: publicBookingRequests.id,
          nome: publicBookingRequests.nome,
          inicio: publicBookingRequests.inicio,
          fim: publicBookingRequests.fim,
          desde: publicBookingRequests.aguardandoDesde,
          local: locaisAtendimento.nome,
        })
        .from(publicBookingRequests)
        .leftJoin(locaisAtendimento, and(eq(locaisAtendimento.tenantId, publicBookingRequests.tenantId), eq(locaisAtendimento.id, publicBookingRequests.localId)))
        .where(and(aguardandoResposta, gt(publicBookingRequests.inicio, limite)));
      const daPessoaNova = novas.map(
        (b): PedidoNaFila => ({ tipo: 'pessoa_nova', id: b.id, nome: b.nome, inicio: b.inicio, fim: b.fim ?? b.inicio, local: b.local, origem: 'pagina', pedidoEm: b.desde ?? b.inicio, respondaAte: prazoDoPedido(b.inicio, tenant) }),
      );
      const deConsulta = rs.map(({ c, nome, local, daPagina: pagina }): PedidoNaFila => ({
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
      return [...deConsulta, ...daPessoaNova].sort((a, b) => a.inicio.getTime() - b.inicio.getTime() || a.id.localeCompare(b.id));
    },
    deps.db ?? getDb(),
  );
}

/** "Solicitações ({n})" (abas e Início, T8): quantos pedidos no prazo, na transação de quem chama (sessão `nutri`). */
export async function contarSolicitacoesNaTransacao(tx: Tx, tenant: Pick<TenantAgenda, 'antecedenciaMinH'>, agora: Date): Promise<number> {
  const [r] = await tx.select({ n: count() }).from(appointments).where(and(eq(appointments.status, 'solicitada'), noPrazo(tenant.antecedenciaMinH, agora)));
  const limite = new Date(agora.getTime() + tenant.antecedenciaMinH * 3_600_000);
  const [b] = await tx.select({ n: count() }).from(publicBookingRequests).where(and(aguardandoResposta, gt(publicBookingRequests.inicio, limite)));
  return r.n + b.n;
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

type PedidoPublico = typeof publicBookingRequests.$inferSelect;

/**
 * Plano 23 (RN-425, AG-D65): a pessoa nova — trava do tenant e depois a linha do pedido; só segue o que ainda aguarda.
 * Id inválido ou de outro consultório (RLS) → `PedidoMudouError`.
 */
async function travarPedidoPublico(tx: Tx, tenantId: string, id: string): Promise<PedidoPublico> {
  if (!idValido(id)) throw new PedidoMudouError();
  await travarPedidosDoTenant(tx, tenantId);
  const [r] = await tx.select().from(publicBookingRequests).where(eq(publicBookingRequests.id, id)).for('update');
  if (!r?.aguardandoDesde || r.resolvidoEm) throw new PedidoMudouError();
  return r;
}

/**
 * Plano 23 (RN-428, AG-D23, AG-D63, AG-D75): a recusa ou o vencimento da pessoa nova — `resolvido_em` + `resolucao` e o
 * "Seu pedido de consulta não foi confirmado" (link da página pública só com ela ligada; nunca motivo), na mesma
 * transação, às 08:00 se cair no horário silencioso. Sem paciente: nada de `notifications`.
 */
async function resolverPedidoPublico(tx: Tx, r: PedidoPublico, resolucao: 'recusado' | 'vencido', fuso: string, agora: Date, appUrl: string): Promise<void> {
  await tx.update(publicBookingRequests).set({ resolvidoEm: agora, resolucao }).where(eq(publicBookingRequests.id, r.id));
  const [t] = await tx.select({ slug: tenants.slug, ativa: tenants.agendamentoPublicoAtivo }).from(tenants).where(eq(tenants.id, r.tenantId));
  const link = t ? linkDeOutroHorario({ daPagina: true, tenant: { id: r.tenantId, slug: t.slug, agendamentoPublicoAtivo: t.ativa } }, appUrl) : null;
  const sai = quandoAvisar(agora, fuso);
  await enqueueEmail(
    { tipo: 'pedido_nao_confirmado_publico', para: r.email, quando: quandoComFuso(r.inicio, fuso), link },
    { tenantId: r.tenantId, tx, ...(sai.getTime() === agora.getTime() ? {} : { startAfter: sai }) },
  );
}

/** Sob a trava: ainda `solicitada` e no prazo (`inicio − antecedência > agora`), senão `PedidoMudouError`. */
function conferirNoPrazo(c: { status: string; inicio: Date }, tenant: Pick<TenantAgenda, 'antecedenciaMinH'>, agora: Date): void {
  if (c.status !== 'solicitada' || prazoDoPedido(c.inicio, tenant).getTime() <= agora.getTime()) throw new PedidoMudouError();
}

/**
 * US-409 "Aceitar": o pedido vira `agendada` (o gatilho só deixa a sessão `nutri`), com os lembretes, o "consulta marcada"
 * ao paciente e o envio já, na mesma transação (RN-428). Paciente arquivado: a nutricionista desarquiva antes (como em
 * `agendarPelaNutri`). A pessoa nova (T7) delega a `aceitarPedidoPublico` (cadastro, aceite do termo e consulta); se a
 * nutricionista cadastrou o mesmo e-mail ao mesmo tempo (23505), uma segunda vez — agora o paciente existe.
 */
export async function aceitarSolicitacao(ctx: TenantContext, tenant: TenantAgenda, alvo: Alvo, deps: Deps = {}): Promise<void> {
  exigirNutri(ctx);
  const agora = deps.agora ?? new Date();
  if (alvo.tipo === 'pessoa_nova') {
    const o = { agora, appUrl: deps.appUrl ?? getEnv().APP_URL };
    for (let tentativa = 0; ; tentativa++) {
      try {
        await withTenant(ctx, (tx) => aceitarPedidoPublico(tx, tenant, alvo.id, o), deps.db ?? getDb());
        return;
      } catch (e) {
        if (tentativa === 0 && uniqueViolation(e) === 'patients_tenant_email_unique') continue;
        throw e;
      }
    }
  }
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
  const agora = deps.agora ?? new Date();
  if (alvo.tipo === 'pessoa_nova') {
    // AG-D23: sem motivo (texto livre por e-mail pode levar dado de saúde; o pedido some em 24 h) — o recebido é ignorado
    await withTenant(
      ctx,
      async (tx) => {
        const r = await travarPedidoPublico(tx, ctx.tenantId, alvo.id);
        if (prazoDoPedido(r.inicio, tenant).getTime() <= agora.getTime()) throw new PedidoMudouError();
        await resolverPedidoPublico(tx, r, 'recusado', tenant.fuso, agora, deps.appUrl ?? getEnv().APP_URL);
      },
      deps.db ?? getDb(),
    );
    return;
  }
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
      const sai = quandoAvisar(agora, tenant.fuso); // AG-D75
      await avisarPaciente(tx, { tenantId: ctx.tenantId, patientId: c.patientId, appointmentId: c.id, inicio: c.inicio }, 'pedido_nao_confirmado', agora, sai);
      if (sai.getTime() === agora.getTime()) await dispararEnvio(tx, ctx.tenantId);
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
 * A pessoa nova (T7): tenant → linha do pedido, `vencido` e o e-mail "não confirmado" (sem `notifications`: não há
 * paciente). AG-D75: no horário silencioso, os avisos saem às 08:00 no fuso do consultório.
 */
export async function vencerSolicitacoes(db: Db, agora: Date, o: { tenantId?: string; appUrl?: string } = {}): Promise<number> {
  const alvos = o.tenantId ? [o.tenantId] : (await listarTenantsParaVarredura(db)).map((t) => t.id);
  let vencidos = 0;
  for (const tenantId of alvos) {
    const ctx: TenantContext = { tenantId, role: 'worker' };
    type Candidato = { id: string; antecedenciaMinH: number; fuso: string };
    let candidatos: Candidato[];
    let novas: Candidato[];
    try {
      [candidatos, novas] = await withTenant(
        ctx,
        async (tx): Promise<[Candidato[], Candidato[]]> => [
          await tx
            .select({ id: appointments.id, antecedenciaMinH: tenants.antecedenciaMinH, fuso: tenants.fuso })
            .from(appointments)
            .innerJoin(tenants, eq(tenants.id, appointments.tenantId))
            .where(and(eq(appointments.status, 'solicitada'), sql`${appointments.inicio} - make_interval(hours => ${tenants.antecedenciaMinH}) <= ${agora}`))
            .orderBy(asc(appointments.inicio)),
          await tx
            .select({ id: publicBookingRequests.id, antecedenciaMinH: tenants.antecedenciaMinH, fuso: tenants.fuso })
            .from(publicBookingRequests)
            .innerJoin(tenants, eq(tenants.id, publicBookingRequests.tenantId))
            .where(and(aguardandoResposta, sql`${publicBookingRequests.inicio} - make_interval(hours => ${tenants.antecedenciaMinH}) <= ${agora}`))
            .orderBy(asc(publicBookingRequests.inicio)),
        ],
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
            // o job de minuto não espera trava alheia: 2 s e o erro cai no catch deste pedido (55P03), que volta na próxima volta
            await tx.execute(sql`select set_config('lock_timeout', '2s', true)`);
            const { c, p: titular } = await travarPedido(tx, p.id);
            if (c.status !== 'solicitada' || prazoDoPedido(c.inicio, p).getTime() > agora.getTime()) return false;
            await tx.update(appointments).set({ status: 'cancelada', canceladoPor: 'pedido_vencido', canceladaEm: agora, updatedAt: agora }).where(eq(appointments.id, c.id));
            await cancelarLembretes(tx, c.id, agora);
            // titular arquivado ou bloqueado (exclusão pedida, LGPD art. 18, IV): o pedido vence sem criar aviso para ele
            if (titular.status === 'ativo') {
              await avisarPaciente(tx, { tenantId, patientId: c.patientId, appointmentId: c.id, inicio: c.inicio }, 'pedido_nao_confirmado', agora, quandoAvisar(agora, p.fuso));
            }
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
    for (const b of novas) {
      try {
        const venceu = await withTenant(
          ctx,
          async (tx) => {
            await tx.execute(sql`select set_config('lock_timeout', '2s', true)`);
            const r = await travarPedidoPublico(tx, tenantId, b.id);
            if (prazoDoPedido(r.inicio, b).getTime() > agora.getTime()) return false;
            await resolverPedidoPublico(tx, r, 'vencido', b.fuso, agora, o.appUrl ?? getEnv().APP_URL);
            return true;
          },
          db,
        );
        if (venceu) vencidos++;
      } catch (err) {
        if (err instanceof PedidoMudouError) continue; // respondido ou desistido no meio
        logger.warn({ tenantId, pedidoId: b.id, err: nomeDoErro(err), sqlstate: sqlstateDoErro(err) }, 'falha ao vencer pedido de consulta');
      }
    }
  }
  return vencidos;
}
