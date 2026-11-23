import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { equipeMembros } from '@/db/schema';
import { withTenant } from '@/db/tenant';

/** Plano 26 (RN-502, RN-503): o que a sessão precisa da linha da recepção — ativa e com a permissão do Financeiro. */
export type MembroDaEquipe = { ativo: boolean; financeiro: boolean };

/**
 * A linha de `equipe_membros` da própria conta `recepcao`, lida pela sessão dela (`withTenant` com o papel `recepcao` e o
 * ator: a RLS só mostra a própria linha, `recepcao_cond_propria_linha`). Uma vez por requisição, junto com a sessão
 * (`lerSessaoDaRequisicao` em src/lib/session.ts e `autenticarApi` em src/lib/api-auth.ts; RN-504). `null` sem linha: a
 * sessão trata como desativada (falha fechada). A conta desativada nunca tem a permissão do Financeiro.
 */
export async function lerMembroDaEquipe(db: Db, tenantId: string, userId: string): Promise<MembroDaEquipe | null> {
  const [m] = await withTenant(
    { tenantId, role: 'recepcao', actorUserId: userId },
    (tx) =>
      tx
        .select({ desativadaEm: equipeMembros.desativadaEm, financeiro: equipeMembros.financeiro })
        .from(equipeMembros)
        .where(and(eq(equipeMembros.tenantId, tenantId), eq(equipeMembros.userId, userId))),
    db,
  );
  if (!m) return null;
  const ativo = m.desativadaEm === null;
  return { ativo, financeiro: ativo && m.financeiro };
}
