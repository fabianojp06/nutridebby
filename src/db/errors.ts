/** Nome da constraint UNIQUE violada (Postgres 23505), olhando também o `cause` do erro do Drizzle. */
export function uniqueViolation(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; e && typeof e === 'object' && i < 5; i++) {
    const pg = e as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (pg.code === '23505') return typeof pg.constraint === 'string' ? pg.constraint : '';
    e = pg.cause;
  }
  return null;
}
