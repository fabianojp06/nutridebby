import { describe, expect, expectTypeOf, it } from 'vitest';
import { ROTULO_STATUS as ROTULO_DO_PAINEL } from '@/app/painel/agenda/periodo';
import { STATUS_ATIVOS, type StatusConsulta } from './consultas';
import { ROTULO_STATUS, STATUS_OCUPA } from './status';

describe('status.ts (Plano 23, AG-D57)', () => {
  it('ROTULO_STATUS tem uma chave por StatusConsulta, e o painel reexporta o mesmo mapa', () => {
    expectTypeOf<keyof typeof ROTULO_STATUS>().toEqualTypeOf<StatusConsulta>();
    expect(ROTULO_STATUS).toEqual({ agendada: 'Agendada', confirmada: 'Confirmada', cancelada: 'Cancelada', realizada: 'Realizada', faltou: 'Faltou' });
    expect(ROTULO_DO_PAINEL).toBe(ROTULO_STATUS);
  });

  it('STATUS_OCUPA: até a T6 (que acrescenta `solicitada` a StatusConsulta), os mesmos de STATUS_ATIVOS', () => {
    expect(STATUS_OCUPA).toEqual([...STATUS_ATIVOS]);
  });

  it.todo("T6: STATUS_OCUPA = [...STATUS_ATIVOS, 'solicitada']");
});
