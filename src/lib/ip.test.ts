import { describe, expect, it } from 'vitest';
import { clientIp } from './ip';

const h = (xff?: string) => new Headers(xff ? { 'x-forwarded-for': xff } : {});

describe('clientIp (mesma regra do limite de tentativas do Better Auth)', () => {
  it('sem proxies confiáveis, usa o valor único do X-Forwarded-For', () => {
    expect(clientIp(h('203.0.113.9'), [])).toBe('203.0.113.9');
  });
  it('com proxies confiáveis, ignora da direita para a esquerda os saltos confiáveis', () => {
    expect(clientIp(h('198.51.100.7, 10.0.1.2'), ['10.0.0.0/8'])).toBe('198.51.100.7');
  });
  it('um IP falso colocado pelo cliente à esquerda não vence o IP real', () => {
    expect(clientIp(h('1.2.3.4, 198.51.100.7, 10.0.1.2'), ['10.0.0.0/8'])).toBe('198.51.100.7');
  });
  it('IPv6 sai completo (/128), não truncado no /64 do limite de tentativas (F1)', () => {
    expect(clientIp(h('2001:db8:1:2:a:b:c:d'), [])).toBe('2001:0db8:0001:0002:000a:000b:000c:000d');
    expect(clientIp(h('2001:db8::1, 10.0.1.2'), ['10.0.0.0/8'])).toBe('2001:0db8:0000:0000:0000:0000:0000:0001');
  });
  it('em teste/dev, sem cabeçalho, cai no localhost (comportamento do Better Auth)', () => {
    expect(clientIp(h(), [])).toBe('127.0.0.1');
  });
});
