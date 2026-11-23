import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { consents, equipeMembros } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { SIGILO_EQUIPE_TERMO } from './textos-versionados';

/**
 * Plano 26 (RN-500, RN-502, RN-503): o que a sessão precisa da linha da recepção — ativa, com a permissão do Financeiro e
 * com o Termo de confidencialidade da equipe da versão em vigor aceito neste consultório.
 */
export type MembroDaEquipe = { ativo: boolean; financeiro: boolean; termoAceito: boolean };

/**
 * A linha de `equipe_membros` da própria conta `recepcao`, lida pela sessão dela (`withTenant` com o papel `recepcao` e o
 * ator: a RLS só mostra a própria linha, `recepcao_cond_propria_linha`). Uma vez por requisição, junto com a sessão
 * (`lerSessaoDaRequisicao` em src/lib/session.ts e `autenticarApi` em src/lib/api-auth.ts; RN-504). `null` sem linha: a
 * sessão trata como desativada (falha fechada). A conta desativada nunca tem a permissão do Financeiro.
 * Revisão da P26-07 (RN-500, Res. CFN 599, art. 20, I): na mesma transação, o aceite do termo (`consents`: esta conta, este
 * consultório e `SIGILO_EQUIPE_TERMO`). Sem ele — a senha criada por "Esqueci minha senha", sem passar pelo convite —, a
 * sessão recusa como a desativada (`termoAceito: false`): nada do painel nem da API abre.
 */
export async function lerMembroDaEquipe(db: Db, tenantId: string, userId: string): Promise<MembroDaEquipe | null> {
  const [m] = await withTenant(
    { tenantId, role: 'recepcao', actorUserId: userId },
    (tx) =>
      tx
        .select({
          desativadaEm: equipeMembros.desativadaEm,
          financeiro: equipeMembros.financeiro,
          termoAceito: sql<boolean>`exists (select 1 from ${consents} c where c.user_id = ${userId} and c.tenant_id = ${tenantId} and c.termo_versao = ${SIGILO_EQUIPE_TERMO})`,
        })
        .from(equipeMembros)
        .where(and(eq(equipeMembros.tenantId, tenantId), eq(equipeMembros.userId, userId))),
    db,
  );
  if (!m) return null;
  const ativo = m.desativadaEm === null;
  return { ativo, financeiro: ativo && m.financeiro, termoAceito: m.termoAceito === true };
}
