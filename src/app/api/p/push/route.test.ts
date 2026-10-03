import { beforeEach, describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({
  acesso: null as unknown,
  chave: 'B'.repeat(87) as string | undefined,
  resultado: 'inscrito' as 'inscrito' | 'de_outra_conta' | 'invalida',
  inscricoes: [] as { corpo: unknown; ua: string | null; deps: unknown }[],
  cancelados: [] as unknown[],
}));
vi.mock('@/lib/paciente-session', () => ({ requireApiPaciente: async () => estado.acesso }));
vi.mock('@/env', () => ({ getEnv: () => ({ APP_URL: 'http://localhost:3000', VAPID_PUBLIC_KEY: estado.chave }) }));
vi.mock('@/modules/portal/push-inscricao', async () => {
  class InscricaoInvalidaError extends Error {}
  return {
    InscricaoInvalidaError,
    MSG_PUSH: { indisponivel: 'Notificações no app ainda não estão disponíveis.', falhou: 'Não foi possível ativar as notificações. Tente de novo.' },
    inscreverAparelho: async (_a: unknown, corpo: unknown, ua: string | null, deps: unknown) => {
      estado.inscricoes.push({ corpo, ua, deps });
      if (estado.resultado === 'invalida') throw new InscricaoInvalidaError('x');
      return estado.resultado;
    },
    cancelarAparelho: async (_a: unknown, endpoint: unknown) => {
      estado.cancelados.push(endpoint);
    },
  };
});
const { DELETE, POST } = await import('./route');

const inscricao = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } };
const pedido = (o: { metodo?: string; corpo?: string; origin?: string; query?: string } = {}) =>
  new Request(`http://localhost:3000/api/p/push${o.query ?? ''}`, {
    method: o.metodo ?? 'POST',
    headers: { origin: o.origin ?? 'http://localhost:3000', 'content-type': 'application/json', 'user-agent': 'Chrome Android' },
    body: o.corpo ?? JSON.stringify(inscricao),
  });

beforeEach(() => {
  estado.acesso = { ok: true, ctx: {}, vinculos: [], data: { user: { id: 'u' } } };
  estado.chave = 'B'.repeat(87);
  estado.resultado = 'inscrito';
  estado.inscricoes = [];
  estado.cancelados = [];
});

describe('POST /api/p/push (US-040)', () => {
  it('sem VAPID_PUBLIC_KEY → 503 "Notificações no app ainda não estão disponíveis."', async () => {
    estado.chave = undefined;
    const r = await POST(pedido());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ erro: 'Notificações no app ainda não estão disponíveis.' });
    expect(estado.inscricoes).toEqual([]);
  });

  it('outra origem → 403; sem sessão → a recusa; nada inscrito', async () => {
    expect((await POST(pedido({ origin: 'https://evil.example' }))).status).toBe(403);
    estado.acesso = { ok: false, response: new Response(null, { status: 401 }) };
    expect((await POST(pedido())).status).toBe(401);
    expect(estado.inscricoes).toEqual([]);
  });

  it('corpo de 5 KB → 413; JSON quebrado → 400; inscrição inválida → 400 com a mensagem', async () => {
    expect((await POST(pedido({ corpo: JSON.stringify({ x: 'a'.repeat(5000) }) }))).status).toBe(413);
    expect((await POST(pedido({ corpo: '{' }))).status).toBe(400);
    estado.resultado = 'invalida';
    const r = await POST(pedido());
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ erro: 'Não foi possível ativar as notificações. Tente de novo.' });
  });

  it('válida → 204, com o user-agent e sincronizar: false', async () => {
    const r = await POST(pedido());
    expect(r.status).toBe(204);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(estado.inscricoes).toEqual([{ corpo: inscricao, ua: 'Chrome Android', deps: { sincronizar: false } }]);
  });

  it('?sincronizar=1 → sincronizar: true; 204 se a inscrição é desta conta, 409 se era de outra', async () => {
    expect((await POST(pedido({ query: '?sincronizar=1' }))).status).toBe(204);
    expect(estado.inscricoes[0].deps).toEqual({ sincronizar: true });
    estado.resultado = 'de_outra_conta';
    expect((await POST(pedido({ query: '?sincronizar=1' }))).status).toBe(409);
  });
});

describe('DELETE /api/p/push (Sair)', () => {
  it('204 e cancela o endpoint enviado; outra origem → 403', async () => {
    expect((await DELETE(pedido({ metodo: 'DELETE', corpo: JSON.stringify({ endpoint: inscricao.endpoint }) }))).status).toBe(204);
    expect(estado.cancelados).toEqual([inscricao.endpoint]);
    expect((await DELETE(pedido({ metodo: 'DELETE', origin: 'https://evil.example', corpo: '{}' }))).status).toBe(403);
    expect(estado.cancelados).toHaveLength(1);
  });

  it('funciona mesmo sem as chaves do VAPID (desligar o push não prende inscrição antiga)', async () => {
    estado.chave = undefined;
    expect((await DELETE(pedido({ metodo: 'DELETE', corpo: JSON.stringify({ endpoint: inscricao.endpoint }) }))).status).toBe(204);
  });
});
