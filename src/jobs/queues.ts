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
  /** US-026: PDF do plano gerado pelo worker na publicação (≤ 30 s). Payload { tenantId, planId }. */
  'plano-pdf': { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 120, deleteAfterSeconds: 86_400 },
  // US-042 / RN-07: foto do diário convertida (JPEG ≤ 1600 px, sem EXIF/GPS) e original apagado. Payload { tenantId, entryId }.
  'diario-foto': { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 120, deleteAfterSeconds: 86_400 },
  // US-026: pendente esquecido (worker caiu na última tentativa, job expirado) vira "falhou" para o painel oferecer nova tentativa
  'expirar-plano-pdf': { retryLimit: 1, retryDelay: 60, expireInSeconds: 120 },
  // Plano 03 (c): .tmp órfãos de salvarArquivo (queda no meio da gravação), todo dia às 04h
  'limpar-tmp': { retryLimit: 1, retryDelay: 600, expireInSeconds: 300 },
  // RN-05 / D6: varredura das notificações a cada minuto, e `{ tenantId }` para envio imediato. O estado fica no
  // banco (notifications), então não há retry do job: o que falhou volta como "pendente" com a próxima tentativa.
  notificacoes: { retryLimit: 0, expireInSeconds: 300, deleteAfterSeconds: 3_600 },
  // US-004: lembretes do tenant suspenso viram "ignorada"; na reativação, os das consultas futuras voltam
  'agenda-tenant': { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 300, deleteAfterSeconds: 86_400 },
  // RN-16 / LGPD: pedidos da página pública com mais de 24 h e contadores velhos (todo dia às 04:30)
  'agenda-limpeza': { retryLimit: 2, retryDelay: 600, expireInSeconds: 300 },
  // INT-01/D5: eventos do webhook do WhatsApp (cifrados), processados em ordem de chegada; idempotentes (repetir não duplica).
  // As novas tentativas (backoff do pg-boss 12 com sorteio: 30–60 s, 60–120 s, 120–240 s; de 3,5 a 7 min ao todo) também
  // cobrem o ERROR que chega antes de o envio gravar o id da mensagem
  'whatsapp-evento': { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 60, deleteAfterSeconds: 86_400 },
} satisfies Record<string, QueueConfig>;

export type QueueName = keyof typeof QUEUES;

export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const [name, options] of Object.entries(QUEUES)) {
    await boss.createQueue(name, options);
    await boss.updateQueue(name, options);
  }
}
