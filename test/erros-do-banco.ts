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
