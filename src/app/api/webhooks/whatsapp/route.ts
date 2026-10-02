import { getEnv } from '@/env';
import { enfileirarEventoWhatsapp, receberWebhook } from '@/modules/notificacoes/whatsapp/webhook';

export const dynamic = 'force-dynamic';

/**
 * INT-01 (Evolution): sem sessão; autenticado pelo JWT do `jwt_key` da instância (D4). O proxy não atua em /api.
 * Sem segredo configurado (WhatsApp desligado): 404 · sem `Bearer`, JWT inválido ou de outra instância: 401 · > 256 KB: 413 ·
 * JSON inválido: 400 · senão 200 `{ ok: true }` (o pedido repetido também: sem efeito, R2).
 */
export function POST(req: Request) {
  return receberWebhook(req, { segredo: getEnv().EVOLUTION_WEBHOOK_SECRET, enfileirar: enfileirarEventoWhatsapp });
}
