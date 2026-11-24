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
// ação é público no HTML) vai ao aviso de outro papel (`/conta/outro-papel`, P09-03) — nunca erro 500 nem dado. Cobre TODA `actions.ts` de `src/app/painel` e de
// `src/app/admin` (X-3): uma ação nova sem `requireNutri`/`requireUser(['admin'])` quebra aqui. A sessão de
// nutricionista nas ações do admin vai ao mesmo aviso. As rotas de `/api/painel`: `src/app/api/painel/acesso-negado.test.ts`.
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
// Plano 26 (RE-D52): com a Equipe desligada, as actions dela respondem notFound() antes de ler a sessão; ligada aqui, para
// a guarda conferir o requireNutri delas como o das outras (o desligado é provado em configuracoes/equipe/actions.test.ts)
vi.mock('@/modules/plataforma/equipe-textos', async (original) => ({ ...(await original<typeof import('@/modules/plataforma/equipe-textos')>()), EQUIPE_LIGADA: true }));

const APP = join(process.cwd(), 'src/app');
/** Toda `actions.ts` sob `src/app/<raiz>`, com o caminho a partir de `src/app`. */
const acoesDe = (raiz: string) =>
  readdirSync(join(APP, raiz), { recursive: true, encoding: 'utf8' })
    .filter((f) => f === 'actions.ts' || f.endsWith('/actions.ts'))
    .map((f) => join(raiz, f))
    .sort();
const PAINEL = acoesDe('painel');
const ADMIN = acoesDe('admin');
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      await expect((fn as (...a: unknown[]) => Promise<unknown>)(...args), `${caminho}#${nome}`).rejects.toThrow(new RegExp(`^redirect ${escapar(destino)}$`));
    }
  }
  return chamadas;
}

describe('Server Actions do painel e do admin chamadas por uma sessão de paciente', () => {
  it('acha as actions.ts do painel e do admin', () => {
    expect(PAINEL.length).toBeGreaterThanOrEqual(10);
    expect(ADMIN).toContain('admin/actions.ts');
  });

  it('todas levam ao aviso de outro papel (P09-03), sem erro', async () => {
    const T = await novoTenant(db);
    const { email } = await pacienteComConta(db, T);
    const cookie = await entrar(getAuth(), email);
    const painel = await todasRedirecionam(PAINEL, cookie, '/conta/outro-papel?esperado=nutri');
    const admin = await todasRedirecionam(ADMIN, cookie, '/conta/outro-papel?esperado=admin');
    expect(painel.length).toBeGreaterThanOrEqual(40);
    expect(admin.length).toBeGreaterThanOrEqual(5);
  });
});

describe('Server Actions do admin chamadas por uma sessão de nutricionista (X-3)', () => {
  it('todas levam ao aviso de outro papel (P09-03), sem erro', async () => {
    const n = await nutriComDpa(db, getAuth());
    expect((await todasRedirecionam(ADMIN, n.cookie, '/conta/outro-papel?esperado=admin')).length).toBeGreaterThanOrEqual(5);
  });
});
