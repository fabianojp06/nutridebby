import { describe, expect, it } from 'vitest';
import type { Consulta } from '@/modules/agenda/consultas';
import { lerAvisos, lerVisao, periodoDaVisao, selosDaConsulta } from './periodo';

const base: Consulta = {
  id: '1', patientId: 'p', paciente: 'Ana Souza', pacienteNovoPublico: false, inicio: new Date(), fim: new Date(), modalidade: 'presencial', linkOnline: null,
  status: 'agendada', origem: 'nutri', confirmadaVia: null, canceladoPor: null, pedidoRemarcacaoEm: null, remarcadaDe: null, localId: null, local: null,
};

const o = { comPaciente: false, hoje: '2026-10-16' };

describe('período da agenda (reexportado de @/modules/agenda/calendario, Plano 23)', () => {
  it('semana começa na segunda: sexta 16/10/2026 → 12/10 a 18/10; anterior e próxima semana', () => {
    expect(periodoDaVisao('semana', '2026-10-16', o)).toEqual({
      dias: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'],
      de: '2026-10-12',
      ate: '2026-10-18',
      anterior: '2026-10-05',
      proximo: '2026-10-19',
    });
    expect(periodoDaVisao('semana', '2026-10-18', o).dias[0]).toBe('2026-10-12'); // domingo fica na semana que começou na segunda
  });
  it('dia, lista (30 dias) e mês', () => {
    expect(periodoDaVisao('dia', '2026-12-31', o)).toEqual({ dias: ['2026-12-31'], de: '2026-12-31', ate: '2026-12-31', anterior: '2026-12-30', proximo: '2027-01-01' });
    const l = periodoDaVisao('lista', '2026-10-16', o);
    expect([l.dias.length, l.dias.at(-1), l.proximo]).toEqual([30, '2026-11-14', '2026-11-15']);
    expect(periodoDaVisao('mes', '2026-10-16', o).de).toBe('2026-10-01');
  });
  it('visão desconhecida vira semana; avisos só os conhecidos', () => {
    expect([lerVisao('dia'), lerVisao('mes'), lerVisao('x'), lerVisao(undefined)]).toEqual(['dia', 'mes', 'semana', 'semana']);
    expect(lerAvisos('fora_do_horario,xss,dentro_de_bloqueio')).toEqual(['fora_do_horario', 'dentro_de_bloqueio']);
  });
  it('um lerVisao só: o painel reexporta o do módulo', async () => {
    const cal = await import('@/modules/agenda/calendario');
    expect([lerVisao, periodoDaVisao]).toEqual([cal.lerVisao, cal.periodoDaVisao]);
  });
});

describe('selos da consulta (US-030, US-032, US-035)', () => {
  it('situação em texto, não só cor', () => {
    expect(selosDaConsulta(base, false)).toEqual(['Agendada']);
    expect(selosDaConsulta({ ...base, status: 'confirmada', confirmadaVia: 'whatsapp' }, false)).toEqual(['Confirmada via WhatsApp']);
    expect(selosDaConsulta({ ...base, status: 'confirmada', confirmadaVia: 'link' }, false)).toEqual(['Confirmada pelo link']);
    expect(selosDaConsulta({ ...base, status: 'cancelada', canceladoPor: 'paciente' }, true)).toEqual(['Cancelada pelo paciente']);
    // fechamento do Plano 05: cancelada sozinha ao atender o pedido de exclusão (US-018)
    expect(selosDaConsulta({ ...base, status: 'cancelada', canceladoPor: 'sistema' }, false)).toEqual(['Cancelada pelo pedido de exclusão']);
  });
  it('cancelada pela nutricionista, realizada e faltou: só a situação; cancelada não carrega alertas', () => {
    expect(selosDaConsulta({ ...base, status: 'cancelada', canceladoPor: 'nutri', pedidoRemarcacaoEm: new Date(), pacienteNovoPublico: true }, true)).toEqual(['Cancelada']);
    expect(selosDaConsulta({ ...base, status: 'realizada' }, false)).toEqual(['Realizada']);
    expect(selosDaConsulta({ ...base, status: 'faltou' }, false)).toEqual(['Faltou']);
  });
  it('pedido de remarcação, bloqueio e paciente novo da página pública', () => {
    expect(selosDaConsulta({ ...base, pedidoRemarcacaoEm: new Date(), pacienteNovoPublico: true }, true)).toEqual([
      'Agendada', 'Paciente pediu para remarcar', 'Consulta dentro de um bloqueio', 'Novo paciente via agendamento online', 'Completar cadastro',
    ]);
  });
});
