import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { consents, equipeMembros } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import type { Auth } from '@/lib/auth';
import { SIGILO_EQUIPE_TERMO } from '@/modules/plataforma/textos-versionados';
import { criarEEntrar } from './sessao';

/**
 * Plano 26 (RN-498, RN-502, RN-503): conta `recepcao` do consultório com login e a linha de `equipe_membros` gravada pela
 * sessão `nutri` com ator (o gatilho `equipe_membros_regras` recusa `worker` e o contexto vazio). Por padrão com o 2FA
 * ligado (depois do login, como o admin de `criarEEntrar`), sem a permissão do Financeiro e ativa. Com o aceite do Termo de
 * confidencialidade da equipe em vigor (RN-500; revisão da P26-07: sem ele a sessão recusa), salvo `semTermo`.
 */
export async function recepcaoComLogin(
  db: Db,
  auth: Auth,
  tenantId: string,
  o: { financeiro?: boolean; twoFactorEnabled?: boolean; desativada?: boolean; nutriId?: string; semTermo?: boolean } = {},
): Promise<{ id: string; email: string; cookie: string }> {
  const r = await criarEEntrar(db, auth, { appRole: 'recepcao', tenantId, twoFactorEnabled: o.twoFactorEnabled ?? true });
  const nutri: TenantContext = { tenantId, role: 'nutri', actorUserId: o.nutriId ?? randomUUID() };
  await withTenant(nutri, (tx) => tx.insert(equipeMembros).values({ tenantId, userId: r.id, papel: 'recepcao', financeiro: o.financeiro ?? false, convidadaPor: nutri.actorUserId! }), db);
  if (!o.semTermo) await db.insert(consents).values({ userId: r.id, tenantId, termoVersao: SIGILO_EQUIPE_TERMO, ip: null });
  if (o.desativada) await desativarRecepcao(db, tenantId, r.id);
  return r;
}

/** A nutricionista desativa a conta (RN-503): o gatilho grava `desativada_em` e `desativada_por`. */
export async function desativarRecepcao(db: Db, tenantId: string, userId: string): Promise<void> {
  const nutri: TenantContext = { tenantId, role: 'nutri', actorUserId: randomUUID() };
  await withTenant(nutri, (tx) => tx.update(equipeMembros).set({ desativadaEm: new Date(), desativadaPor: nutri.actorUserId! }).where(eq(equipeMembros.userId, userId)), db);
}

/** A nutricionista dá ou tira a permissão do Financeiro (RN-502). */
export async function permissaoDoFinanceiro(db: Db, tenantId: string, userId: string, financeiro: boolean): Promise<void> {
  await withTenant({ tenantId, role: 'nutri', actorUserId: randomUUID() }, (tx) => tx.update(equipeMembros).set({ financeiro }).where(eq(equipeMembros.userId, userId)), db);
}
