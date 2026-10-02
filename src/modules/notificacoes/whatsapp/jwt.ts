import { hkdfSync } from 'node:crypto';

/**
 * D4 (a), rodada 1 do /code-review: o `jwt_key` de cada instância é derivado do segredo-mestre
 * (EVOLUTION_WEBHOOK_SECRET, que nunca sai do app). Um JWT de um consultório não vale para outro.
 * Trocar o segredo-mestre exige reconectar (o "Conectar WhatsApp" reconfigura o webhook da instância).
 */
export function chaveDoWebhook(segredo: string, instancia: string): string {
  return Buffer.from(hkdfSync('sha256', Buffer.from(segredo, 'utf8'), Buffer.alloc(0), `nutridebby:webhook-jwt:${instancia}`, 32)).toString('base64url');
}
