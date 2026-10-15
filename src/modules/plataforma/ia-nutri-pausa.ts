import { eq } from 'drizzle-orm';
import { getDb, type Db, type Queryable } from '@/db/client';
import { adminActions, iaNutriPausa } from '@/db/schema';
import { logger } from '@/lib/logger';

/**
 * Plano 15 (RN-185, DP-1, ★ DO-1 = não): o DESLIGAMENTO DE EMERGÊNCIA da IA Nutri em todos os consultórios — a linha
 * única fora da RLS, que nasce não pausada (a IA Nutri liga pela nutricionista). Só o painel do admin escreve (fora do
 * contexto de tenant; o gatilho ia_nutri_pausa_da_admin recusa com app.role preenchido); qualquer contexto lê.
 * Vale na PRÓXIMA pergunta (o módulo, a função e o job leem a cada pergunta). Trilha em admin_actions (NGS1.07.03, ★ DO-5).
 */
export type PausaIaNutri = { pausadaEm: Date | null };

export async function lerPausa(q: Queryable): Promise<PausaIaNutri> {
  const [l] = await q.select({ pausadaEm: iaNutriPausa.pausadaEm }).from(iaNutriPausa).where(eq(iaNutriPausa.id, true));
  // sem a linha (não deveria acontecer): pausada, por segurança. Nunca `l?.pausadaEm ?? …`: a linha existe com
  // `pausada_em` nulo (o estado normal, ★ DO-1 = não) e o `??` a leria como pausada.
  return { pausadaEm: l ? l.pausadaEm : new Date(0) };
}

export async function pausarIaNutri(adminId: string, db: Db = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    const agora = new Date();
    await tx.update(iaNutriPausa).set({ pausadaEm: agora, pausadaPor: adminId, updatedAt: agora }).where(eq(iaNutriPausa.id, true));
    await tx.insert(adminActions).values({ adminUserId: adminId, acao: 'pausar_ia_nutri', origem: 'admin' });
  });
  logger.info({ adminId }, 'IA Nutri pausada na plataforma pelo admin (emergência)');
}

export async function retomarIaNutri(adminId: string, db: Db = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(iaNutriPausa).set({ pausadaEm: null, pausadaPor: null, updatedAt: new Date() }).where(eq(iaNutriPausa.id, true));
    await tx.insert(adminActions).values({ adminUserId: adminId, acao: 'retomar_ia_nutri', origem: 'admin' });
  });
  logger.info({ adminId }, 'IA Nutri retomada na plataforma pelo admin (fim da pausa de emergência)');
}
