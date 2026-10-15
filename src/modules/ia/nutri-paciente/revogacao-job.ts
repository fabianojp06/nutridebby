import { and, eq, lt } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { iaNutriConsentimentos, iaNutriMensagens, iaUso, patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { estornar, marcarIncerto } from '../cota';

export type DadosRevogacaoIaNutri = { tenantId: string; patientId: string; revogacaoId: string };

/**
 * RN-182 / D30: o estorno das reservas das perguntas canceladas pela revogação, no contexto worker, na ordem da cota:
 * paciente (FOR UPDATE) → tenant (FOR NO KEY UPDATE) → mensagens → ia_uso → plataforma. A que não saiu (sem enviado_em) é
 * estornada; a que saiu fica `incerto` (o provedor pode ter cobrado). Só as canceladas criadas ANTES desta revogação (uma
 * pergunta de depois de um novo consentimento não é dela). Idempotente (só age sobre `reservado`). Até este job rodar, o
 * portão e o passo 6 do job `ia-paciente` recusam a pergunta criada antes da revogação.
 */
export async function processarRevogacaoIaNutri(d: DadosRevogacaoIaNutri, deps: { db: Db; agora?: () => Date }): Promise<number> {
  const agora = (deps.agora ?? (() => new Date()))();
  const n = await withTenant(
    { tenantId: d.tenantId, role: 'worker' },
    async (tx) => {
      const [p] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, d.patientId)).for('update');
      if (!p) return 0;
      const [r] = await tx
        .select({ em: iaNutriConsentimentos.registradoEm })
        .from(iaNutriConsentimentos)
        .where(and(eq(iaNutriConsentimentos.id, d.revogacaoId), eq(iaNutriConsentimentos.patientId, p.id), eq(iaNutriConsentimentos.evento, 'revogacao')));
      if (!r) return 0;
      await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, d.tenantId)).for('no key update');
      const canceladas = await tx
        .select({ id: iaNutriMensagens.id, enviadoEm: iaNutriMensagens.enviadoEm })
        .from(iaNutriMensagens)
        .innerJoin(iaUso, and(eq(iaUso.tarefaId, iaNutriMensagens.id), eq(iaUso.situacao, 'reservado')))
        .where(and(eq(iaNutriMensagens.patientId, p.id), eq(iaNutriMensagens.autor, 'paciente'), eq(iaNutriMensagens.status, 'cancelada'), lt(iaNutriMensagens.createdAt, r.em)))
        .orderBy(iaNutriMensagens.id)
        .for('update', { of: iaNutriMensagens });
      for (const m of canceladas) {
        if (m.enviadoEm) await marcarIncerto(tx, m.id, agora);
        else await estornar(tx, m.id, agora);
      }
      return canceladas.length;
    },
    deps.db,
  );
  logger.info({ tenantId: d.tenantId, estornadas: n }, 'revogação da IA Nutri: reservas conciliadas');
  return n;
}
