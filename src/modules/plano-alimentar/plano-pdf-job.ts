import { readFile } from 'node:fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { mealPlans, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { CotaEsgotadaError, resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { COR_PADRAO } from '@/modules/plataforma/marca-constantes';
import { buscarTenant, tenantIsActive } from '@/modules/plataforma/tenant-status';
import { lerPlanoNaTransacao } from './carregar';
import { renderizarPlano } from './plano-pdf';

/** Só o worker importa este arquivo (@react-pdf/renderer fica fora do grafo do Next). */
export type DadosJobPdf = { tenantId: string; planId: string };
export type DepsJobPdf = { db: Db; dataDir: string; now?: Date; ultimaTentativa: boolean; renderizar?: typeof renderizarPlano };

class JaProntoError extends Error {}
/** O paciente foi anonimizado (US-018) antes da gravação: o PDF não deve ficar no disco depois disso. */
class PacienteAnonimizadoError extends Error {}

/**
 * US-026 "Geração na publicação": lê o plano publicado (valores congelados, D10), gera o PDF com a marca
 * (D14) e grava pdf_path + pdf_status = 'pronto' no `registrar` de salvarArquivo (CLAUDE.md regra 9).
 * Idempotente: só age com pdf_status = 'pendente'. Cota esgotada ou última tentativa → 'falhou'.
 * Ordem de travas, a mesma da publicação: paciente (`antesDaReserva`) → tenant (cota) → plano (`registrar`).
 */
export async function gerarPdfDoPlano(data: DadosJobPdf, deps: DepsJobPdf): Promise<'pronto' | 'ignorado' | 'falhou'> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  const marcarFalhou = () =>
    withTenant(ctx, (tx) => tx.update(mealPlans).set({ pdfStatus: 'falhou', updatedAt: now }).where(and(eq(mealPlans.id, data.planId), eq(mealPlans.pdfStatus, 'pendente'))), db);
  if (!(await tenantIsActive(db, data.tenantId))) {
    await marcarFalhou();
    return 'ignorado';
  }
  const lido = await withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx
        .select({ id: mealPlans.id, patientId: mealPlans.patientId })
        .from(mealPlans)
        .where(and(eq(mealPlans.id, data.planId), eq(mealPlans.pdfStatus, 'pendente'), inArray(mealPlans.status, ['publicado', 'arquivado'])));
      if (!p?.patientId) return null;
      const [pac] = await tx.select({ nome: patients.nome }).from(patients).where(eq(patients.id, p.patientId));
      // o worker não é usuário: a leitura não vira "ler" no histórico de acessos; a publicação já foi auditada
      const plano = await lerPlanoNaTransacao(tx, p.id, { auditar: false });
      return plano && pac ? { plano, paciente: pac.nome, patientId: p.patientId } : null;
    },
    db,
  );
  if (!lido) return 'ignorado';
  try {
    const tenant = (await buscarTenant(db, data.tenantId))!;
    const logo = tenant.logoPath ? await readFile(resolverCaminho(deps.dataDir, tenant.logoPath)).catch(() => null) : null;
    const pdf = await (deps.renderizar ?? renderizarPlano)({
      plano: lido.plano,
      nutricionista: { nome: tenant.nomeExibicao, crn: tenant.crn },
      paciente: lido.paciente,
      data: formatarData(hojeNoFuso(tenant.fuso, lido.plano.publicadoEm ? new Date(lido.plano.publicadoEm) : now)),
      cor: tenant.corPrimaria ?? COR_PADRAO,
      logo,
    });
    await salvarArquivo(
      ctx,
      {
        tipo: 'plano_pdf',
        conteudo: pdf,
        permitidos: ['pdf'],
        // Trava o paciente antes do plano (mesma ordem da publicação) e desiste se a anonimização chegou antes;
        // a anonimização, por sua vez, confere os anexos com o paciente travado (lgpd.ts).
        antesDaReserva: async (tx) => {
          const [pac] = await tx
            .select({ anonimizadoEm: patients.anonimizadoEm })
            .from(patients)
            .where(eq(patients.id, lido.patientId))
            .for('update');
          if (!pac || pac.anonimizadoEm) throw new PacienteAnonimizadoError();
        },
        registrar: async (tx, arq) => {
          const r = await tx
            .update(mealPlans)
            .set({ pdfPath: arq.caminho, pdfStatus: 'pronto', updatedAt: now })
            .where(and(eq(mealPlans.id, data.planId), eq(mealPlans.pdfStatus, 'pendente')))
            .returning({ id: mealPlans.id });
          if (!r.length) throw new JaProntoError();
        },
      },
      { db, dataDir: deps.dataDir },
    );
    return 'pronto';
  } catch (e) {
    if (e instanceof JaProntoError) return 'ignorado';
    if (e instanceof PacienteAnonimizadoError) {
      await marcarFalhou();
      return 'ignorado';
    }
    if (e instanceof CotaEsgotadaError || deps.ultimaTentativa) {
      logger.warn({ planId: data.planId, tenantId: data.tenantId, motivo: e instanceof CotaEsgotadaError ? 'cota' : 'erro' }, 'PDF do plano não gerado');
      await marcarFalhou();
      return 'falhou';
    }
    throw e; // pg-boss tenta de novo
  }
}
