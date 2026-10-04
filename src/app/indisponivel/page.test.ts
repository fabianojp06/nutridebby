import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { criarEEntrar, entrar } from '../../../test/sessao';

// S-3 (débitos pré-go-live): o paciente do consultório suspenso sai pelo SairPortal (cancela o push e apaga a cópia no
// Safari < 17); a equipe, pelo BotaoSair; sem sessão, nenhum "Sair".
const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));
vi.mock('@/app/p/sair-portal', () => ({ SairPortal: () => '[SairPortal]' }));
vi.mock('@/components/botao-sair', () => ({ BotaoSair: () => '[BotaoSair]' }));
vi.mock('@/app/p/esquecer-plano', () => ({ EsquecerPlanoGuardado: () => '[EsquecerPlanoGuardado]' }));

const { default: IndisponivelPage } = await import('./page');
const db = getDb();
afterAll(() => closeDb());
beforeEach(() => {
  req.headers = new Headers();
});

const pagina = async () => renderToStaticMarkup(await IndisponivelPage());

describe('/indisponivel: o "Sair" de cada papel', () => {
  it('paciente: SairPortal (limpa o aparelho) e a cópia offline sai; nunca o BotaoSair', async () => {
    const A = await novoTenant(db);
    const { email } = await pacienteComConta(db, A);
    req.headers = new Headers({ cookie: await entrar(getAuth(), email) });
    const html = await pagina();
    expect(html).toContain('[SairPortal]');
    expect(html).toContain('[EsquecerPlanoGuardado]');
    expect(html).not.toContain('[BotaoSair]');
  });

  it('nutricionista: BotaoSair; sem sessão: nenhum "Sair"', async () => {
    const [t] = await db.insert(tenants).values({ slug: `ind-${randomUUID().slice(0, 8)}`, nomeExibicao: 'X' }).returning();
    const n = await criarEEntrar(db, getAuth(), { appRole: 'nutri', tenantId: t.id });
    req.headers = new Headers({ cookie: n.cookie });
    const html = await pagina();
    expect(html).toContain('[BotaoSair]');
    expect(html).not.toContain('[SairPortal]');
    expect(html).not.toContain('[EsquecerPlanoGuardado]');
    req.headers = new Headers();
    expect(await pagina()).not.toMatch(/BotaoSair|SairPortal/);
  });
});
