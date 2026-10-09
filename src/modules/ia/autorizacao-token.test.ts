import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assinarLinkPedido, assinarLinkRetirada, codigoDeReferencia, emailHmac, lerLinkAutorizacao } from './autorizacao-token';

const ids = { tenantId: randomUUID(), patientId: randomUUID() };
const emitidoEm = new Date('2026-10-09T12:00:00Z');
const trocarUm = (t: string, i: number) => t.slice(0, i) + (t[i] === 'A' ? 'B' : 'A') + t.slice(i + 1);

describe('links da autorização de IA (RN-107, D11, D12)', () => {
  it('pedido: 72 caracteres; confere só com o e-mail atual (maiúsculas e espaços não importam); ids e emissão de volta', () => {
    const t = assinarLinkPedido({ ...ids, emitidoEm, email: 'Ana@Ex.com' });
    expect(t).toMatch(/^[A-Za-z0-9_-]{72}$/);
    const l = lerLinkAutorizacao(t)!;
    expect(l).toMatchObject({ tipo: 'pedido', ...ids, emitidoEm });
    expect(l.confere(' ana@ex.com ')).toBe(true);
    expect(l.confere('outra@ex.com')).toBe(false);
    expect(l.confere(null)).toBe(false);
  });

  it('retirada: 88 caracteres, amarrada ao id da autorização, sem o e-mail (não morre com o e-mail corrigido)', () => {
    const autorizacaoId = randomUUID();
    const t = assinarLinkRetirada({ ...ids, autorizacaoId });
    expect(t).toMatch(/^[A-Za-z0-9_-]{88}$/);
    const l = lerLinkAutorizacao(t)!;
    expect(l).toMatchObject({ tipo: 'retirada', ...ids, autorizacaoId });
    expect(l.confere(null)).toBe(true);
    expect(l.confere('qualquer@ex.com')).toBe(true);
  });

  it('adulterado, de outro tamanho ou de outra versão → null ou não confere', () => {
    const t = assinarLinkPedido({ ...ids, emitidoEm, email: 'ana@ex.com' });
    for (const i of [3, 30, 60, 71]) {
      const l = lerLinkAutorizacao(trocarUm(t, i));
      expect(l === null || !l.confere('ana@ex.com'), String(i)).toBe(true);
    }
    for (const lixo of [undefined, 123, '', t.slice(1), `${t}A`, 'x'.repeat(72), t.replace(/./, '_')]) {
      const l = lerLinkAutorizacao(lixo);
      expect(l === null || !l.confere('ana@ex.com')).toBe(true);
    }
    const r = assinarLinkRetirada({ ...ids, autorizacaoId: randomUUID() });
    expect(lerLinkAutorizacao(trocarUm(r, 87))?.confere(null) ?? false).toBe(false);
  });

  it('o HMAC do e-mail normaliza e nunca é o e-mail; o código de referência é XXXX-XXXX-XXXX, fixo por tenant, paciente e versão', () => {
    expect(emailHmac('Ana@Ex.com ')).toBe(emailHmac('ana@ex.com'));
    expect(emailHmac('ana@ex.com')).not.toContain('ana');
    expect(emailHmac('ana@ex.com')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const c = codigoDeReferencia(ids.tenantId, ids.patientId, '0.1-provisorio');
    expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(codigoDeReferencia(ids.tenantId, ids.patientId, '0.1-provisorio')).toBe(c);
    expect(codigoDeReferencia(ids.tenantId, randomUUID(), '0.1-provisorio')).not.toBe(c);
    expect(codigoDeReferencia(ids.tenantId, ids.patientId, '1.0')).not.toBe(c);
  });
});
