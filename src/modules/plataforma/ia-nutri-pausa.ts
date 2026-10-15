import { and, eq, isNotNull, isNull } from 'drizzle-orm';
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

/**
 * /code-review do PR #37: idempotentes — pausar a já pausada (ou retomar a já retomada), de uma aba antiga, não reescreve
 * `pausada_em`/`pausada_por` nem grava outra linha em admin_actions. `true` = mudou.
 */
export async function pausarIaNutri(adminId: string, db: Db = getDb()): Promise<boolean> {
  const mudou = await db.transaction(async (tx) => {
    const agora = new Date();
    const r = await tx
      .update(iaNutriPausa)
      .set({ pausadaEm: agora, pausadaPor: adminId, updatedAt: agora })
      .where(and(eq(iaNutriPausa.id, true), isNull(iaNutriPausa.pausadaEm)))
      .returning({ id: iaNutriPausa.id });
    if (r.length) await tx.insert(adminActions).values({ adminUserId: adminId, acao: 'pausar_ia_nutri', origem: 'admin' });
    return r.length > 0;
  });
  if (mudou) logger.info({ adminId }, 'IA Nutri pausada na plataforma pelo admin (emergência)');
  return mudou;
}

export async function retomarIaNutri(adminId: string, db: Db = getDb()): Promise<boolean> {
  const mudou = await db.transaction(async (tx) => {
    const r = await tx
      .update(iaNutriPausa)
      .set({ pausadaEm: null, pausadaPor: null, updatedAt: new Date() })
      .where(and(eq(iaNutriPausa.id, true), isNotNull(iaNutriPausa.pausadaEm)))
      .returning({ id: iaNutriPausa.id });
    if (r.length) await tx.insert(adminActions).values({ adminUserId: adminId, acao: 'retomar_ia_nutri', origem: 'admin' });
    return r.length > 0;
  });
  if (mudou) logger.info({ adminId }, 'IA Nutri retomada na plataforma pelo admin (fim da pausa de emergência)');
  return mudou;
}
