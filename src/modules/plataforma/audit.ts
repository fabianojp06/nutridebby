import { count, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db, type Tx } from '@/db/client';
import { auditLog, user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';

export type AuditAction = 'ler' | 'criar' | 'alterar' | 'excluir' | 'exportar' | 'bloquear' | 'anonimizar';
export type AuditEntry = { acao: AuditAction; entidade: string; entidadeId: string | null; patientId: string | null };

/**
 * Grava no audit_log usando o tenant, o ator e o IP que o withTenant aplicou (app.*).
 * Fora de withTenant falha (tenant_id nulo) — de propósito.
 */
export async function recordAudit(tx: Tx, entries: AuditEntry | AuditEntry[]): Promise<void> {
  const lista = Array.isArray(entries) ? entries : [entries];
  if (!lista.length) return;
  const json = JSON.stringify(
    lista.map((e) => ({ acao: e.acao, entidade: e.entidade, entidade_id: e.entidadeId, patient_id: e.patientId })),
  );
  await tx.execute(sql`
    insert into public.audit_log (tenant_id, actor_user_id, acao, entidade, entidade_id, patient_id, ip, criado_em)
    select app_current_tenant(), app_current_user(), x.acao, x.entidade, x.entidade_id, x.patient_id,
           app_current_ip(), clock_timestamp()
      from jsonb_to_recordset(${json}::jsonb) as x(acao text, entidade text, entidade_id text, patient_id uuid)`);
}

/** Leitura de dado de saúde (US-007 "Leitura auditada"): chamar na transação que leu. */
export async function auditRead(
  tx: Tx,
  e: Omit<AuditEntry, 'acao'> | Omit<AuditEntry, 'acao'>[],
): Promise<void> {
  const lista = Array.isArray(e) ? e : [e];
  await recordAudit(tx, lista.map((x) => ({ ...x, acao: 'ler' as const })));
}

export const HISTORICO_POR_PAGINA = 50;

export const ACAO_ROTULO: Record<AuditAction, string> = {
  ler: 'Visualizou',
  criar: 'Criou',
  alterar: 'Alterou',
  excluir: 'Excluiu',
  exportar: 'Exportou',
  bloquear: 'Bloqueou',
  anonimizar: 'Anonimizou',
};

/** Nome amigável de cada entidade auditada. Cada plano acrescenta as suas tabelas. */
export const ENTIDADE_ROTULO: Record<string, string> = {
  patients: 'Cadastro do paciente',
  etiquetas: 'Etiquetas',
  antropometria: 'Antropometria',
  gasto_energetico: 'Gasto energético',
  anamnese: 'Anamnese',
  atendimentos: 'Atendimento',
  notas_privadas: 'Notas privadas',
};

export type AccessHistoryItem = {
  id: string;
  criadoEm: Date;
  acao: AuditAction;
  entidade: string;
  entidadeId: string | null;
  ip: string | null;
  /** null = ação do sistema (job do worker) */
  ator: { nome: string; papel: string } | null;
};
export type AccessHistoryPage = { itens: AccessHistoryItem[]; pagina: number; totalPaginas: number; total: number };

export async function listAccessHistory(
  ctx: TenantContext,
  patientId: string,
  pagina: number,
  db: Db = getDb(),
): Promise<AccessHistoryPage> {
  // M6: o id costuma vir da URL; sem isto o cast para uuid no Postgres vira erro 500.
  // G5: z.guid() aceita o mesmo formato 8-4-4-4-12 do tipo uuid do Postgres; z.uuid() exige
  // versão/variante RFC 9562 e recusaria ids válidos no banco (histórico vazio sem aviso).
  if (!z.guid().safeParse(patientId).success) return { itens: [], pagina: 1, totalPaginas: 1, total: 0 };
  const r = await withTenant(ctx, async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(auditLog).where(eq(auditLog.patientId, patientId));
    const totalPaginas = Math.max(1, Math.ceil(n / HISTORICO_POR_PAGINA));
    const atual = Math.min(Math.max(1, Math.trunc(pagina) || 1), totalPaginas);
    const linhas = await tx
      .select()
      .from(auditLog)
      .where(eq(auditLog.patientId, patientId))
      .orderBy(desc(auditLog.criadoEm), desc(auditLog.id))
      .limit(HISTORICO_POR_PAGINA)
      .offset((atual - 1) * HISTORICO_POR_PAGINA);
    return { linhas, total: n, atual, totalPaginas };
  }, db);

  // Nomes dos atores: tabela `user` (identidade global, exceção de RLS acessada só pelo M1)
  const ids = [...new Set(r.linhas.map((l) => l.actorUserId).filter((x): x is string => !!x))];
  const atores = ids.length
    ? await db.select({ id: user.id, nome: user.name, papel: user.appRole }).from(user).where(inArray(user.id, ids))
    : [];
  const porId = new Map(atores.map((a) => [a.id, { nome: a.nome, papel: a.papel }]));

  return {
    pagina: r.atual,
    totalPaginas: r.totalPaginas,
    total: r.total,
    itens: r.linhas.map((l) => ({
      id: l.id,
      criadoEm: l.criadoEm,
      acao: l.acao as AuditAction,
      entidade: l.entidade,
      entidadeId: l.entidadeId,
      ip: l.ip,
      ator: l.actorUserId ? (porId.get(l.actorUserId) ?? { nome: 'Usuário removido', papel: '' }) : null,
    })),
  };
}
