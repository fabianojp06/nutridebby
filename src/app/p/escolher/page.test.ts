import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { novoTenant } from '../../../../test/pacientes';
import { pacienteComConta } from '../../../../test/portal';
import { entrar } from '../../../../test/sessao';

// RN-15 na escolha (Ruling da T3): o consultório suspenso aparece sem botão; com todos suspensos, /indisponivel.
const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => req.headers, cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`redirect ${url}`), { url });
  },
}));
vi.mock('./actions', () => ({ escolherAction: async () => undefined }));
vi.mock('../esquecer-plano', () => ({ EsquecerPlanoGuardado: ({ manter }: { manter?: string[] }) => `[EsquecerPlanoGuardado manter=${manter?.join(',') ?? 'tudo'}]` }));

const { default: EscolherNutri } = await import('./page');
const db = getDb();
afterAll(() => closeDb());
beforeEach(() => {
  req.headers = new Headers();
});

const pagina = async () => renderToStaticMarkup(await EscolherNutri({ searchParams: Promise.resolve({}) } as never));

describe('/p/escolher com consultório suspenso (RN-15)', () => {
  it('o suspenso aparece sem botão, com "Conta temporariamente indisponível"; o ativo continua escolhível', async () => {
    const A = await novoTenant(db, 'Ana Nutri');
    const B = await novoTenant(db, 'Bia Nutri');
    const a = await pacienteComConta(db, A);
    await pacienteComConta(db, B, { userId: a.userId });
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, A.tenantId));
    req.headers = new Headers({ cookie: await entrar(getAuth(), a.email) });
    const html = await pagina();
    expect(html).toContain('Bia Nutri</button>');
    expect(html).not.toContain('Ana Nutri</button>');
    expect(html).toContain('<p>Ana Nutri</p><p class="text-sm">Conta temporariamente indisponível</p>');
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it('todos os consultórios suspensos → /indisponivel', async () => {
    const A = await novoTenant(db);
    const B = await novoTenant(db);
    const a = await pacienteComConta(db, A);
    await pacienteComConta(db, B, { userId: a.userId });
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, A.tenantId));
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, B.tenantId));
    req.headers = new Headers({ cookie: await entrar(getAuth(), a.email) });
    await expect(pagina()).rejects.toMatchObject({ url: '/indisponivel' });
  });

  it('S-6 + achado 4 do /code-review: a cópia offline sai na escolha só se não for de um vínculo escolhível (a do consultório ativo fica)', async () => {
    const A = await novoTenant(db);
    const B = await novoTenant(db);
    const a = await pacienteComConta(db, A);
    const b = await pacienteComConta(db, B, { userId: a.userId });
    req.headers = new Headers({ cookie: await entrar(getAuth(), a.email) });
    const manter = (html: string) => html.match(/\[EsquecerPlanoGuardado manter=([^\]]*)\]/)?.[1].split(',').sort();
    expect(manter(await pagina())).toEqual([a.paciente.id, b.paciente.id].sort());
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, A.tenantId));
    expect(manter(await pagina())).toEqual([b.paciente.id]); // a cópia do suspenso sai; a do ativo, não
  });
});
