import { getIP } from 'better-auth/api';

/**
 * IP de quem fez a requisição, com a mesma regra usada pelo limite de tentativas do
 * Better Auth (TRUSTED_PROXIES remove os saltos do Traefik da direita para a esquerda).
 * Usado na auditoria (RNF-08), no aceite do DPA e no Turnstile (INT-06).
 *
 * F1: `ipv6Subnet: 128` devolve o IPv6 completo (forma expandida). Sem isso o Better Auth
 * trunca para o /64 — bom para o limite de tentativas (que continua em /64 na config do
 * auth), mas errado para auditoria e para o `remoteip` do Turnstile.
 */
export function clientIp(h: Headers, trustedProxies: string[]): string | null {
  return getIP(h, { advanced: { ipAddress: { trustedProxies, ipv6Subnet: 128 } } });
}

/**
 * RN-16: o IP como balde do limite de tentativas da página pública — a regra do limite de login do Better Auth:
 * IPv6 pelo /64 (o provedor entrega o /64 inteiro a cada cliente; trocar o fim do endereço não abre um balde novo),
 * IPv4 inteiro. Só para contar tentativas: auditoria, aceite e Turnstile usam `clientIp`.
 */
export function clientIpDoLimite(h: Headers, trustedProxies: string[]): string | null {
  return getIP(h, { advanced: { ipAddress: { trustedProxies, ipv6Subnet: 64 } } });
}
