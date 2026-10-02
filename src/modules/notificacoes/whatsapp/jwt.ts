import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * D4 (a), rodada 1 do /code-review: o `jwt_key` de cada instância é derivado do segredo-mestre
 * (EVOLUTION_WEBHOOK_SECRET, que nunca sai do app). Um JWT de um consultório não vale para outro.
 * Trocar o segredo-mestre exige reconectar (o "Conectar WhatsApp" reconfigura o webhook da instância).
 */
export function chaveDoWebhook(segredo: string, instancia: string): string {
  return Buffer.from(hkdfSync('sha256', Buffer.from(segredo, 'utf8'), Buffer.alloc(0), `nutridebby:webhook-jwt:${instancia}`, 32)).toString('base64url');
}

export type VerificacaoJwt = { ok: true } | { ok: false; motivo: 'formato' | 'algoritmo' | 'assinatura' | 'expirado' | 'emissor' };

const json = (s: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Folga de relógio entre a Evolution e o app; validade máxima aceita (a Evolution usa 10 min). */
const FOLGA_S = 60;
const VALIDADE_MAX_S = 900;

/**
 * D4: o `jwt_key` do webhook da instância (Evolution v2.3+) vira `Authorization: Bearer <JWT HS256>` com
 * { iat, exp: iat + 600, app: 'evolution', action: 'webhook' }. Só HS256 (nada de "none" nem RS*), assinatura
 * comparada em tempo constante, exp com 60 s de folga de relógio, iat não muito no futuro e validade máxima de 15 min.
 * `chave` = `chaveDoWebhook(segredo, instância)` — a da instância que o corpo diz ser (D4 a).
 */
export function verificarJwtWebhook(token: string, chave: string, agora: Date): VerificacaoJwt {
  const partes = token.split('.');
  if (token.length > 2048 || partes.length !== 3 || partes.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, motivo: 'formato' };
  const [h, p, s] = partes;
  if (json(h)?.alg !== 'HS256') return { ok: false, motivo: 'algoritmo' };
  const esperado = createHmac('sha256', Buffer.from(chave, 'utf8')).update(`${h}.${p}`).digest();
  const recebido = Buffer.from(s, 'base64url');
  if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return { ok: false, motivo: 'assinatura' };
  const c = json(p);
  if (!c || typeof c.exp !== 'number' || typeof c.iat !== 'number') return { ok: false, motivo: 'formato' };
  const seg = Math.floor(agora.getTime() / 1000);
  if (c.exp + FOLGA_S < seg || c.iat - FOLGA_S > seg || c.exp - c.iat > VALIDADE_MAX_S) return { ok: false, motivo: 'expirado' };
  if (c.app !== 'evolution' || c.action !== 'webhook') return { ok: false, motivo: 'emissor' };
  return { ok: true };
}

/** Testes e E2E: o mesmo JWT que a Evolution gera com o `jwt_key` da instância (jsonwebtoken.sign, HS256). */
export function assinarJwtWebhook(chave: string, agora: Date, extra: Record<string, unknown> = {}): string {
  const iat = Math.floor(agora.getTime() / 1000);
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const corpo = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ iat, exp: iat + 600, app: 'evolution', action: 'webhook', ...extra })}`;
  return `${corpo}.${createHmac('sha256', Buffer.from(chave, 'utf8')).update(corpo).digest('base64url')}`;
}
