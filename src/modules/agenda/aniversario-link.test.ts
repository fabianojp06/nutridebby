import { describe, expect, it } from 'vitest';
import { encryptionKey } from '@/lib/crypto';
import { assinarLinkPedido, assinarLinkRetirada } from '@/modules/ia/autorizacao-token';
import { assinarLinkDeSaida, FINALIDADE_ANIVERSARIO, lerLinkDeSaida } from './aniversario-link';
import { assinarLinkConsulta, chaveDosLinks } from './link-consulta';

/** Plano 23 (RN-434, AG-D50): o token do link de saída das mensagens de aniversário, puro e sem estado. */
const ids = { tenantId: '0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f', patientId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' };

describe('link de saída do aniversário (AG-D50)', () => {
  it('ida e volta: 66 caracteres base64url; devolve só o tenant e o paciente; finalidade aniversario_sair', () => {
    const t = assinarLinkDeSaida(ids);
    expect(t).toMatch(/^[A-Za-z0-9_-]{66}$/);
    expect(lerLinkDeSaida(t)).toEqual(ids);
    expect(FINALIDADE_ANIVERSARIO).toBe('aniversario_sair');
    // sem estado: o mesmo titular dá sempre o mesmo token (não vence, RN-434)
    expect(assinarLinkDeSaida(ids)).toBe(t);
  });

  it('um caractere trocado, outro paciente no corpo, tamanho errado ou outro tipo → null', () => {
    const t = assinarLinkDeSaida(ids);
    const trocado = `${t.slice(0, 40)}${t[40] === 'A' ? 'B' : 'A'}${t.slice(41)}`;
    expect(lerLinkDeSaida(trocado)).toBeNull();
    expect(lerLinkDeSaida(t.slice(0, 65))).toBeNull();
    expect(lerLinkDeSaida(`${t}A`)).toBeNull();
    for (const lixo of [undefined, null, 42, {}, ['x'], '', 'a'.repeat(66), `${t.slice(0, 65)}=`]) expect(lerLinkDeSaida(lixo)).toBeNull();
    // o corpo de outro paciente com a assinatura deste não abre
    const outro = Buffer.from(assinarLinkDeSaida({ ...ids, patientId: '11111111-2222-4333-8444-555555555555' }), 'base64url');
    const meu = Buffer.from(t, 'base64url');
    expect(lerLinkDeSaida(Buffer.concat([outro.subarray(0, 33), meu.subarray(33)]).toString('base64url'))).toBeNull();
  });

  it('token de outra finalidade não abre: link da consulta, pedido e retirada da autorização de IA', () => {
    const consulta = assinarLinkConsulta({ tenantId: ids.tenantId, appointmentId: ids.patientId, inicio: new Date('2026-12-01T12:00:00Z'), email: 'ana@ex.com' }, chaveDosLinks(encryptionKey()));
    const pedidoIa = assinarLinkPedido({ ...ids, emitidoEm: new Date('2026-11-20T12:00:00Z'), email: 'ana@ex.com' });
    const retiradaIa = assinarLinkRetirada({ ...ids, autorizacaoId: '22222222-3333-4444-8555-666666666666' });
    for (const t of [consulta, pedidoIa, retiradaIa]) expect(lerLinkDeSaida(t), t).toBeNull();
    // e o token do aniversário não serve à IA nem à consulta (o formato e a chave são outros)
    expect(assinarLinkDeSaida(ids)).not.toMatch(/^(?:[A-Za-z0-9_-]{71}|[A-Za-z0-9_-]{72}|[A-Za-z0-9_-]{88})$/);
  });
});
