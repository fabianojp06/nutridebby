import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { publicRateLimits } from '@/db/schema';
import { chaveDoLimite, consumirLimite, liberarLimite, limparLimites } from './limite-ip';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

describe('limite da página pública (RN-16)', () => {
  it('10 por hora: a 11ª é recusada; passada a janela, volta a contar do 1', async () => {
    const chave = chaveDoLimite('ip', `198.51.100.${Math.floor(Math.random() * 250)}-${Date.now()}`);
    const t0 = new Date('2026-10-16T12:00:00Z');
    for (let i = 0; i < 10; i++) expect(await consumirLimite(app.db, chave, 10, 3600, t0)).toBe(true);
    expect(await consumirLimite(app.db, chave, 10, 3600, new Date(t0.getTime() + 59 * 60_000))).toBe(false);
    expect(await consumirLimite(app.db, chave, 10, 3600, new Date(t0.getTime() + 61 * 60_000))).toBe(true);
  });

  it('liberarLimite (seed do E2E: o visitante da página pública começa cada execução do zero) zera o contador daquela chave (as outras continuam)', async () => {
    const a = chaveDoLimite('ip', `198.51.100.1-${Date.now()}`);
    const b = chaveDoLimite('ip', `198.51.100.2-${Date.now()}`);
    const t0 = new Date('2026-10-16T12:00:00Z');
    for (const c of [a, b]) expect(await consumirLimite(app.db, c, 1, 3600, t0)).toBe(true);
    await liberarLimite(app.db, a);
    expect(await consumirLimite(app.db, a, 1, 3600, t0)).toBe(true);
    expect(await consumirLimite(app.db, b, 1, 3600, t0)).toBe(false);
  });

  it('D4 (b): marca anti-repetição do webhook (tipo "webhook", HMAC, limite 1) vale a janela inteira da validade do JWT (aceitoPorS) e só nela', async () => {
    const chave = chaveDoLimite('webhook', `jwt.${Date.now()}.${Math.random()}`);
    expect(chave).toMatch(/^webhook:[A-Za-z0-9_-]{43}$/);
    const t0 = new Date('2026-10-16T12:00:00Z');
    const aceitoPorS = 721; // JWT padrão da Evolution: exp − iat (600) + 2 × 60 s de folga + 1 s
    expect(await consumirLimite(app.db, chave, 1, aceitoPorS, t0)).toBe(true);
    expect(await consumirLimite(app.db, chave, 1, aceitoPorS, new Date(t0.getTime() + aceitoPorS * 1000 - 1))).toBe(false);
    expect(await consumirLimite(app.db, chave, 1, aceitoPorS, new Date(t0.getTime() + aceitoPorS * 1000))).toBe(true);
  });

  it('pedidos simultâneos não passam do limite (o contador é atômico)', async () => {
    const chave = chaveDoLimite('ip', `198.51.100.77-${Date.now()}-${Math.random()}`);
    const agora = new Date('2026-10-16T12:00:00Z');
    const r = await Promise.all(Array.from({ length: 15 }, () => consumirLimite(app.db, chave, 10, 3600, agora)));
    expect(r.filter(Boolean)).toHaveLength(10);
  });

  it('a chave é HMAC (nunca o IP ou o e-mail) e limpar apaga só os de mais de 1 dia', async () => {
    const chave = chaveDoLimite('email-hora', 'tenant:ana@ex.com');
    expect(chave).toMatch(/^email-hora:[A-Za-z0-9_-]{43}$/);
    expect(chave).not.toContain('ana');
    const recente = chaveDoLimite('email-hora', `tenant:recente-${Date.now()}@ex.com`);
    // datas de 2001: a limpeza não alcança os contadores dos outros arquivos de teste, que rodam em paralelo no mesmo banco
    await consumirLimite(app.db, chave, 5, 3600, new Date('2001-01-01T00:00:00Z'));
    await consumirLimite(app.db, recente, 5, 3600, new Date('2001-01-02T12:00:00Z'));
    expect(await limparLimites(app.db, new Date('2001-01-03T00:00:00Z'))).toBeGreaterThanOrEqual(1);
    const restantes = (await app.db.select().from(publicRateLimits)).map((l) => l.chave);
    expect(restantes).not.toContain(chave);
    expect(restantes).toContain(recente);
  });
});
