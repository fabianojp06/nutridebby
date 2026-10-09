import { createHmac, hkdfSync } from 'node:crypto';
import { eq, lt, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { publicRateLimits } from '@/db/schema';
import { encryptionKey } from '@/lib/crypto';

/**
 * RN-16: contadores da página pública e marcas anti-repetição do webhook do WhatsApp (D4 b). Plano 10A: verificação
 * pública por IP, código do link por IP (pedido e confirmação) e por documento, tentativas e repetição do código do 2FA.
 * `public_rate_limits` não tem tenant_id nem RLS: só este arquivo a acessa (CLAUDE.md regra 1).
 */

let chave: Buffer | undefined;
const chaveDosLimites = () => (chave ??= Buffer.from(hkdfSync('sha256', encryptionKey(), Buffer.alloc(0), 'nutridebby:limite-publico:v1', 32)));

/** RN-16 / LGPD: a linha guarda o HMAC do IP, do e-mail ou do pedido do webhook (JWT + corpo), nunca o valor. */
export function chaveDoLimite(
  tipo: 'ip' | 'email-hora' | 'webhook' | 'verificacao-ip' | 'documento-ip' | 'documento-envio' | 'documento-codigo-ip' | 'totp-erro' | 'totp-usado' | 'autorizacao-ia-ip',
  valor: string,
): string {
  return `${tipo}:${createHmac('sha256', chaveDosLimites()).update(valor).digest('base64url')}`;
}

/**
 * Conta mais uma tentativa na janela, de forma atômica, e diz se ainda está dentro do limite. Aceita uma transação: a
 * marca anti-repetição do webhook é gravada junto do evento na fila (revisão 1 da T12).
 */
export async function consumirLimite(db: Db | Tx, chaveLimite: string, limite: number, janelaS: number, agora: Date): Promise<boolean> {
  const virou = sql`public_rate_limits.janela_inicio <= ${agora}::timestamptz - make_interval(secs => ${janelaS})`;
  const r = await db.execute<{ contagem: number }>(sql`
    insert into public_rate_limits (chave, janela_inicio, contagem) values (${chaveLimite}, ${agora}, 1)
    on conflict (chave) do update set
      contagem = case when ${virou} then 1 else public_rate_limits.contagem + 1 end,
      janela_inicio = case when ${virou} then ${agora}::timestamptz else public_rate_limits.janela_inicio end
    returning contagem`);
  return Number(r.rows[0].contagem) <= limite;
}

/**
 * Zera um contador: o seed do E2E (o visitante da página pública começa cada execução do zero).
 */
export async function liberarLimite(db: Db, chaveLimite: string): Promise<void> {
  await db.delete(publicRateLimits).where(eq(publicRateLimits.chave, chaveLimite));
}

/** Diário (agenda-limpeza): contadores de mais de 1 dia. */
export async function limparLimites(db: Db, agora: Date): Promise<number> {
  const r = await db
    .delete(publicRateLimits)
    .where(lt(publicRateLimits.janelaInicio, new Date(agora.getTime() - 86_400_000)))
    .returning({ chave: publicRateLimits.chave });
  return r.length;
}
