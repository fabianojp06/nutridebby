import { expect } from 'vitest';
import type { Pool, PoolClient } from 'pg';

/**
 * Espião de SQLSTATE (o de `src/modules/pacientes/cadastro.test.ts`, SUS-109): anota o código de todo erro que o banco
 * devolve pelas conexões do pool — pela promessa e pela callback (a forma que o `pool.query` do pg usa). Ligue antes da
 * primeira conexão; zere com `erros.length = 0`.
 */
export function espiarErrosDoBanco(pool: Pool): string[] {
  const erros: string[] = [];
  pool.on('connect', (client: PoolClient) => {
    const original = client.query.bind(client) as (...a: unknown[]) => unknown;
    (client as unknown as { query: (...a: unknown[]) => unknown }).query = (...a: unknown[]) => {
      const cb = a.at(-1);
      if (typeof cb === 'function') {
        a[a.length - 1] = (e: { code?: string } | null, ...resto: unknown[]) => {
          if (e) erros.push(e.code ?? '?');
          return (cb as (...x: unknown[]) => unknown)(e, ...resto);
        };
      }
      const r = original(...a);
      if (r && typeof (r as Promise<unknown>).then === 'function') {
        (r as Promise<unknown>).catch((e: { code?: string }) => void erros.push(e?.code ?? '?'));
      }
      return r;
    };
  });
  return erros;
}

/** SUS-109/SUS-110: os caracteres que o Postgres recusa (ou troca por U+FFFD) num texto digitado, um caso por linha. */
export const INVALIDOS = [
  ['NUL', '\u0000'],
  ['surrogate alto sem par', '\ud800'],
  ['surrogate baixo sem par', '\udc00'],
] as const;
/** "Ferritina<c> baixa 🙂" → "Ferritina baixa 🙂" (`limpo`): o caractere inválido sai e o emoji (par válido) fica. */
export const sujo = (t: string, c: string) => `${t}${c} baixa 🙂`;
export const limpo = (t: string) => `${t} baixa 🙂`;

/**
 * Roda a gravação com o espião (`espiarErrosDoBanco`) zerado; o erro do banco (se houver) aparece como o SQLSTATE
 * anotado, antes de qualquer outra conferência.
 */
export async function semErroDoBanco<T>(erros: string[], f: () => Promise<T>): Promise<T> {
  erros.length = 0;
  const r = await f().then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  expect(erros).toEqual([]);
  if (!r.ok) throw r.e;
  return r.v;
}
