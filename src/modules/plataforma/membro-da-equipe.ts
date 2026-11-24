import { and, eq, sql } from 'drizzle-orm';
import type { Db, Queryable } from '@/db/client';
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

/**
 * RN-500: grava o aceite do Termo de confidencialidade da equipe em vigor (`SIGILO_EQUIPE_TERMO`) em `consents`, com a conta
 * da recepção, o consultório e o IP — o mesmo registro no convite (`aceitarConvite`, convites.ts) e no aceite da versão
 * nova (`aceitarTermoPendente`). `consents` é só de inclusão (0009): o aceite repetido não muda nada.
 */
export async function registrarAceiteDoSigilo(q: Queryable, a: { userId: string; tenantId: string; ip: string | null; now?: Date }): Promise<void> {
  await q
    .insert(consents)
    .values({ userId: a.userId, tenantId: a.tenantId, termoVersao: SIGILO_EQUIPE_TERMO, aceitoEm: a.now ?? new Date(), ip: a.ip })
    .onConflictDoNothing();
}

/**
 * Revisão do code review do PR 2 do Plano 26 (RN-500): o termo numa versão nova não tranca a recepção — a conta ativa, sem o
 * aceite da versão em vigor, aceita em /conta/acesso-desativado. Confere de novo, na mesma transação da sessão da recepção
 * (a RLS só mostra a própria linha), que a linha de `equipe_membros` existe e está ativa; a conta desativada (ou sem linha)
 * recebe `sem_acesso` e nada é gravado. O papel, o 2FA e o aceite ainda pendente são conferidos pela action, na sessão.
 */
export async function aceitarTermoPendente(
  db: Db,
  a: { tenantId: string; userId: string; ip: string | null; now?: Date },
): Promise<'aceito' | 'sem_acesso'> {
  return withTenant(
    { tenantId: a.tenantId, role: 'recepcao', actorUserId: a.userId, ip: a.ip },
    async (tx) => {
      const [m] = await tx
        .select({ desativadaEm: equipeMembros.desativadaEm })
        .from(equipeMembros)
        .where(and(eq(equipeMembros.tenantId, a.tenantId), eq(equipeMembros.userId, a.userId)));
      if (!m || m.desativadaEm !== null) return 'sem_acesso';
      await registrarAceiteDoSigilo(tx, a);
      return 'aceito';
    },
    db,
  );
}
