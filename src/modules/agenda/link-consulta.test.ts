import { describe, expect, it, vi } from 'vitest';
import { assinarLinkConsulta, chaveDosLinks, lerLinkConsulta, urlDaConsulta } from './link-consulta';

const chave = chaveDosLinks(Buffer.alloc(32, 9));
const c = { tenantId: '0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f', appointmentId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', inicio: new Date('2026-10-16T17:00:00Z'), email: 'ana@ex.com' };
/** O "banco" do teste: o e-mail atual do paciente da consulta (quem chama lê no contexto que já usa). */
const comEmail = (email: string | null) => vi.fn(async () => (email === null ? null : { email, outro: 1 }));

describe('link assinado da consulta (D20)', () => {
  it('ida e volta; 71 caracteres sem padding; expira no início da consulta; devolve o que o carregador leu', async () => {
    const t = assinarLinkConsulta(c, chave);
    expect(t).toMatch(/^[A-Za-z0-9_-]{71}$/);
    const carregar = comEmail('ana@ex.com');
    expect(await lerLinkConsulta(t, chave, new Date('2026-10-15T00:00:00Z'), carregar)).toEqual({
      link: { tenantId: c.tenantId, appointmentId: c.appointmentId, expiraEm: c.inicio, expirado: false },
      dados: { email: 'ana@ex.com', outro: 1 },
    });
    expect(carregar).toHaveBeenCalledWith({ tenantId: c.tenantId, appointmentId: c.appointmentId });
    expect((await lerLinkConsulta(t, chave, c.inicio, comEmail('ana@ex.com')))?.link.expirado).toBe(true);
    expect(urlDaConsulta('https://app.exemplo.com', t)).toBe(`https://app.exemplo.com/consulta/${t}`);
  });
  it('adulterado, de outra chave ou com outro tamanho → null; formato inválido nem chega ao banco', async () => {
    const t = assinarLinkConsulta(c, chave);
    const trocado = t.slice(0, 10) + (t[10] === 'A' ? 'B' : 'A') + t.slice(11);
    expect(await lerLinkConsulta(trocado, chave, new Date(), comEmail('ana@ex.com'))).toBeNull();
    expect(await lerLinkConsulta(t, chaveDosLinks(Buffer.alloc(32, 1)), new Date(), comEmail('ana@ex.com'))).toBeNull();
    for (const ruim of [`${t}A`, '../../etc', 42, undefined]) {
      const carregar = comEmail('ana@ex.com');
      expect(await lerLinkConsulta(ruim, chave, new Date(), carregar)).toBeNull();
      expect(carregar).not.toHaveBeenCalled();
    }
  });
  it('uma grafia só: trocar os 2 bits que o base64url ignora no último caractere → null', async () => {
    const t = assinarLinkConsulta(c, chave);
    const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const outra = t.slice(0, -1) + ALFABETO[ALFABETO.indexOf(t.at(-1)!) ^ 1];
    expect(Buffer.from(outra, 'base64url').equals(Buffer.from(t, 'base64url'))).toBe(true); // mesmos bytes…
    expect(await lerLinkConsulta(outra, chave, new Date('2026-10-15T00:00:00Z'), comEmail('ana@ex.com'))).toBeNull(); // …mas não é o link emitido
  });
  it('decisão do dono (fechamento): o e-mail do paciente entra na assinatura — corrigido o e-mail, o link emitido antes não vale; consulta/paciente que não existe → null', async () => {
    const t = assinarLinkConsulta(c, chave);
    const agora = new Date('2026-10-15T00:00:00Z');
    expect(await lerLinkConsulta(t, chave, agora, comEmail('ana.souza@ex.com'))).toBeNull();
    expect(await lerLinkConsulta(t, chave, agora, comEmail('ana@ex.co'))).toBeNull();
    expect(await lerLinkConsulta(t, chave, agora, comEmail(null))).toBeNull();
    // o mesmo endereço (citext: maiúsculas e espaços nas pontas não mudam o e-mail) continua valendo
    expect(await lerLinkConsulta(t, chave, agora, comEmail(' Ana@EX.com '))).not.toBeNull();
    // o link assinado com o e-mail novo vale para ele
    expect(await lerLinkConsulta(assinarLinkConsulta({ ...c, email: 'ana.souza@ex.com' }, chave), chave, agora, comEmail('ana.souza@ex.com'))).not.toBeNull();
  });
});
