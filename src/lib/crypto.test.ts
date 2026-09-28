import { describe, expect, it } from 'vitest';
import { openSecret, randomToken, safeEqual, sealSecret, SealError, sha256 } from './crypto';

const key = Buffer.alloc(32, 1);
const outra = Buffer.alloc(32, 2);

describe('cofre de segredos (AES-256-GCM)', () => {
  it('abre o que selou, e o selado não contém o texto', () => {
    const link = 'https://app.exemplo.com/convite/abc123-token';
    const s = sealSecret(link, 'email-job', key);
    expect(s).toMatch(/^v1\./);
    expect(s).not.toContain('abc123');
    expect(openSecret(s, 'email-job', key)).toBe(link);
  });
  it('dois selos do mesmo texto são diferentes (IV aleatório)', () => {
    expect(sealSecret('x', 'f', key)).not.toBe(sealSecret('x', 'f', key));
  });
  it('recusa chave errada, finalidade errada e conteúdo adulterado', () => {
    const s = sealSecret('segredo', 'email-job', key);
    expect(() => openSecret(s, 'email-job', outra)).toThrow(SealError);
    expect(() => openSecret(s, 'outra-finalidade', key)).toThrow(SealError);
    const [v, iv, ct, tag] = s.split('.');
    const adulterado = [v, iv, ct.slice(0, -2) + (ct.endsWith('AA') ? 'BA' : 'AA'), tag].join('.');
    expect(() => openSecret(adulterado, 'email-job', key)).toThrow(SealError);
    expect(() => openSecret('lixo', 'email-job', key)).toThrow(SealError);
  });
  it('selo de texto vazio também funciona', () => {
    expect(openSecret(sealSecret('', 'f', key), 'f', key)).toBe('');
  });
});

describe('tokens e hash', () => {
  it('randomToken tem 256 bits em base64url', () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(t);
  });
  it('sha256 é determinístico e não devolve o valor original', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).not.toContain('abc');
    expect(sha256('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });
  it('safeEqual compara sem atalho e aceita tamanhos diferentes', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
