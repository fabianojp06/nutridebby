import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import type { Db } from '@/db/client';
import { iaNutriMensagens, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { urlDoApp } from '@/lib/url-do-app';
import { avisarNutri } from '@/modules/agenda/aviso-nutri';

/** D10 / DP-6: no máximo 1 e-mail de sinal de risco a cada 15 min por tenant. */
export const JANELA_AVISO_RISCO_MS = 15 * 60_000;
const FILA = 'ia-nutri-risco';

/**
 * D10 = (a), DP-6: o e-mail genérico "Há uma mensagem de paciente que precisa da sua atenção." às nutricionistas do tenant,
 * no máximo 1 a cada 15 min (marca em `tenants.ia_nutri_risco_aviso_em`, conferida e gravada com o tenant travado FOR NO KEY
 * UPDATE — nunca FOR UPDATE, molde de exames-enviados-aviso.ts). Sem nome, texto nem categoria (C-05, RNF-166). Só se ainda
 * houver pergunta com risco na fila, não aberta e não resolvida. Dentro da janela, o aviso é ADIADO (nunca descartado): um
 * job para o fim da janela, na mesma transação, com `singletonKey` = tenant — e só se ainda não houver um pendente com essa
 * chave (R7 do pre-flight: com a política `standard` das filas, o pg-boss 12 não deduplica pela chave; a consulta, com o
 * tenant travado, é que garante um pendente por tenant).
 */
export async function avisarRiscoIaNutri(
  d: { tenantId: string },
  deps: { db: Db; appUrl: string; agora?: () => Date; boss?: PgBoss },
): Promise<'enviado' | 'adiado' | 'nada'> {
  const agora = (deps.agora ?? (() => new Date()))();
  const boss = deps.boss ?? (await getBoss());
  return withTenant(
    { tenantId: d.tenantId, role: 'worker' },
    async (tx) => {
      const [t] = await tx.select({ em: tenants.iaNutriRiscoAvisoEm }).from(tenants).where(eq(tenants.id, d.tenantId)).for('no key update');
      if (!t) return 'nada';
      const [aberto] = await tx
        .select({ id: iaNutriMensagens.id })
        .from(iaNutriMensagens)
        .where(
          and(
            eq(iaNutriMensagens.tenantId, d.tenantId),
            isNotNull(iaNutriMensagens.risco),
            isNotNull(iaNutriMensagens.encaminhadaEm),
            isNull(iaNutriMensagens.abertaPelaNutriEm),
            isNull(iaNutriMensagens.resolvidaEm),
          ),
        )
        .limit(1);
      if (!aberto) return 'nada';
      if (t.em && agora.getTime() - t.em.getTime() < JANELA_AVISO_RISCO_MS) {
        const db = fromDrizzle(tx, sql);
        const pendentes = await boss.findJobs(FILA, { key: d.tenantId, queued: true, db });
        if (!pendentes.length) {
          const startAfter = new Date(t.em.getTime() + JANELA_AVISO_RISCO_MS);
          const job = await boss.send(FILA, { tenantId: d.tenantId }, { db, startAfter, singletonKey: d.tenantId });
          if (!job) throw new Error('A fila recusou o aviso de risco adiado da IA Nutri');
        }
        return 'adiado';
      }
      await tx.update(tenants).set({ iaNutriRiscoAvisoEm: agora }).where(eq(tenants.id, d.tenantId));
      const link = urlDoApp(deps.appUrl, '/painel/duvidas');
      await avisarNutri(tx, d.tenantId, (para) => ({ tipo: 'risco_ia_nutri', para, link }));
      return 'enviado';
    },
    deps.db,
  );
}
