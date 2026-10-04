import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db, type Tx } from '@/db/client';
import { notifications, pushSubscriptions } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import type { PacienteAccess } from '@/lib/paciente-session';
import { vinculosDaConta, type Vinculo } from './vinculos';
import { dispararEnvio } from '@/modules/notificacoes/agendar';
import { endpointDePush } from '@/modules/notificacoes/push-endpoint';

export const MSG_PUSH = {
  indisponivel: 'Notificações no app ainda não estão disponíveis.',
  ativadas: 'Notificações ativadas neste aparelho.',
  bloqueadas: 'Você bloqueou as notificações. Para ativar, mude a permissão do site nas configurações do navegador.',
  falhou: 'Não foi possível ativar as notificações. Tente de novo.',
} as const;

export class InscricaoInvalidaError extends Error {
  override name = 'InscricaoInvalidaError';
}

// O formato que PushSubscription.toJSON() entrega; os mesmos limites dos CHECKs de push_subscriptions (Plano 05)
const inscricao = z.object({
  endpoint: z.string().max(1000).refine(endpointDePush),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{16,30}$/) }),
});

type Acesso = Pick<PacienteAccess, 'ctx' | 'vinculos' | 'data'>;

/** A conta que cancela o aparelho: só a sessão de paciente (o "Sair" de /p/termo, /p/escolher, /p/sem-acesso, /indisponivel). */
export type ContaDoAparelho = { userId: string; ip: string | null | undefined };

/** O contexto de paciente de um vínculo da conta (cada um no próprio tenant). */
const ctxDoVinculo = (conta: ContaDoAparelho, v: Pick<Vinculo, 'tenantId' | 'patientId'>): TenantContext => ({
  tenantId: v.tenantId,
  role: 'paciente',
  patientId: v.patientId,
  actorUserId: conta.userId,
  ip: conta.ip,
});

/** Um clique em "Ativar" a cada minuto basta: o teste já pedido serve para os cliques seguintes. */
const JANELA_TESTE_MS = 60_000;

/**
 * Revisão da T6: repetir POST /api/p/push não enche `notifications` nem a fila do motor (os lembretes do consultório
 * ficariam atrás dos testes, RN-05). Há teste deste paciente ainda na fila (pendente/enviando) ou pedido há menos de
 * 1 minuto → não pede outro. A trava (advisory, por paciente) serializa cliques simultâneos até o commit.
 */
async function testeRecente(tx: Tx, patientId: string, agora: Date): Promise<boolean> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('push-teste'), hashtext(${patientId}))`);
  const [r] = await tx
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.patientId, patientId),
        eq(notifications.tipo, 'push_teste'),
        or(inArray(notifications.status, ['pendente', 'enviando']), gt(notifications.agendadaPara, new Date(agora.getTime() - JANELA_TESTE_MS))),
      ),
    )
    .limit(1);
  return r !== undefined;
}

/**
 * US-040 "Permissão de push" / contrato D14 do Plano 05: o aparelho recebe os avisos de todos os vínculos ativos da conta
 * (uma linha por vínculo, cada uma no próprio tenant, transações separadas — uma conexão por transação) e o vínculo
 * atual ganha o push de teste "Notificações ativadas ✅" (pelo motor de notificações, D7).
 * Review Focus 4: antes de tudo o endpoint sai de TODA outra conta (app_soltar_endpoint_push) — num aparelho
 * compartilhado, os avisos do paciente anterior param de chegar. `sincronizar` (abertura do portal com inscrição no
 * navegador): sem push de teste, e só grava se o endpoint já era desta conta (vínculo novo ganha a linha); se era de
 * outra conta (ou de ninguém), nada é gravado e o cliente descarta a inscrição — B só recebe push depois de ativar.
 */
export async function inscreverAparelho(
  acesso: Acesso,
  entrada: unknown,
  userAgent: string | null,
  deps: { db?: Db; agora?: Date; sincronizar?: boolean } = {},
): Promise<'inscrito' | 'de_outra_conta'> {
  const p = inscricao.safeParse(entrada);
  if (!p.success) throw new InscricaoInvalidaError('inscrição de push inválida');
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const ua = userAgent ? userAgent.slice(0, 300) : null;
  const daConta = await withTenant(
    acesso.ctx,
    async (tx) => {
      const r = await tx.execute<{ da_conta: boolean }>(sql`select app_soltar_endpoint_push(${p.data.endpoint}) as da_conta`);
      return r.rows[0]?.da_conta === true;
    },
    db,
  );
  if (deps.sincronizar && !daConta) return 'de_outra_conta';
  for (const v of acesso.vinculos) {
    await withTenant(
      ctxDoVinculo({ userId: acesso.data.user.id, ip: acesso.ctx.ip }, v),
      async (tx) => {
        await tx
          .insert(pushSubscriptions)
          .values({ tenantId: v.tenantId, patientId: v.patientId, endpoint: p.data.endpoint, p256dh: p.data.keys.p256dh, auth: p.data.keys.auth, userAgent: ua })
          .onConflictDoNothing();
        if (deps.sincronizar || v.tenantId !== acesso.ctx.tenantId) return;
        if (await testeRecente(tx, v.patientId, agora)) return;
        await tx.insert(notifications).values({ tenantId: v.tenantId, patientId: v.patientId, canal: 'push', tipo: 'push_teste', agendadaPara: agora });
        await dispararEnvio(tx, v.tenantId);
      },
      db,
    );
  }
  return 'inscrito';
}

/**
 * "Sair" / desativar: o endpoint deste aparelho sai de TODOS os vínculos da conta (inclusive o de consultório suspenso, o
 * de termo pendente — S-2, o "Sair" de /p/termo, /p/escolher e /indisponivel só tem a sessão — e o arquivado ou
 * bloqueado, o "Sair" de /p/sem-acesso: desarquivado, o aparelho, talvez de outra pessoa, voltaria a receber avisos).
 */
export async function cancelarAparelho(conta: ContaDoAparelho, endpoint: unknown, deps: { db?: Db } = {}): Promise<void> {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return;
  const db = deps.db ?? getDb();
  for (const v of await vinculosDaConta(conta.userId, { db, todos: true })) {
    await withTenant(
      ctxDoVinculo(conta, v),
      (tx) => tx.delete(pushSubscriptions).where(and(eq(pushSubscriptions.patientId, v.patientId), eq(pushSubscriptions.endpoint, endpoint))),
      db,
    );
  }
}
