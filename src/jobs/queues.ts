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
  // US-018 / F-13: depois do atendimento da exclusão, apaga as fotos do diário e só então avisa o paciente por e-mail.
  // Payload { tenantId, patientId }. 5 novas tentativas (1, 2, 4, 8, 16 min + sorteio); na última, o aviso sai assim mesmo
  'exclusao-atendida': { retryLimit: 5, retryDelay: 60, retryBackoff: true, expireInSeconds: 300, deleteAfterSeconds: 86_400 },
  // US-018: ZIP da exportação (PDF no worker) e remoção do arquivo 24 h depois
  'exportacao-paciente': { retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 300, deleteAfterSeconds: 86_400 },
  'expirar-exportacao': { retryLimit: 3, retryDelay: 300, expireInSeconds: 120 },
  /** US-026: PDF do plano gerado pelo worker na publicação (≤ 30 s). Payload { tenantId, planId }. */
  'plano-pdf': { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 120, deleteAfterSeconds: 86_400 },
  // US-042 / RN-07: foto do diário convertida (JPEG ≤ 1600 px, sem EXIF/GPS) e original apagado. Payload { tenantId, entryId }.
  'diario-foto': { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 120, deleteAfterSeconds: 86_400 },
  // US-042: foto parada há mais de 30 min sem job vivo (worker caiu na última tentativa, banco fora) → "falhou" e o original
  // (EXIF/GPS) sai do disco e da cota; "pronta" que ainda aponta para o original → só o apaga. De 15 em 15 min.
  'expirar-diario-foto': { retryLimit: 1, retryDelay: 60, expireInSeconds: 300 },
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
  // Plano 10A (US-143): PDF preparado da receita, com o código e o QR (≤ 30 s, RNF-140). Payload { tenantId, documentoId }
  'documento-pdf': { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 120, deleteAfterSeconds: 86_400 },
  // Plano 10A (RN-157, D4): PDF montado com as fotos da digitalizada. Payload { tenantId, documentoId, userId }
  'documento-digitalizado': { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 180, deleteAfterSeconds: 86_400 },
  // Plano 10A: PDF pendente há mais de 1 h → falhou; digitalização "recebendo"/"pendente" há mais de 1 h → falhou; PDF base e
  // fotos da digitalizada sem referência → apagados (de 15 em 15 min)
  'expirar-documento-pdf': { retryLimit: 1, retryDelay: 60, expireInSeconds: 300 },
  // Plano 11 (spec v0.3 §5.6, RN-105): leitura de laudo pela IA. Payload { tenantId, tarefaId } (nada de dado de saúde).
  // O handler decide: relança só o que pode repetir (antes do envio, 429/500/529) — backoff do pg-boss ≈ 30–60 s e 60–120 s.
  // expireInSeconds 300: acima do pior caso do handler (preparo de um PDF de 20 MB + uma chamada de 120 s). O pg-boss 12
  // relança o job expirado com o handler antigo ainda rodando; o portão do envio (T11) garante que o laudo sai uma vez só.
  ia: { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 300, deleteAfterSeconds: 86_400 },
  // Plano 11: processando há mais de 15 min / na fila há mais de 30 min → falhou (interrompida); pronta vencida → expirada (15 em 15 min)
  'expirar-ia': { retryLimit: 1, retryDelay: 60, expireInSeconds: 300 },
  // Plano 14A (RN-108, D14): a retirada da autorização pelo paciente (app ou link) — cancela a fila e esvazia as sugestões no
  // contexto worker (a sessão de paciente não alcança ia_tarefas). Payload { tenantId, patientId, retiradaId } (só ids).
  'ia-retirada': { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 120, deleteAfterSeconds: 86_400 },
  // Plano 12 (RN-163, D23 = a): o envio de exame do paciente — fotos convertidas e PDF rasterizado num processo filho, PDF
  // limpo, páginas e aviso. Payload { tenantId, envioId } (nada de dado de saúde). Um por vez (padrão do boss.work, RNF-162);
  // 300 s acima do pior caso (rasterização de até 120 s + gravações); na última tentativa, "falhou" (o handler decide).
  'exame-envio': { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 300, deleteAfterSeconds: 86_400 },
  // RN-166: o paciente cancelou; o worker apaga o PDF limpo e as páginas (a sessão de paciente não apaga stored_files)
  'exame-envio-limpar': { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 120, deleteAfterSeconds: 86_400 },
  // RN-163/RN-167: processando parado > 30 min sem job vivo → falhou; recebido há 90 dias → expirado; sobras de arquivo (15 em 15 min)
  'expirar-exame-envio': { retryLimit: 1, retryDelay: 60, expireInSeconds: 300 },
} satisfies Record<string, QueueConfig>;

export type QueueName = keyof typeof QUEUES;

export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const [name, options] of Object.entries(QUEUES)) {
    await boss.createQueue(name, options);
    await boss.updateQueue(name, options);
  }
}
