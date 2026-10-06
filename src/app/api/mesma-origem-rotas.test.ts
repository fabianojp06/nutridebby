import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { mesmaOrigem } from '@/lib/mesma-origem';

// P09-01 (manual técnico, cap. 01, divergência 12): toda rota de API que usa cookie e muda estado confere a origem
// (mesmaOrigem) ANTES da sessão. Sem cookie e com Origin de outro site, a resposta tem de ser 403 — uma rota sem a
// conferência leria a sessão e responderia 401. A lista sai do disco: TODO src/app/api é varrido (code review do PR #22,
// item 5), menos as pastas de EXCLUIDAS, cada uma com o motivo — rota nova (em pasta nova, inclusive) sem a conferência
// quebra aqui.
vi.mock('server-only', () => ({}));
// O 403 tem de sair da conferência de origem, não de outra recusa (Turnstile, papel): a guarda espia `mesmaOrigem` e
// exige, a cada chamada, que ela tenha sido consultada e devolvido false. Sem isso, tirar a conferência do POST de
// documento/[token]/codigo passaria (o corpo '{}' sem Turnstile também dá 403) — achado da revisão da Tarefa 1.
vi.mock('@/lib/mesma-origem', async (orig) => {
  const m = await orig<typeof import('@/lib/mesma-origem')>();
  return { mesmaOrigem: vi.fn(m.mesmaOrigem) };
});

/** Pastas de src/app/api fora da guarda: nenhuma usa o cookie da sessão para mudar estado. */
const EXCLUIDAS: Record<string, string> = {
  auth: 'o Better Auth confere a origem (trustedOrigins) nas rotas dele',
  n: 'página pública de agendamento: sem cookie; Turnstile e limite por IP',
  webhooks: 'chamada do provedor do WhatsApp: sem cookie; confere a assinatura',
  'csp-relatorio': 'relatório de CSP do navegador: sem sessão',
  'erro-cliente': 'erro do navegador para o Sentry: sem sessão',
  health: 'só GET, sem sessão',
  arquivos: 'só GET; vale a URL assinada (signFileUrl), não o cookie',
};
const METODOS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
const ID = '00000000-0000-4000-8000-000000000000';
const API = join(process.cwd(), 'src/app/api');
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const TODAS = readdirSync(API, { recursive: true, encoding: 'utf8' })
  .map((f) => f.replaceAll('\\', '/'))
  .filter((f) => f === 'route.ts' || f.endsWith('/route.ts'));
const ROTAS = TODAS.filter((f) => !(f.split('/')[0] in EXCLUIDAS)).sort();

describe('guarda de origem: a varredura cobre todo src/app/api (code review do PR #22, item 5)', () => {
  it('cada exclusão existe no disco e todo o resto é varrido (inclusive pasta nova)', () => {
    for (const pasta of Object.keys(EXCLUIDAS)) expect(existsSync(join(API, pasta)), `EXCLUIDAS: ${pasta} não existe mais`).toBe(true);
    const pastasVarridas = new Set(ROTAS.map((f) => f.split('/')[0]));
    for (const pasta of readdirSync(API, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
      if (!(pasta in EXCLUIDAS)) expect(pastasVarridas.has(pasta), `src/app/api/${pasta} fora da varredura`).toBe(true);
    }
    expect([...pastasVarridas].sort()).toEqual(expect.arrayContaining(['documento', 'p', 'painel']));
  });
});

describe('rotas de escrita com cookie: Origin de outro site → 403 antes da sessão (S-9, P09-01)', () => {
  it('todo POST/PUT/PATCH/DELETE recusa Origin estranho com 403', async () => {
    const chamadas: string[] = [];
    const espiao = vi.mocked(mesmaOrigem);
    for (const arquivo of ROTAS) {
      const segmentos = arquivo.split('/').slice(0, -1);
      const ehParam = (s: string) => /^\[\w+\]$/.test(s);
      const params = Object.fromEntries(segmentos.filter(ehParam).map((s) => [s.slice(1, -1), ID]));
      const url = `http://localhost:3000/api/${segmentos.map((s) => (ehParam(s) ? ID : s)).join('/')}`;
      const m = (await import(/* @vite-ignore */ join(API, arquivo))) as Record<string, unknown>;
      for (const metodo of METODOS) {
        if (typeof m[metodo] !== 'function') continue;
        chamadas.push(`${metodo} ${arquivo}`);
        espiao.mockClear();
        const r = await (m[metodo] as Handler)(
          new Request(url, { method: metodo, body: '{}', headers: { origin: 'https://evil.example', 'content-type': 'application/json' } }),
          { params: Promise.resolve(params) },
        );
        expect(r.status, `${metodo} ${arquivo}`).toBe(403);
        expect(espiao, `${metodo} ${arquivo}: o 403 não saiu de mesmaOrigem`).toHaveBeenCalled();
        expect(espiao.mock.results.map((x) => x.value), `${metodo} ${arquivo}`).toContain(false);
      }
    }
    expect(chamadas).toContain('PUT painel/planos/[id]/route.ts');
    expect(chamadas).toContain('POST p/diario/route.ts');
    expect(chamadas.length).toBeGreaterThanOrEqual(10);
  });
});
