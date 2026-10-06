import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// P09-01 (manual técnico, cap. 01, divergência 12): toda rota de API que usa cookie e muda estado confere a origem
// (mesmaOrigem) ANTES da sessão. Sem cookie e com Origin de outro site, a resposta tem de ser 403 — uma rota sem a
// conferência leria a sessão e responderia 401. A lista sai do disco: rota nova sem a conferência quebra aqui.
// Fora daqui, de propósito: /api/auth (o Better Auth confere a origem), /api/n (página pública, sem cookie, Turnstile),
// /api/webhooks (assinatura), /api/csp-relatorio e /api/erro-cliente (sem sessão).
vi.mock('server-only', () => ({}));

const PASTAS = ['painel', 'p', 'documento'] as const;
const METODOS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
const ID = '00000000-0000-4000-8000-000000000000';
const API = join(process.cwd(), 'src/app/api');
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const ROTAS = PASTAS.flatMap((pasta) =>
  readdirSync(join(API, pasta), { recursive: true, encoding: 'utf8' })
    .filter((f) => f === 'route.ts' || f.endsWith('/route.ts'))
    .map((f) => `${pasta}/${f}`),
).sort();

describe('rotas de escrita com cookie: Origin de outro site → 403 antes da sessão (S-9, P09-01)', () => {
  it('todo POST/PUT/PATCH/DELETE recusa Origin estranho com 403', async () => {
    const chamadas: string[] = [];
    for (const arquivo of ROTAS) {
      const segmentos = arquivo.split('/').slice(0, -1);
      const ehParam = (s: string) => /^\[\w+\]$/.test(s);
      const params = Object.fromEntries(segmentos.filter(ehParam).map((s) => [s.slice(1, -1), ID]));
      const url = `http://localhost:3000/api/${segmentos.map((s) => (ehParam(s) ? ID : s)).join('/')}`;
      const m = (await import(/* @vite-ignore */ join(API, arquivo))) as Record<string, unknown>;
      for (const metodo of METODOS) {
        if (typeof m[metodo] !== 'function') continue;
        chamadas.push(`${metodo} ${arquivo}`);
        const r = await (m[metodo] as Handler)(
          new Request(url, { method: metodo, body: '{}', headers: { origin: 'https://evil.example', 'content-type': 'application/json' } }),
          { params: Promise.resolve(params) },
        );
        expect(r.status, `${metodo} ${arquivo}`).toBe(403);
      }
    }
    expect(chamadas).toContain('PUT painel/planos/[id]/route.ts');
    expect(chamadas).toContain('POST p/diario/route.ts');
    expect(chamadas.length).toBeGreaterThanOrEqual(10);
  });
});
