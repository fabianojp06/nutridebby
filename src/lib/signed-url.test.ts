import { describe, expect, it } from 'vitest';
import { FILE_URL_TTL_S, signFileUrl, verifyFileUrl } from './signed-url';

const secret = 'segredo-de-teste-com-mais-de-32-caracteres';
const caminho = '11111111-1111-4111-8111-111111111111/logo/22222222-2222-4222-8222-222222222222.png';
const t0 = new Date('2026-10-01T12:00:00Z');
const params = (url: string) => new URL(url, 'http://x').searchParams;

describe('URL assinada de arquivo (§4: TTL 5 min)', () => {
  it('vale por 5 minutos e depois expira', () => {
    const url = signFileUrl(caminho, { now: t0, secret });
    expect(url).toMatch(/^\/api\/arquivos\?c=/);
    expect(verifyFileUrl(params(url), { now: new Date(t0.getTime() + (FILE_URL_TTL_S - 1) * 1000), secret })).toEqual({
      ok: true,
      caminho,
    });
    expect(verifyFileUrl(params(url), { now: new Date(t0.getTime() + (FILE_URL_TTL_S + 1) * 1000), secret })).toEqual({
      ok: false,
      motivo: 'expirado',
    });
  });
  it('trocar o caminho, a validade ou o segredo invalida a assinatura', () => {
    const p = params(signFileUrl(caminho, { now: t0, secret }));
    const outro = new URLSearchParams(p);
    outro.set('c', caminho.replace('/logo/', '/exame/').replace('.png', '.pdf'));
    expect(verifyFileUrl(outro, { now: t0, secret })).toEqual({ ok: false, motivo: 'assinatura' });
    const maisTempo = new URLSearchParams(p);
    maisTempo.set('e', String(Number(p.get('e')) + 3600));
    expect(verifyFileUrl(maisTempo, { now: t0, secret })).toEqual({ ok: false, motivo: 'assinatura' });
    expect(verifyFileUrl(p, { now: t0, secret: 'outro-segredo-com-mais-de-32-caracteres!!' })).toEqual({
      ok: false,
      motivo: 'assinatura',
    });
  });
  it('caminho fora do formato (path traversal, SVG, absoluto) é recusado antes de tudo', () => {
    for (const c of ['../../etc/passwd', '/etc/passwd', caminho.replace('.png', '.svg'), `${caminho}/../../x.png`]) {
      expect(verifyFileUrl(new URLSearchParams({ c, e: '9999999999', s: 'x' }), { now: t0, secret })).toEqual({
        ok: false,
        motivo: 'caminho',
      });
    }
    expect(() => signFileUrl('../x.png', { secret })).toThrow();
  });
});
