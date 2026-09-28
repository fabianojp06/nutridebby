import { getIP } from 'better-auth/api';

/**
 * IP de quem fez a requisição, com a mesma regra usada pelo limite de tentativas do
 * Better Auth (TRUSTED_PROXIES remove os saltos do Traefik da direita para a esquerda).
 * Usado na auditoria (RNF-08) e no Turnstile (INT-06).
 */
export function clientIp(h: Headers, trustedProxies: string[]): string | null {
  return getIP(h, { advanced: { ipAddress: { trustedProxies } } });
}
