import { and, desc, eq, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db } from '@/db/client';
import { dataExports, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { recordAudit } from '@/modules/plataforma/audit';
import { idValido, PacienteNaoEncontradoError } from './base';

export const EXPORTACAO_VALIDADE_MS = 24 * 60 * 60 * 1000; // US-018: link válido por 24 h
/** Pendente há mais que isto = o job se perdeu (3 tentativas de até 5 min + espera): um pedido novo é criado. */
export const PENDENTE_MAX_MS = 30 * 60 * 1000;

export const MSG_EXPORTACAO = {
  anonimizado:
    'Os dados de identificação deste paciente já foram anonimizados: não há exportação a gerar.',
} as const;

export class ExportacaoIndisponivelError extends Error {
  override name = 'ExportacaoIndisponivelError';
}

export type EstadoExportacao =
  | { estado: 'pendente' }
  | { estado: 'pronta'; caminho: string; expiraEm: Date }
  | { estado: 'expirada' }
  | { estado: 'falhou' }
  | { estado: 'inexistente' };

export function linkDaExportacao(appUrl: string, patientId: string, exportId: string): string {
  return `${appUrl.replace(/\/$/, '')}/painel/pacientes/${patientId}/exportacoes/${exportId}`;
}

/**
 * "Exportar dados": grava o pedido, o `exportar` no audit_log e o job na mesma transação. Um pedido
 * ainda sendo gerado é reaproveitado (duplo clique não gera dois ZIPs); pendente há mais de 30 min é
 * dado como perdido (job expirado, worker que caiu): vira "falhou" e nasce outro. Vale também para bloqueado.
 */
export async function solicitarExportacao(
  ctx: TenantContext,
  patientId: string,
  deps: { db?: Db; now?: Date; boss?: PgBoss } = {},
): Promise<string> {
  if (!idValido(patientId)) throw new PacienteNaoEncontradoError();
  const boss = deps.boss ?? (await getBoss());
  const now = deps.now ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx
        .select({ id: patients.id, anonimizadoEm: patients.anonimizadoEm })
        .from(patients)
        .where(eq(patients.id, patientId))
        .for('update');
      if (!p) throw new PacienteNaoEncontradoError();
      // O job desistiria de qualquer forma (exportacao-job.ts): recusar aqui evita um "falhou" sem saída
      if (p.anonimizadoEm) throw new ExportacaoIndisponivelError(MSG_EXPORTACAO.anonimizado);
      const [pendente] = await tx
        .select({ id: dataExports.id, createdAt: dataExports.createdAt })
        .from(dataExports)
        .where(and(eq(dataExports.patientId, p.id), eq(dataExports.status, 'pendente')));
      if (pendente && now.getTime() - pendente.createdAt.getTime() <= PENDENTE_MAX_MS)
        return pendente.id;
      if (pendente)
        await tx
          .update(dataExports)
          .set({ status: 'falhou', updatedAt: now })
          .where(eq(dataExports.id, pendente.id));
      const [e] = await tx
        .insert(dataExports)
        .values({
          tenantId: ctx.tenantId,
          patientId: p.id,
          solicitadoPor: ctx.actorUserId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: dataExports.id });
      await recordAudit(tx, {
        acao: 'exportar',
        entidade: 'patients',
        entidadeId: p.id,
        patientId: p.id,
      });
      const job = await boss.send(
        'exportacao-paciente',
        { tenantId: ctx.tenantId, exportId: e.id },
        { db: fromDrizzle(tx, sql) },
      );
      if (!job) throw new Error('A fila recusou a exportação');
      return e.id;
    },
    deps.db ?? getDb(),
  );
}

export async function estadoDaExportacao(
  ctx: TenantContext,
  patientId: string,
  exportId: string,
  db: Db = getDb(),
  now: Date = new Date(),
): Promise<EstadoExportacao> {
  if (!idValido(patientId) || !idValido(exportId)) return { estado: 'inexistente' };
  const [e] = await withTenant(
    ctx,
    (tx) =>
      tx
        .select()
        .from(dataExports)
        .where(and(eq(dataExports.id, exportId), eq(dataExports.patientId, patientId))),
    db,
  );
  if (!e) return { estado: 'inexistente' };
  if (e.status === 'pendente' || e.status === 'falhou') return { estado: e.status };
  if (e.status === 'pronta' && e.arquivoPath && e.expiraEm && e.expiraEm.getTime() > now.getTime())
    return { estado: 'pronta', caminho: e.arquivoPath, expiraEm: e.expiraEm };
  return { estado: 'expirada' };
}

/** Últimos pedidos, com o mesmo estado da página do link (pronta vencida ou sem arquivo = expirada). */
export async function exportacoesRecentes(
  ctx: TenantContext,
  patientId: string,
  db: Db = getDb(),
  now: Date = new Date(),
) {
  if (!idValido(patientId)) return [];
  const linhas = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({
          id: dataExports.id,
          status: dataExports.status,
          arquivoPath: dataExports.arquivoPath,
          createdAt: dataExports.createdAt,
          expiraEm: dataExports.expiraEm,
        })
        .from(dataExports)
        .where(eq(dataExports.patientId, patientId))
        .orderBy(desc(dataExports.createdAt))
        .limit(5),
    db,
  );
  return linhas.map(({ arquivoPath, ...r }) => ({
    ...r,
    status:
      r.status === 'pronta' && !(arquivoPath && r.expiraEm && r.expiraEm.getTime() > now.getTime())
        ? 'expirada'
        : r.status,
  }));
}
