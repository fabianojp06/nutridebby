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

/** Nome da constraint de FK violada (Postgres 23503), olhando também o `cause` do erro do Drizzle. */
export function fkViolation(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; e && typeof e === 'object' && i < 5; i++) {
    const pg = e as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (pg.code === '23503') return typeof pg.constraint === 'string' ? pg.constraint : '';
    e = pg.cause;
  }
  return null;
}

type PgLike = { name?: unknown; code?: unknown; constraint?: unknown; table?: unknown; column?: unknown; message?: unknown; severity?: unknown; cause?: unknown };
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length <= 128 ? v : undefined);
// Classes SQLSTATE cujas mensagens só citam nomes de objetos ou texto fixo das nossas funções (23 integridade, 40 transação, 42501 privilégio, P0001/55000 RAISE das nossas funções)
const MENSAGEM_SEGURA = /^(23|40)|^42501$|^P0001$|^55000$/;

/**
 * Erro de banco sem dados: o `DrizzleQueryError` traz o SQL e os parâmetros (nome, e-mail, hash de senha)
 * na `message`, e o erro do pg traz `detail`/`where` com valores (RNF-11, CLAUDE.md regra 3).
 * Só ficam o SQLSTATE, os nomes de constraint/tabela/coluna e, nas classes seguras, a mensagem do Postgres.
 */
export class DbError extends Error {
  override name = 'DbError';
  readonly code: string | null;
  readonly constraint?: string;
  readonly table?: string;
  readonly column?: string;
  constructor(orig: { code: string | null; constraint?: string; table?: string; column?: string; origem: string; mensagem?: string }) {
    super(`Falha no banco (${orig.origem}${orig.code ? `, SQLSTATE ${orig.code}` : ''}${orig.constraint ? `, constraint ${orig.constraint}` : ''})`);
    this.code = orig.code;
    this.constraint = orig.constraint;
    this.table = orig.table;
    this.column = orig.column;
    if (orig.mensagem) {
      const c = Object.assign(new Error(orig.mensagem), { code: orig.code, constraint: orig.constraint, table: orig.table, column: orig.column });
      this.cause = c;
    }
  }
}

/** Devolve um DbError para erros do Drizzle/pg; qualquer outro erro volta como está (null). */
export function sanitizarErroDeBanco(err: unknown): DbError | null {
  if (err instanceof DbError || !err || typeof err !== 'object') return null;
  const top = err as PgLike;
  const inner = (top.cause && typeof top.cause === 'object' ? top.cause : top) as PgLike;
  const ehDrizzle = top.name === 'DrizzleQueryError';
  const ehPg = typeof inner.code === 'string' && /^[0-9A-Z]{5}$/.test(inner.code) && 'severity' in inner;
  if (!ehDrizzle && !ehPg) return null;
  const code = ehPg ? (inner.code as string) : null;
  return new DbError({
    code,
    constraint: str(inner.constraint),
    table: str(inner.table),
    column: str(inner.column),
    origem: ehDrizzle ? 'DrizzleQueryError' : 'pg',
    mensagem: code && MENSAGEM_SEGURA.test(code) ? str(inner.message) ?? undefined : undefined,
  });
}
