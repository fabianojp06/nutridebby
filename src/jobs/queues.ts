import type { PgBoss, Queue } from 'pg-boss';

type QueueConfig = Omit<Queue, 'name' | 'partition' | 'policy' | 'deadLetter' | 'retryDelayMax' | 'heartbeatSeconds'>;

/**
 * Todas as filas do sistema e as opções delas. O código é a fonte da verdade: ensureQueues
 * cria o que falta e atualiza o que mudou (createQueue sozinho não altera fila existente).
 */
export const QUEUES = {
  heartbeat: { retryLimit: 0, expireInSeconds: 60 },
  // INT-02: 3 novas tentativas (1, 2, 4 min + jitter); concluídos somem em 1 dia (payload já é cifrado)
  email: { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 60, deleteAfterSeconds: 86_400 },
  // Tarefa 13: o worker confere o backup do host (07h) e o disco da VPS (de hora em hora)
  'monitor-backup': { retryLimit: 2, retryDelay: 300, expireInSeconds: 120 },
  'monitor-disco': { retryLimit: 0, expireInSeconds: 60 },
  // US-018: anonimização no fim do prazo de guarda (04h, depois do backup das 03h)
  'retencao-lgpd': { retryLimit: 2, retryDelay: 600, expireInSeconds: 900 },
  // US-018: ZIP da exportação (PDF no worker) e remoção do arquivo 24 h depois
  'exportacao-paciente': { retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 300, deleteAfterSeconds: 86_400 },
  'expirar-exportacao': { retryLimit: 3, retryDelay: 300, expireInSeconds: 120 },
} satisfies Record<string, QueueConfig>;

export type QueueName = keyof typeof QUEUES;

export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const [name, options] of Object.entries(QUEUES)) {
    await boss.createQueue(name, options);
    await boss.updateQueue(name, options);
  }
}
