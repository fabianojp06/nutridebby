import { MSG_AGENDA } from '@/modules/agenda/constantes';
import type { AvisoAgenda } from '@/modules/agenda/consultas';
import { ROTULO_STATUS, selosDaConsulta } from '@/modules/agenda/status';

/** AG-D57: o rótulo mora em src/modules/agenda/status.ts; o painel reexporta o mesmo mapa (e os selos, Plano 23). */
export { ROTULO_STATUS, selosDaConsulta };

/** Plano 23 (T5): a visão e o período moram em src/modules/agenda/calendario.ts; o painel reexporta (um `lerVisao` só). */
export { lerVisao, periodoDaVisao, type Visao } from '@/modules/agenda/calendario';

export const AVISO_ROTULO: Record<AvisoAgenda, string> = { fora_do_horario: MSG_AGENDA.foraDoHorario, dentro_de_bloqueio: MSG_AGENDA.dentroDeBloqueio };
export const lerAvisos = (v: unknown): AvisoAgenda[] =>
  typeof v === 'string' ? v.split(',').filter((a): a is AvisoAgenda => a === 'fora_do_horario' || a === 'dentro_de_bloqueio') : [];
