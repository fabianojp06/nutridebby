import { and, desc, eq, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db } from '@/db/client';
import { dataExports, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { auditRead, recordAudit } from '@/modules/plataforma/audit';
import { idValido, PacienteNaoEncontradoError } from './base';
import { urlDoApp } from '@/lib/url-do-app';
import { telaDoPortal } from '@/modules/portal/link-portal';
// Só o tipo: o arquivo do worker (PDF/ZIP) fica fora do grafo do Next (guarda em exportacao.test.ts)
import type { EscopoExportacao } from './exportacao-job';

export const EXPORTACAO_VALIDADE_MS = 24 * 60 * 60 * 1000; // US-018: link válido por 24 h
/** Pendente há mais que isto = o job se perdeu (3 tentativas de até 5 min + espera): um pedido novo é criado. */
export const PENDENTE_MAX_MS = 30 * 60 * 1000;
/** L-3: pendente perdido aparece como "falhou" (a página do link não diz "volte em alguns minutos" para sempre). */
export const perdido = (e: { status: string; createdAt: Date }, now: Date) =>
  e.status === 'pendente' && now.getTime() - e.createdAt.getTime() > PENDENTE_MAX_MS;

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

export function linkDaExportacao(
  appUrl: string,
  pedido: { tenantId: string; patientId: string; id: string; escopo?: EscopoExportacao },
): string {
  // US-046: o titular abre pelo portal (pede login de paciente), no consultório do pedido (`?v=`: com 2+ vínculos o
  // cookie pode estar em outro); a equipe, pelo prontuário
  return urlDoApp(
    appUrl,
    pedido.escopo === 'titular'
      ? telaDoPortal(`/p/meus-dados/exportacoes/${pedido.id}`, pedido.tenantId)
      : `/painel/pacientes/${pedido.patientId}/exportacoes/${pedido.id}`,
  );
}

/**
 * "Exportar dados": grava o pedido, o `exportar` no audit_log e o job na mesma transação. Um pedido do
 * mesmo escopo ainda sendo gerado é reaproveitado (duplo clique não gera dois ZIPs); pendente há mais de
 * 30 min é dado como perdido (job expirado, worker que caiu): vira "falhou" e nasce outro. Vale também
 * para bloqueado. `escopo`: `equipe` (nutricionista, padrão) ou `titular` (o paciente pelo portal, US-046).
 */
export async function solicitarExportacao(
  ctx: TenantContext,
  patientId: string,
  deps: { db?: Db; now?: Date; boss?: PgBoss; escopo?: EscopoExportacao } = {},
): Promise<string> {
  if (!idValido(patientId)) throw new PacienteNaoEncontradoError();
  const escopo = deps.escopo ?? 'equipe';
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
      // O pendente reaproveitado (ou dado como perdido) é só o do MESMO escopo: o da equipe e o do titular
      // têm destinatário (solicitadoPor), link e conteúdo diferentes (D16)
      const [pendente] = await tx
        .select({ id: dataExports.id, createdAt: dataExports.createdAt })
        .from(dataExports)
        .where(
          and(
            eq(dataExports.patientId, p.id),
            eq(dataExports.escopo, escopo),
            eq(dataExports.status, 'pendente'),
          ),
        );
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
          escopo,
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

/**
 * O estado do pedido para a página do link. `o.escopo` restringe ao escopo (o portal só abre os do titular —
 * D16; o ZIP da equipe, que pode ter o rascunho, nunca é entregue ao paciente).
 */
export async function estadoDaExportacao(
  ctx: TenantContext,
  patientId: string,
  exportId: string,
  db: Db = getDb(),
  now: Date = new Date(),
  o: { escopo?: EscopoExportacao } = {},
): Promise<EstadoExportacao> {
  if (!idValido(patientId) || !idValido(exportId)) return { estado: 'inexistente' };
  return withTenant(
    ctx,
    async (tx): Promise<EstadoExportacao> => {
      const [e] = await tx
        .select()
        .from(dataExports)
        .where(
          and(
            eq(dataExports.id, exportId),
            eq(dataExports.patientId, patientId),
            o.escopo ? eq(dataExports.escopo, o.escopo) : undefined,
          ),
        );
      if (!e) return { estado: 'inexistente' };
      if (perdido(e, now)) return { estado: 'falhou' };
      if (e.status === 'pendente' || e.status === 'falhou') return { estado: e.status };
      if (
        e.status === 'pronta' &&
        e.arquivoPath &&
        e.expiraEm &&
        e.expiraEm.getTime() > now.getTime()
      ) {
        // Regra 8: a página entrega o link do ZIP (prontuário inteiro) — cada abertura fica no histórico
        await auditRead(tx, { entidade: 'exportacoes', entidadeId: e.id, patientId });
        return { estado: 'pronta', caminho: e.arquivoPath, expiraEm: e.expiraEm };
      }
      return { estado: 'expirada' };
    },
    db,
  );
}

/** Últimos pedidos, com o mesmo estado da página do link (pronta vencida ou sem arquivo = expirada; pendente perdido = falhou). */
export async function exportacoesRecentes(
  ctx: TenantContext,
  patientId: string,
  db: Db = getDb(),
  now: Date = new Date(),
) {
  if (!idValido(patientId)) return [];
  const linhas = await withTenant(
    ctx,
    async (tx) => {
      const r = await tx
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
        .limit(5);
      // Regra 8: a lista (datas e estado dos pedidos) é leitura de tabela com patient_id
      if (r.length) await auditRead(tx, { entidade: 'exportacoes', entidadeId: null, patientId });
      return r;
    },
    db,
  );
  return linhas.map(({ arquivoPath, ...r }) => ({
    ...r,
    status: perdido(r, now)
      ? 'falhou'
      : r.status === 'pronta' && !(arquivoPath && r.expiraEm && r.expiraEm.getTime() > now.getTime())
        ? 'expirada'
        : r.status,
  }));
}
