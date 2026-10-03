import { MSG_AGENDA } from '@/modules/agenda/constantes';
import type { AvisoAgenda, Consulta, StatusConsulta } from '@/modules/agenda/consultas';
import { segundaDaSemana, somarDias } from '@/modules/agenda/fuso';

export type Visao = 'dia' | 'semana' | 'lista';
export const lerVisao = (v: unknown): Visao => (v === 'dia' || v === 'lista' ? v : 'semana');

/** Dias exibidos (calendário do tenant) e para onde vão "Anterior" e "Próximo". A semana começa na segunda. */
export function periodoDaVisao(visao: Visao, data: string): { dias: string[]; anterior: string; proximo: string } {
  if (visao === 'dia') return { dias: [data], anterior: somarDias(data, -1), proximo: somarDias(data, 1) };
  const inicio = visao === 'semana' ? segundaDaSemana(data) : data;
  const n = visao === 'semana' ? 7 : 30;
  return { dias: Array.from({ length: n }, (_, i) => somarDias(inicio, i)), anterior: somarDias(inicio, -n), proximo: somarDias(inicio, n) };
}

export const ROTULO_STATUS: Record<StatusConsulta, string> = { agendada: 'Agendada', confirmada: 'Confirmada', cancelada: 'Cancelada', realizada: 'Realizada', faltou: 'Faltou' };

export const AVISO_ROTULO: Record<AvisoAgenda, string> = { fora_do_horario: MSG_AGENDA.foraDoHorario, dentro_de_bloqueio: MSG_AGENDA.dentroDeBloqueio };
export const lerAvisos = (v: unknown): AvisoAgenda[] =>
  typeof v === 'string' ? v.split(',').filter((a): a is AvisoAgenda => a === 'fora_do_horario' || a === 'dentro_de_bloqueio') : [];

/** Situação e alertas da consulta, em texto (acessibilidade: nada só por cor). */
export function selosDaConsulta(c: Consulta, dentroDeBloqueio: boolean): string[] {
  const s: string[] = [];
  if (c.status === 'confirmada' && c.confirmadaVia === 'whatsapp') s.push('Confirmada via WhatsApp');
  else if (c.status === 'confirmada' && c.confirmadaVia === 'link') s.push('Confirmada pelo link');
  else if (c.status === 'cancelada' && c.canceladoPor === 'paciente') s.push('Cancelada pelo paciente');
  else if (c.status === 'cancelada' && c.canceladoPor === 'sistema') s.push('Cancelada pelo pedido de exclusão');
  else s.push(ROTULO_STATUS[c.status]);
  if (c.status === 'cancelada') return s;
  if (c.pedidoRemarcacaoEm) s.push('Paciente pediu para remarcar');
  if (dentroDeBloqueio) s.push(MSG_AGENDA.dentroDeBloqueio);
  if (c.pacienteNovoPublico) s.push('Novo paciente via agendamento online', 'Completar cadastro');
  return s;
}
