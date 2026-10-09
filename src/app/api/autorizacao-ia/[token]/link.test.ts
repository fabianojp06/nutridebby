import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { stopBoss } from '@/jobs/boss';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { POST as autorizar } from './autorizar/route';
import { POST as retirar } from './retirar/route';

// O Turnstile de verdade iria à rede: aqui, só o token "ok" passa
vi.mock('@/lib/turnstile', () => ({ verifyTurnstile: async (t: string | null) => (t === 'ok' ? 'ok' : 'invalido') }));
getDb();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
type Rota = (req: Request, ctx: { params: Promise<{ token: string }> }) => Promise<Response>;
const bloco = `198.18.${Math.floor(Math.random() * 250)}`;
let n = 0;
const chamar = (rota: Rota, acao: string, token: string, o: { corpo?: string; origem?: string } = {}) =>
  rota(
    new Request(`http://localhost:3000/api/autorizacao-ia/${token}/${acao}`, {
      method: 'POST', body: o.corpo ?? '{}',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `${bloco}.${++n % 250}`, ...(o.origem ? { origin: o.origem } : {}) },
    }),
    { params: Promise.resolve({ token }) },
  );

describe('rotas do link da autorização de IA (US-107, US-109)', () => {
  it('outra origem → 403; sem Turnstile → 403 com o texto da US-107; token inválido → 410; corpo grande → 413', async () => {
    const t = 'x'.repeat(72);
    for (const [rota, acao] of [[autorizar, 'autorizar'], [retirar, 'retirar']] as const) {
      expect((await chamar(rota, acao, t, { origem: 'https://outro.site' })).status, acao).toBe(403);
      const semRobo = await chamar(rota, acao, t);
      expect(semRobo.status, acao).toBe(403);
      expect(await semRobo.json()).toEqual({ erro: MSG_AUTORIZACAO.robo });
      const r = await chamar(rota, acao, t, { corpo: JSON.stringify({ turnstile: 'ok' }) });
      expect(r.status, acao).toBe(410);
      expect(await r.json()).toEqual({ erro: MSG_AUTORIZACAO.linkInvalido });
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect((await chamar(rota, acao, t, { corpo: JSON.stringify({ turnstile: 'ok', lixo: 'x'.repeat(9000) }) })).status, acao).toBe(413);
    }
  });
});
