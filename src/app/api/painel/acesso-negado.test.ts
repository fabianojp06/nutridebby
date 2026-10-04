import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { pacienteComConta } from '../../../../test/portal';
import { novoTenant } from '../../../../test/pacientes';
import { criarEEntrar, entrar } from '../../../../test/sessao';

// X-3 (Plano 06, T13): toda rota de `/api/painel` recusa a sessão de paciente e a do admin com 403 "Acesso negado" —
// nunca 500 nem dado. A lista sai do disco (todo `route.ts` sob esta pasta, todo método HTTP exportado): uma rota nova
// sem `requireApiNutri` quebra aqui. O E2E (`e2e/acessibilidade.spec.ts`) passa pelo proxy com uma amostra.
vi.mock('server-only', () => ({}));

const RAIZ = join(process.cwd(), 'src/app/api/painel');
const ROTAS = readdirSync(RAIZ, { recursive: true, encoding: 'utf8' })
  .filter((f) => f === 'route.ts' || f.endsWith('/route.ts'))
  .sort();
const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const ID = '00000000-0000-4000-8000-000000000000';
const db = getDb();
afterAll(() => closeDb());

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** Chama todo método de toda rota com a sessão de `cookie`; cada resposta tem de ser 403 { erro: 'Acesso negado' }. */
async function todasNegam(cookie: string): Promise<string[]> {
  const chamadas: string[] = [];
  for (const arquivo of ROTAS) {
    const segmentos = arquivo.split('/').slice(0, -1);
    const params = Object.fromEntries(segmentos.filter((s) => /^\[\w+\]$/.test(s)).map((s) => [s.slice(1, -1), ID]));
    const url = `http://localhost:3000/api/painel/${segmentos.map((s) => (/^\[\w+\]$/.test(s) ? ID : s)).join('/')}`;
    const m = (await import(/* @vite-ignore */ join(RAIZ, arquivo))) as Record<string, unknown>;
    for (const metodo of METODOS) {
      const fn = m[metodo];
      if (typeof fn !== 'function') continue;
      const rotulo = `${metodo} ${arquivo}`;
      chamadas.push(rotulo);
      const corpo = metodo === 'GET' || metodo === 'DELETE' ? undefined : '{}';
      const r = await (fn as Handler)(
        new Request(url, { method: metodo, body: corpo, headers: { cookie, ...(corpo ? { 'content-type': 'application/json' } : {}) } }),
        { params: Promise.resolve(params) },
      );
      expect(r.status, rotulo).toBe(403);
      expect(await r.json(), rotulo).toEqual({ erro: 'Acesso negado' });
    }
  }
  return chamadas;
}

describe('rotas de /api/painel fora da sessão de nutricionista', () => {
  it('acha os route.ts do painel', () => {
    expect(ROTAS.length).toBeGreaterThanOrEqual(8);
  });

  it('sessão de paciente → 403 em todas', async () => {
    const T = await novoTenant(db);
    const { email } = await pacienteComConta(db, T);
    expect((await todasNegam(await entrar(getAuth(), email))).length).toBeGreaterThanOrEqual(9);
  });

  it('sessão de admin → 403 em todas (US-004 "Admin não vê prontuário")', async () => {
    const a = await criarEEntrar(db, getAuth(), { appRole: 'admin', twoFactorEnabled: true });
    expect((await todasNegam(a.cookie)).length).toBeGreaterThanOrEqual(9);
  });
});
