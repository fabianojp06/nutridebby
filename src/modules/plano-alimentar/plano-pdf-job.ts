import { readFile } from 'node:fs/promises';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { mealPlans, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { CotaEsgotadaError, resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { COR_PADRAO } from '@/modules/plataforma/marca-constantes';
import { buscarTenant, listarTenantsParaVarredura, tenantIsActive } from '@/modules/plataforma/tenant-status';
import { lerPlanoNaTransacao } from './carregar';
import { renderizarPlano } from './plano-pdf';

/** Só o worker importa este arquivo (@react-pdf/renderer fica fora do grafo do Next). */
export type DadosJobPdf = { tenantId: string; planId: string };
export type DepsJobPdf = { db: Db; dataDir: string; now?: Date; ultimaTentativa: boolean; renderizar?: typeof renderizarPlano };

class JaProntoError extends Error {}
/**
 * O paciente foi bloqueado (pedido de exclusão atendido) ou anonimizado (US-018) antes da gravação: o PDF novo não é
 * gravado. Gerar é um tratamento novo do dado de quem pediu a exclusão; o prontuário dele fica só para consulta
 * (o PDF que já existia continua para download até a anonimização, que o apaga).
 */
class TitularComExclusaoError extends Error {}

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
        // Trava o paciente antes do plano (mesma ordem da publicação) e desiste se o bloqueio ou a anonimização chegou
        // antes; a anonimização, por sua vez, confere os anexos com o paciente travado (lgpd.ts).
        antesDaReserva: async (tx) => {
          const [pac] = await tx
            .select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm })
            .from(patients)
            .where(eq(patients.id, lido.patientId))
            .for('update');
          if (!pac || pac.status === 'bloqueado' || pac.anonimizadoEm) throw new TitularComExclusaoError();
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
    if (e instanceof TitularComExclusaoError) {
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

/** As tentativas do job terminam em minutos (fila `plano-pdf`: 3 tentativas, 30 s de espera com backoff, 120 s cada). */
export const PDF_PENDENTE_MAX_MS = 3600_000;

/**
 * Rede de segurança do "Seu PDF está sendo preparado" (como `expirarExportacoesVencidas` na exportação):
 * o worker que cai na última tentativa, o job que expira ou um erro de banco antes do `try` deixariam o plano
 * em 'pendente' para sempre, sem botão de nova tentativa. Pendente há mais de 1 h vira 'falhou' e o painel
 * oferece "Gerar o PDF de novo". Rodada periódica pelo worker (fila `expirar-plano-pdf`, de 15 em 15 min).
 * A idade conta do pedido do PDF (`pdf_pedido_em`), não do `updated_at`, que outras gravações renovam (arquivar a
 * versão anterior na publicação); plano pendente de antes da coluna, sem a data, mede pelo `updated_at`.
 * Um tenant com erro não para os outros. Devolve quantos planos viraram 'falhou'.
 */
export async function expirarPdfsPendentes(db: Db, now: Date, idadeMinMs = PDF_PENDENTE_MAX_MS): Promise<number> {
  const limite = new Date(now.getTime() - idadeMinMs);
  let expirados = 0;
  for (const t of await listarTenantsParaVarredura(db)) {
    try {
      const r = await withTenant(
        { tenantId: t.id, role: 'worker' },
        (tx) =>
          tx
            .update(mealPlans)
            .set({ pdfStatus: 'falhou', updatedAt: now })
            .where(and(eq(mealPlans.pdfStatus, 'pendente'), lt(sql`coalesce(${mealPlans.pdfPedidoEm}, ${mealPlans.updatedAt})`, limite)))
            .returning({ id: mealPlans.id }),
        db,
      );
      expirados += r.length;
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), tenantId: t.id }, 'falha ao expirar PDFs de plano pendentes');
    }
  }
  if (expirados) logger.warn({ planos: expirados }, 'PDFs de plano pendentes há mais de 1 h marcados como falhou');
  return expirados;
}
