import { MSG_IA_NUTRI } from '@/modules/ia/nutri-paciente/constantes';
import type { SeloDaDuvida } from '@/modules/ia/nutri-paciente/duvidas';

/** O selo de cada dúvida da fila e da tela da dúvida (US-175, D22). */
export const ROTULO_DO_SELO: Record<SeloDaDuvida, string> = {
  risco: MSG_IA_NUTRI.seloRisco,
  risco_revogado: MSG_IA_NUTRI.seloRiscoRevogado,
  aviso_minimo: MSG_IA_NUTRI.avisoMinimoRisco,
};

/** US-175: "há {n} horas" — horas inteiras desde o envio (nunca negativo). */
export const horasDesde = (d: Date, agora: Date = new Date()): number => Math.max(0, Math.floor((agora.getTime() - d.getTime()) / 3_600_000));
