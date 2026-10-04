import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { pacienteComConta } from '../../../test/portal';
import { novoTenant } from '../../../test/pacientes';
import { nutriComDpa } from '../../../test/nutri';
import { entrar } from '../../../test/sessao';

// Plano 06, T13 (revisão da T3): uma sessão de paciente que dispara uma Server Action do painel ou do admin (o ID da
// ação é público no HTML) volta ao portal — nunca erro 500 nem dado. Cobre TODA `actions.ts` de `src/app/painel` e de
// `src/app/admin` (X-3): uma ação nova sem `requireNutri`/`requireUser(['admin'])` quebra aqui. A sessão de
// nutricionista nas ações do admin volta ao painel. As rotas de `/api/painel`: `src/app/api/painel/acesso-negado.test.ts`.
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

const APP = join(process.cwd(), 'src/app');
/** Toda `actions.ts` sob `src/app/<raiz>`, com o caminho a partir de `src/app`. */
const acoesDe = (raiz: string) =>
  readdirSync(join(APP, raiz), { recursive: true, encoding: 'utf8' })
    .filter((f) => f === 'actions.ts' || f.endsWith('/actions.ts'))
    .map((f) => join(raiz, f))
    .sort();
const PAINEL = acoesDe('painel');
const ADMIN = acoesDe('admin');
const db = getDb();
afterAll(() => closeDb());

/** Chama toda função exportada dos arquivos com a sessão de `cookie`; cada uma tem de redirecionar para `destino`. */
async function todasRedirecionam(arquivos: string[], cookie: string, destino: string): Promise<string[]> {
  req.headers = new Headers({ cookie });
  const id = randomUUID();
  const fd = new FormData();
  fd.set('nome', 'x');
  const args = [id, id, {}, fd, fd];
  const chamadas: string[] = [];
  for (const caminho of arquivos) {
    const m = (await import(/* @vite-ignore */ join(APP, caminho))) as Record<string, unknown>;
    for (const [nome, fn] of Object.entries(m)) {
      if (typeof fn !== 'function') continue;
      chamadas.push(`${caminho}#${nome}`);
      await expect((fn as (...a: unknown[]) => Promise<unknown>)(...args), `${caminho}#${nome}`).rejects.toThrow(new RegExp(`^redirect ${destino}$`));
    }
  }
  return chamadas;
}

describe('Server Actions do painel e do admin chamadas por uma sessão de paciente', () => {
  it('acha as actions.ts do painel e do admin', () => {
    expect(PAINEL.length).toBeGreaterThanOrEqual(10);
    expect(ADMIN).toContain('admin/actions.ts');
  });

  it('todas voltam ao portal (redirect /p/inicio), sem erro', async () => {
    const T = await novoTenant(db);
    const { email } = await pacienteComConta(db, T);
    const chamadas = await todasRedirecionam([...PAINEL, ...ADMIN], await entrar(getAuth(), email), '/p/inicio');
    expect(chamadas.filter((c) => c.startsWith('painel/')).length).toBeGreaterThanOrEqual(40);
    expect(chamadas.filter((c) => c.startsWith('admin/')).length).toBeGreaterThanOrEqual(5);
  });
});

describe('Server Actions do admin chamadas por uma sessão de nutricionista (X-3)', () => {
  it('todas voltam ao painel (redirect /painel), sem erro', async () => {
    const n = await nutriComDpa(db, getAuth());
    expect((await todasRedirecionam(ADMIN, n.cookie, '/painel')).length).toBeGreaterThanOrEqual(5);
  });
});
