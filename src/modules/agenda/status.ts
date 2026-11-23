import type { StatusConsulta } from './consultas';

/**
 * Plano 23 (AG-D57): status da consulta sem banco — importável pelo painel, pela seção "Consultas" da ficha e pela impressão.
 * Só tipos de consultas.ts (o módulo dela fala com o banco).
 */

/**
 * Status que ocupam o horário (spec §4.3, lista fechada de pontos). A T6 acrescenta `solicitada` a `StatusConsulta` e a
 * esta lista; até lá, os mesmos de `STATUS_ATIVOS` (teste em status.test.ts).
 */
export const STATUS_OCUPA: readonly StatusConsulta[] = ['agendada', 'confirmada'];

export const ROTULO_STATUS: Record<StatusConsulta, string> = { agendada: 'Agendada', confirmada: 'Confirmada', cancelada: 'Cancelada', realizada: 'Realizada', faltou: 'Faltou' };
