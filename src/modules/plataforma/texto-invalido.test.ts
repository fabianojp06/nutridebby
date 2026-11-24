import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../test/db';
import { espiarErrosDoBanco } from '../../../test/erros-do-banco';
import { tenants } from '@/db/schema';
import { atualizarPerfil } from './marca';

vi.mock('server-only', () => ({})); // marca.ts é só do servidor

/**
 * SUS-110 (regra 3): o NUL e o surrogate UTF-16 sem par no perfil público do consultório (nome de exibição, endereço,
 * link) não chegam ao banco — o `text` recusaria o NUL (22021) com o texto no log e no erro do app. O espião anota o
 * SQLSTATE de todo erro do banco.
 */
const app = makeDb(inject('appDatabaseUrl'));
const errosDoBanco = espiarErrosDoBanco(app.pool);
afterAll(() => app.pool.end());

const INVALIDOS = [
  ['NUL', '\u0000'],
  ['surrogate alto sem par', '\ud800'],
  ['surrogate baixo sem par', '\udc00'],
] as const;

async function semErroDoBanco<T>(f: () => Promise<T>): Promise<T> {
  errosDoBanco.length = 0;
  const r = await f().then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  expect(errosDoBanco).toEqual([]);
  if (!r.ok) throw r.e;
  return r.v;
}

describe('SUS-110: texto com NUL ou surrogate sem par no perfil do consultório', () => {
  it.each(INVALIDOS)('nome de exibição, endereço e link com %s vão limpos', async (_nome, ch) => {
    const [t] = await app.db.insert(tenants).values({ slug: `sus110-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Marca' }).returning();
    await semErroDoBanco(() =>
      atualizarPerfil(
        t.id,
        {
          nomeExibicao: `Debby${ch} Silva 🙂`,
          crn: 'CRN-3 12345',
          corPrimaria: '#2E7D32',
          enderecoConsultorio: `Rua A${ch}, 10 🙂`,
          linkOnlinePadrao: `https://meet.exemplo.com/debby${ch}`,
          antecedenciaMinH: '12',
          cancelamentoMinH: '24',
          agendamentoPublicoAtivo: true,
          mostrarPercGorduraPaciente: false,
          fuso: 'America/Sao_Paulo',
        },
        app.db,
      ),
    );
    const [r] = await app.db.select().from(tenants).where(eq(tenants.id, t.id));
    expect(r).toMatchObject({ nomeExibicao: 'Debby Silva 🙂', enderecoConsultorio: 'Rua A, 10 🙂', linkOnlinePadrao: 'https://meet.exemplo.com/debby' });
  });
});
