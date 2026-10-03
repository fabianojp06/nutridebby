import { describe, expect, it } from 'vitest';
import { assinarJwtWebhook, chaveDoWebhook, verificarJwtWebhook } from './jwt';

describe('chave do webhook por instância (D4 a)', () => {
  it('uma chave por instância, estável, sem o segredo-mestre dentro', () => {
    const S = 's'.repeat(40);
    const a = chaveDoWebhook(S, 'nd-0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f');
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(chaveDoWebhook(S, 'nd-0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f')).toBe(a);
    expect(chaveDoWebhook(S, 'nd-1c7e4d2f-9b8e-4d3c-8a21-2b3c4d5e6f70')).not.toBe(a);
    expect(chaveDoWebhook('t'.repeat(40), 'nd-0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f')).not.toBe(a);
    expect(a).not.toContain(S.slice(0, 8));
  });
});

const S = 'segredo-do-webhook-com-pelo-menos-32-caracteres';
const agora = new Date('2026-10-16T12:00:00Z');

describe('JWT do webhook da Evolution (D4)', () => {
  it('aceita o JWT HS256 do jwt_key (iat, exp = iat + 600, app/action da Evolution)', () => {
    expect(verificarJwtWebhook(assinarJwtWebhook(S, agora), S, agora)).toMatchObject({ ok: true });
  });
  it('recusa outro segredo, assinatura trocada, alg "none", expirado, emissor errado e lixo', () => {
    const t = assinarJwtWebhook(S, agora);
    expect(verificarJwtWebhook(t, `${S}x`, agora)).toEqual({ ok: false, motivo: 'assinatura' });
    expect(verificarJwtWebhook(`${t.slice(0, -2)}${t.endsWith('AA') ? 'BB' : 'AA'}`, S, agora)).toEqual({ ok: false, motivo: 'assinatura' });
    const [, p] = t.split('.');
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${p}.`;
    expect(verificarJwtWebhook(none, S, agora).ok).toBe(false);
    const hs512 = `${Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' })).toString('base64url')}.${p}.${t.split('.')[2]}`;
    expect(verificarJwtWebhook(hs512, S, agora)).toEqual({ ok: false, motivo: 'algoritmo' });
    expect(verificarJwtWebhook(t, S, new Date(agora.getTime() + 12 * 60_000))).toEqual({ ok: false, motivo: 'expirado' });
    expect(verificarJwtWebhook(assinarJwtWebhook(S, agora, { app: 'outro' }), S, agora)).toEqual({ ok: false, motivo: 'emissor' });
    expect(verificarJwtWebhook('x.y', S, agora)).toEqual({ ok: false, motivo: 'formato' });
  });
  it('bordas do relógio: 60 s de folga no exp e no iat; iat muito no futuro e validade acima de 15 min são recusados', () => {
    const t = assinarJwtWebhook(S, agora);
    expect(verificarJwtWebhook(t, S, new Date(agora.getTime() + 660_000))).toMatchObject({ ok: true }); // exp + 60 s
    expect(verificarJwtWebhook(t, S, new Date(agora.getTime() + 661_000))).toEqual({ ok: false, motivo: 'expirado' });
    expect(verificarJwtWebhook(t, S, new Date(agora.getTime() - 60_000))).toMatchObject({ ok: true }); // relógio da Evolution 60 s adiantado
    expect(verificarJwtWebhook(t, S, new Date(agora.getTime() - 61_000))).toEqual({ ok: false, motivo: 'expirado' });
    const iat = Math.floor(agora.getTime() / 1000);
    expect(verificarJwtWebhook(assinarJwtWebhook(S, agora, { exp: iat + 901 }), S, agora)).toEqual({ ok: false, motivo: 'expirado' });
    expect(verificarJwtWebhook(assinarJwtWebhook(S, agora, { exp: 'amanhã' }), S, agora)).toEqual({ ok: false, motivo: 'formato' });
    expect(verificarJwtWebhook(`${t}${'A'.repeat(2048)}`, S, agora)).toEqual({ ok: false, motivo: 'formato' });
  });
  it('revisão 1 (item 2): a assinatura só vale na grafia canônica — os 2 bits que sobram do último caractere não abrem outras 3 grafias (e outras 3 marcas anti-repetição)', () => {
    const t = assinarJwtWebhook(S, agora);
    const [h, p, s] = t.split('.');
    const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const i = ALFABETO.indexOf(s.at(-1)!);
    const grafias = [0, 1, 2, 3].map((b) => `${h}.${p}.${s.slice(0, -1)}${ALFABETO[(i & ~3) | b]}`);
    expect(new Set(grafias.map((g) => Buffer.from(g.split('.')[2], 'base64url').toString('hex'))).size).toBe(1); // os mesmos 32 bytes
    expect(grafias.filter((g) => verificarJwtWebhook(g, S, agora).ok)).toEqual([t]);
  });
  it('revisão 1 (item 3): diz por quanto tempo, no máximo, o JWT pode ser aceito (exp − iat + 2 × 60 s de folga + 1 s)', () => {
    expect(verificarJwtWebhook(assinarJwtWebhook(S, agora), S, agora)).toEqual({ ok: true, aceitoPorS: 721 });
    const iat = Math.floor(agora.getTime() / 1000);
    expect(verificarJwtWebhook(assinarJwtWebhook(S, agora, { exp: iat + 900 }), S, agora)).toEqual({ ok: true, aceitoPorS: 1021 });
  });
  it('D4 (a): o JWT assinado com a chave de uma instância não vale com a de outra, nem com o segredo-mestre', () => {
    const [a, b] = ['nd-0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f', 'nd-1c7e4d2f-9b8e-4d3c-8a21-2b3c4d5e6f70'].map((i) => chaveDoWebhook(S, i));
    const t = assinarJwtWebhook(a, agora);
    expect(verificarJwtWebhook(t, a, agora)).toMatchObject({ ok: true });
    expect(verificarJwtWebhook(t, b, agora)).toEqual({ ok: false, motivo: 'assinatura' });
    expect(verificarJwtWebhook(assinarJwtWebhook(S, agora), a, agora)).toEqual({ ok: false, motivo: 'assinatura' });
  });
});
