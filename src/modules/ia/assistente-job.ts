import { eq } from 'drizzle-orm';
import { iaTarefas } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { logger } from '@/lib/logger';
import type { FimDoJob } from './leitura-job';
import { processarGeracaoModelos, type DadosJobAssistente, type DepsJobAssistente } from './modelos-job';
import { processarRascunho } from './rascunho-job';
import { processarResumo } from './resumo-job';

/**
 * Plano 14B (D3): o roteador da fila `ia-assistente` (só o worker importa — guarda de grafo). A geração de modelos vem com
 * `geracaoId`; a tarefa (resumo e rascunho), com `tarefaId`, roteada pelo `tipo` da tarefa (só a coluna,
 * lida como `worker`). Tarefa inexistente ou de outro tipo → ignorada (só ids no log).
 */
export async function processarJobAssistente(d: DadosJobAssistente, deps: DepsJobAssistente): Promise<FimDoJob> {
  if ('geracaoId' in d) return processarGeracaoModelos(d, deps);
  const [t] = await withTenant({ tenantId: d.tenantId, role: 'worker' }, (tx) => tx.select({ tipo: iaTarefas.tipo }).from(iaTarefas).where(eq(iaTarefas.id, d.tarefaId)), deps.db);
  if (t?.tipo === 'resumo_historico') return processarResumo(d, deps);
  if (t?.tipo === 'rascunho_plano') return processarRascunho(d, deps);
  logger.warn({ tenantId: d.tenantId, tarefaId: d.tarefaId, tipo: t?.tipo ?? null }, 'tarefa da fila ia-assistente sem processador');
  return 'ignorada';
}
