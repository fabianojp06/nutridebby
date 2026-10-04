import { getEnv } from '@/env';
import { lerCorpoLimitado } from '@/lib/corpo';
import { clientIpDoLimite } from '@/lib/ip';
import { criarLimite } from '@/lib/limite-memoria';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const limite = criarLimite({ janelaMs: 60_000, max: 60 });
const DIRETIVA = /^[a-z-]{3,40}$/;

/**
 * D7: com CSP_MODO=relatorio, o navegador manda as violações aqui. Log só da diretiva e da origem bloqueada (nunca a URL da página).
 * Com a CSP valendo, nenhum navegador manda relatório (não há report-uri): toda linha seria forjada e o log do Swarm não
 * tem rotação — nada vai ao log. Mesma leitura do proxy (process.env, sem o cache do getEnv).
 */
export async function POST(req: Request): Promise<Response> {
  const vazio = new Response(null, { status: 204 });
  if (process.env.CSP_MODO !== 'relatorio') return vazio;
  if (!limite.permitir(clientIpDoLimite(req.headers, getEnv().TRUSTED_PROXIES) ?? 'sem-ip')) return vazio; // /64 no IPv6, como o T2
  try {
    const corpo = JSON.parse(new TextDecoder().decode(await lerCorpoLimitado(req, 8192))) as { 'csp-report'?: Record<string, unknown> };
    const r = corpo['csp-report'] ?? {};
    const diretiva = String(r['effective-directive'] ?? r['violated-directive'] ?? '').split(' ')[0];
    let bloqueado = 'inline';
    try {
      bloqueado = new URL(String(r['blocked-uri'])).origin;
    } catch {
      // "inline", "eval" ou vazio: fica "inline"
    }
    if (DIRETIVA.test(diretiva)) logger.warn({ diretiva, bloqueado }, 'csp violada');
  } catch {
    // relatório malformado: ignora
  }
  return vazio;
}
