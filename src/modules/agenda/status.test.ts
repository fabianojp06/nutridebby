import { describe, expect, expectTypeOf, it } from 'vitest';
import { ROTULO_STATUS as ROTULO_DO_PAINEL } from '@/app/painel/agenda/periodo';
import { STATUS_ATIVOS, type Consulta, type StatusConsulta } from './consultas';
import { pedidoVencido, ROTULO_STATUS, selosDaConsulta, SITUACAO_NO_PORTAL, situacaoNoPortal, STATUS_OCUPA } from './status';

describe('status.ts (Plano 23, AG-D57)', () => {
  it('ROTULO_STATUS tem uma chave por StatusConsulta, e o painel reexporta o mesmo mapa', () => {
    expectTypeOf<keyof typeof ROTULO_STATUS>().toEqualTypeOf<StatusConsulta>();
    expect(ROTULO_STATUS).toEqual({ agendada: 'Agendada', confirmada: 'Confirmada', cancelada: 'Cancelada', realizada: 'Realizada', faltou: 'Faltou', solicitada: 'Pedido a responder' });
    expect(ROTULO_DO_PAINEL).toBe(ROTULO_STATUS);
  });

  it("STATUS_OCUPA = [...STATUS_ATIVOS, 'solicitada'] (spec §4.3); STATUS_ATIVOS não muda", () => {
    expect(STATUS_OCUPA).toEqual([...STATUS_ATIVOS, 'solicitada']);
    expect(STATUS_ATIVOS).toEqual(['agendada', 'confirmada']);
  });
});

const base: Consulta = {
  id: '1', patientId: 'p', paciente: 'Ana Souza', pacienteNovoPublico: false, inicio: new Date('2026-10-16T19:00:00Z'), fim: new Date('2026-10-16T20:00:00Z'), modalidade: 'presencial',
  linkOnline: null, status: 'solicitada', origem: 'paciente', confirmadaVia: null, canceladoPor: null, pedidoRemarcacaoEm: null, remarcadaDe: null, localId: null, local: null,
};

describe('Plano 23 (T6a): o pedido nos selos e no portal (AG-D43, AG-D44, RN-427)', () => {
  it('selos: "Pedido a responder"; os três cancelado_por de pedido; "sistema" continua só a exclusão', () => {
    expect(selosDaConsulta(base, false)).toEqual(['Pedido a responder']);
    expect(selosDaConsulta({ ...base, pedidoRemarcacaoEm: new Date() }, true)).toEqual(['Pedido a responder', 'Paciente pediu para remarcar', 'Consulta dentro de um bloqueio']);
    const cancelada = (canceladoPor: Consulta['canceladoPor']) => selosDaConsulta({ ...base, status: 'cancelada', canceladoPor }, false);
    expect(cancelada('pedido_desistido')).toEqual(['Pedido retirado pelo paciente']);
    expect(cancelada('pedido_recusado')).toEqual(['Pedido não aceito']);
    expect(cancelada('pedido_vencido')).toEqual(['Pedido vencido']);
    expect(cancelada('sistema')).toEqual(['Cancelada pelo pedido de exclusão']);
  });

  it('portal: SITUACAO_NO_PORTAL é Record<StatusConsulta, string>; o pedido aguarda; recusado e vencido "Não confirmado", desistido "Pedido cancelado"', () => {
    expectTypeOf<keyof typeof SITUACAO_NO_PORTAL>().toEqualTypeOf<StatusConsulta>();
    expect(SITUACAO_NO_PORTAL.solicitada).toBe('Aguardando confirmação da nutricionista');
    const t = { antecedenciaMinH: 12 };
    const cedo = new Date('2026-10-16T06:59:00Z'); // 03:59 em São Paulo: o pedido das 16:00 ainda não venceu
    expect(situacaoNoPortal(base, t, cedo)).toBe('Aguardando confirmação da nutricionista');
    expect(situacaoNoPortal({ ...base, status: 'cancelada', canceladoPor: 'pedido_recusado' }, t, cedo)).toBe('Não confirmado');
    expect(situacaoNoPortal({ ...base, status: 'cancelada', canceladoPor: 'pedido_vencido' }, t, cedo)).toBe('Não confirmado');
    expect(situacaoNoPortal({ ...base, status: 'cancelada', canceladoPor: 'pedido_desistido' }, t, cedo)).toBe('Pedido cancelado');
    expect(situacaoNoPortal({ ...base, status: 'cancelada', canceladoPor: 'paciente' }, t, cedo)).toBe('Cancelada');
    expect(situacaoNoPortal({ ...base, status: 'agendada' }, t, cedo)).toBe('Agendada');
    // leitura preguiçosa (RN-427): vencido e ainda não processado pela varredura já aparece como "Não confirmado"
    const as4 = new Date('2026-10-16T07:00:00Z');
    expect(pedidoVencido(base, t, cedo)).toBe(false);
    expect(pedidoVencido(base, t, as4)).toBe(true);
    expect(situacaoNoPortal(base, t, as4)).toBe('Não confirmado');
    expect(pedidoVencido({ ...base, status: 'agendada' }, t, as4)).toBe(false);
  });
});
