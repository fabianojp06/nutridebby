import { count, desc, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db, type Tx } from '@/db/client';
import { auditLog, iaTarefas, user } from '@/db/schema';
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
  exames: 'Exames',
  pedidos_titular: 'Pedido do titular (LGPD)',
  exportacoes: 'Exportação de dados',
  plano_alimentar: 'Plano alimentar',
  agenda: 'Agenda',
  diario: 'Diário alimentar',
  conteudos: 'Público de conteúdo',
  documentos: 'Documentos assinados',
  perfil_profissional: 'Perfil profissional',
  tentativa_assinatura: 'Tentativa de assinatura com código recusado',
  ia: 'Inteligência artificial',
  exames_enviados: 'Exames enviados pelo paciente',
  peso_no_app: 'Peso oculto no app',
  ia_autorizacao: 'Autorização de IA',
  // Plano 15 (RN-183, desvio 6): o nome de trabalho — o histórico é da equipe e não muda com o nome escolhido (D28)
  ia_nutri: 'IA Nutri (conversa com o paciente)',
  ia_nutri_liberacao: 'IA Nutri — liberação',
  ia_nutri_pergunta: 'IA Nutri (conversa com o paciente)',
  ia_nutri_duvida: 'IA Nutri (conversa com o paciente)',
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
  /**
   * Plano 14B (D22, RN-101): só nos itens da entidade `ia` — o tipo da tarefa (`leitura_exame`, `resumo_historico`,
   * `rascunho_plano`), ou null se a tarefa já não existe (apagada na anonimização). Ausente = item de outra entidade.
   */
  tipoIa?: string | null;
};
/**
 * RN-101: o PEDIDO é o `criar` do gatilho de ia_tarefas (com o ator da sessão); a SAÍDA ao provedor é o `exportar` que o
 * worker grava no portão do envio (ator nulo = "Sistema"). Tarefa que termina antes de enviar (laudo longo, PDF com senha,
 * exame excluído, recusa do paciente) não tem a linha de saída. Sem ação nova no audit_log. Plano 14B (D22): o rótulo
 * depende do tipo da tarefa (`tipoIa`, lido por listAccessHistory) — o laudo na leitura, os dados no resumo e no rascunho;
 * `null` (tarefa apagada na anonimização) = "Pediu uso da IA"/"Dados enviados à IA"; sem o campo = os rótulos da leitura.
 */
const PEDIU_IA: Record<string, string> = { leitura_exame: 'Pediu leitura à IA', resumo_historico: 'Pediu resumo à IA', rascunho_plano: 'Pediu rascunho à IA' };
export function rotuloDaAcao(i: Pick<AccessHistoryItem, 'acao' | 'entidade' | 'tipoIa'>): string {
  if (i.entidade === 'ia' && i.acao === 'criar') return i.tipoIa === undefined ? PEDIU_IA.leitura_exame : (PEDIU_IA[i.tipoIa ?? ''] ?? 'Pediu uso da IA');
  if (i.entidade === 'ia' && i.acao === 'exportar') return i.tipoIa === undefined || i.tipoIa === 'leitura_exame' ? 'Laudo enviado à IA' : 'Dados enviados à IA';
  // Plano 16 (Desvio 5): a decisão "Não mostrar peso no app" (`criar` = ligou, `excluir` = desligou, peso-oculto.ts)
  if (i.entidade === 'peso_no_app' && i.acao === 'criar') return 'Ligou';
  if (i.entidade === 'peso_no_app' && i.acao === 'excluir') return 'Desligou';
  // Plano 15 (RN-183): a pergunta (recordAudit do módulo), o envio direto à nutricionista (DP-16) e a saída ao provedor
  // (recordAudit do worker no portão, ator nulo)
  if (i.entidade === 'ia_nutri_pergunta' && i.acao === 'criar') return 'Perguntou à IA';
  if (i.entidade === 'ia_nutri_duvida' && i.acao === 'criar') return 'Enviou dúvida à nutricionista';
  if (i.entidade === 'ia_nutri' && i.acao === 'exportar') return 'Pergunta enviada à IA';
  return ACAO_ROTULO[i.acao];
}

/**
 * RN-101 e RN-183 (Plano 15): ficam no audit_log, mas fora da tela (e da contagem) — os `alterar` do worker (ator nulo) em
 * `ia` e `ia_nutri`, e o `criar` do gatilho em `ia_nutri` (nasce da pergunta, da resposta do worker e da mensagem do filtro
 * de risco; o "Perguntou à IA" é o `criar` de `ia_nutri_pergunta`, gravado pelo módulo).
 */
const visivelNoHistorico = (patientId: string) =>
  sql`${auditLog.patientId} = ${patientId}
      and not (${auditLog.entidade} in ('ia', 'ia_nutri') and ${auditLog.acao} = 'alterar' and ${auditLog.actorUserId} is null)
      and not (${auditLog.entidade} = 'ia_nutri' and ${auditLog.acao} = 'criar')`;

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
    const [{ n }] = await tx.select({ n: count() }).from(auditLog).where(visivelNoHistorico(patientId));
    const totalPaginas = Math.max(1, Math.ceil(n / HISTORICO_POR_PAGINA));
    const atual = Math.min(Math.max(1, Math.trunc(pagina) || 1), totalPaginas);
    const linhas = await tx
      .select()
      .from(auditLog)
      .where(visivelNoHistorico(patientId))
      .orderBy(desc(auditLog.criadoEm), desc(auditLog.id))
      .limit(HISTORICO_POR_PAGINA)
      .offset((atual - 1) * HISTORICO_POR_PAGINA);
    // RN-101 (Plano 14B, D22): o rótulo da IA depende do tipo da tarefa — lido em ia_tarefas pelos entidade_id desta página
    // (a equipe lê a tabela, dentro do withTenant: regra 1); id que não é uuid não vai à consulta (o cast falharia)
    const idsIa = [...new Set(linhas.filter((l) => l.entidade === 'ia' && l.entidadeId && z.guid().safeParse(l.entidadeId).success).map((l) => l.entidadeId!))];
    const tipos = new Map(idsIa.length ? (await tx.select({ id: iaTarefas.id, tipo: iaTarefas.tipo }).from(iaTarefas).where(inArray(iaTarefas.id, idsIa))).map((x) => [x.id, x.tipo]) : []);
    return { linhas, total: n, atual, totalPaginas, tipos };
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
      ...(l.entidade === 'ia' ? { tipoIa: (l.entidadeId && r.tipos.get(l.entidadeId)) || null } : {}),
    })),
  };
}
