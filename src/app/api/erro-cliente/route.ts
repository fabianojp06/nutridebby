import { z } from 'zod';
import { getEnv } from '@/env';
import { CorpoGrandeError, lerCorpoLimitado } from '@/lib/corpo';
import { clientIpDoLimite } from '@/lib/ip';
import { criarLimite } from '@/lib/limite-memoria';
import { mesmaOrigem } from '@/lib/mesma-origem';
import { capturarErroDoNavegador } from '@/lib/sentry';
import { caminhoSeguro } from '@/lib/sentry-filtro';

export const dynamic = 'force-dynamic';

const CORPO_MAX = 1024;
const limite = criarLimite({ janelaMs: 60_000, max: 20 });
const schema = z.object({
  digest: z.string().regex(/^[A-Za-z0-9]{1,40}$/).optional(),
  nome: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/),
  rota: z.string().startsWith('/').max(500),
});
const vazio = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

/** D1: o navegador manda só digest, nome do erro e rota (reportarErro); o texto do erro nunca sai do aparelho. */
export async function POST(req: Request): Promise<Response> {
  if (!mesmaOrigem(req)) return vazio(403);
  // balde pelo /64 no IPv6 (clientIpDoLimite): com clientIp (/128) quem tem um /64 inteiro trocaria de balde a cada pedido
  if (!limite.permitir(clientIpDoLimite(req.headers, getEnv().TRUSTED_PROXIES) ?? 'sem-ip')) return vazio(429);
  let dados: unknown;
  try {
    dados = JSON.parse(new TextDecoder().decode(await lerCorpoLimitado(req, CORPO_MAX)));
  } catch (e) {
    return vazio(e instanceof CorpoGrandeError ? 413 : 400);
  }
  const p = schema.safeParse(dados);
  if (!p.success) return vazio(400);
  capturarErroDoNavegador({ digest: p.data.digest ?? null, nome: p.data.nome, rota: caminhoSeguro(p.data.rota) ?? '/' });
  return vazio(204);
}
