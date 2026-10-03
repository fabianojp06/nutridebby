import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { pacienteComConta } from '../../../test/portal';
import { novoTenant } from '../../../test/pacientes';
import { entrar } from '../../../test/sessao';

// Plano 06, T13 (revisão da T3): uma sessão de paciente que dispara uma Server Action do painel (o ID da ação é público
// no HTML do painel) volta ao portal — nunca erro 500 nem dado. Cobre TODA `actions.ts` do painel
// (): uma ação nova sem `requireNutri` quebra aqui.
const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => req.headers, cookies: async () => ({ get: () => undefined, set: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

const RAIZ = join(process.cwd(), 'src/app/painel');
const arquivos = readdirSync(RAIZ, { recursive: true, encoding: 'utf8' })
  .filter((f) => f === 'actions.ts' || f.endsWith('/actions.ts'))
  .sort();
const db = getDb();
afterAll(() => closeDb());

describe('Server Actions do painel chamadas por uma sessão de paciente', () => {
  it('acha as actions.ts do painel', () => {
    expect(arquivos.length).toBeGreaterThanOrEqual(10);
  });

  it('todas voltam ao portal (redirect /p/inicio), sem erro', async () => {
    const T = await novoTenant(db);
    const { email } = await pacienteComConta(db, T);
    req.headers = new Headers({ cookie: await entrar(getAuth(), email) });
    const id = randomUUID();
    const fd = new FormData();
    fd.set('nome', 'x');
    const args = [id, id, {}, fd, fd];
    const chamadas: string[] = [];
    for (const caminho of arquivos) {
      const m = (await import(/* @vite-ignore */ join(RAIZ, caminho))) as Record<string, unknown>;
      for (const [nome, fn] of Object.entries(m)) {
        if (typeof fn !== 'function') continue;
        chamadas.push(`${caminho}#${nome}`);
        await expect((fn as (...a: unknown[]) => Promise<unknown>)(...args), `${caminho}#${nome}`).rejects.toThrow('redirect /p/inicio');
      }
    }
    expect(chamadas.length).toBeGreaterThanOrEqual(40);
  });
});
