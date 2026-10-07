import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { registrarAceiteAditivoIa } from '@/modules/plataforma/dpa';
import { cancelarTarefas } from './cancelar';
import { MSG_IA } from './constantes';
import { IA_ADITIVO_VERSAO } from './textos-legais';

export const MSG_ATIVACAO = {
  naoLiberada: MSG_IA.naoLiberada,
  aceite: 'Para ativar, marque a caixa de aceite do aditivo de inteligência artificial.',
} as const;

export class AtivacaoIaError extends Error {
  override name = 'AtivacaoIaError';
  constructor(readonly mensagem: string) {
    super(mensagem);
  }
}

/**
 * US-101: a nutricionista ativa a IA do consultório aceitando o aditivo (A-D20). Só com a IA liberada pela admin (A-06).
 * `userId` e `tenantId` vêm SEMPRE da sessão (`requireNutri`: a usuária é nutricionista deste tenant) — nunca do
 * formulário; por isso não se lê a tabela `user` aqui (regra 1).
 */
export async function ativarIa(a: { userId: string; tenantId: string; ip: string | null }, aceite: boolean, deps: { db?: Db; agora?: Date } = {}): Promise<void> {
  if (!aceite) throw new AtivacaoIaError(MSG_ATIVACAO.aceite);
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const aceiteNovo = await db.transaction(async (tx) => {
    const [t] = await tx.select({ liberada: tenants.iaLiberada, status: tenants.status }).from(tenants).where(eq(tenants.id, a.tenantId)).for('no key update');
    if (!t?.liberada || t.status !== 'ativa') throw new AtivacaoIaError(MSG_ATIVACAO.naoLiberada);
    return registrarAceiteAditivoIa(tx, { ...a, now: agora });
  });
  // D21 (NGS1.07): a reativação da mesma versão não grava `consents` novo (onConflictDoNothing); toda ativação deixa
  // trilha no log, como a desativação (só ids, sem IP)
  logger.info({ tenantId: a.tenantId, userId: a.userId, aditivoVersao: IA_ADITIVO_VERSAO, aceiteNovo }, 'IA ativada pela nutricionista');
}

/** US-101 "Desativar": a IA some do painel; fila e sugestões canceladas (conteúdo esvaziado, linhas ficam). */
export async function desativarIa(ctx: TenantContext, deps: { db?: Db; agora?: Date } = {}): Promise<void> {
  const agora = deps.agora ?? new Date();
  const canceladas = await withTenant(
    ctx,
    async (tx) => {
      await tx.update(tenants).set({ iaAtivadaEm: null, updatedAt: agora }).where(eq(tenants.id, ctx.tenantId)); // trava o tenant primeiro (ordem da cota)
      return cancelarTarefas(tx, { agora, por: ctx.actorUserId ?? null });
    },
    deps.db ?? getDb(),
  );
  // D21 (NGS1.07): `tenants` não é auditada e a ativação fica em `consents`; a desativação deixa trilha no log (só ids)
  logger.info({ tenantId: ctx.tenantId, actorUserId: ctx.actorUserId ?? null, canceladas }, 'IA desativada pela nutricionista');
}
