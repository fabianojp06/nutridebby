import { logger } from '@/lib/logger';
import type { FimDoJob } from './leitura-job';
import { processarGeracaoModelos, type DadosJobAssistente, type DepsJobAssistente } from './modelos-job';

/**
 * Plano 14B (D3): o roteador da fila `ia-assistente` (só o worker importa — guarda de grafo). A 14B-2 acrescenta o resumo
 * e o rascunho (pelo tipo da tarefa); até lá, payload com `tarefaId` não tem processador e é ignorado (só ids no log).
 */
export async function processarJobAssistente(d: DadosJobAssistente, deps: DepsJobAssistente): Promise<FimDoJob> {
  if ('geracaoId' in d) return processarGeracaoModelos(d, deps);
  logger.warn({ tenantId: d.tenantId, tarefaId: d.tarefaId }, 'tarefa da fila ia-assistente sem processador');
  return 'ignorada';
}
