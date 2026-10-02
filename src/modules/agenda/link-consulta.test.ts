import { describe, expect, it } from 'vitest';
import { assinarLinkConsulta, chaveDosLinks, lerLinkConsulta, urlDaConsulta } from './link-consulta';

const chave = chaveDosLinks(Buffer.alloc(32, 9));
const c = { tenantId: '0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f', appointmentId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', inicio: new Date('2026-10-16T17:00:00Z') };

describe('link assinado da consulta (D20)', () => {
  it('ida e volta; 71 caracteres sem padding; expira no início da consulta', () => {
    const t = assinarLinkConsulta(c, chave);
    expect(t).toMatch(/^[A-Za-z0-9_-]{71}$/);
    expect(lerLinkConsulta(t, chave, new Date('2026-10-15T00:00:00Z'))).toEqual({ tenantId: c.tenantId, appointmentId: c.appointmentId, expiraEm: c.inicio, expirado: false });
    expect(lerLinkConsulta(t, chave, c.inicio)?.expirado).toBe(true);
    expect(urlDaConsulta('https://app.exemplo.com', t)).toBe(`https://app.exemplo.com/consulta/${t}`);
  });
  it('adulterado, de outra chave ou com outro tamanho → null', () => {
    const t = assinarLinkConsulta(c, chave);
    const trocado = t.slice(0, 10) + (t[10] === 'A' ? 'B' : 'A') + t.slice(11);
    expect(lerLinkConsulta(trocado, chave, new Date())).toBeNull();
    expect(lerLinkConsulta(t, chaveDosLinks(Buffer.alloc(32, 1)), new Date())).toBeNull();
    expect(lerLinkConsulta(`${t}A`, chave, new Date())).toBeNull();
    expect(lerLinkConsulta('../../etc', chave, new Date())).toBeNull();
  });
  it('uma grafia só: trocar os 2 bits que o base64url ignora no último caractere → null', () => {
    const t = assinarLinkConsulta(c, chave);
    const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const outra = t.slice(0, -1) + ALFABETO[ALFABETO.indexOf(t.at(-1)!) ^ 1];
    expect(Buffer.from(outra, 'base64url').equals(Buffer.from(t, 'base64url'))).toBe(true); // mesmos bytes…
    expect(lerLinkConsulta(outra, chave, new Date('2026-10-15T00:00:00Z'))).toBeNull(); // …mas não é o link emitido
  });
});
