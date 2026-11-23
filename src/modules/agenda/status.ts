import { getTableName, sql, type SQL } from 'drizzle-orm';
import type { appointments, consultations } from '@/db/schema';
import { MSG_AGENDA } from './constantes';
import type { Consulta, StatusConsulta } from './consultas';

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

/** Plano 23 (RN-415, RN-416, §6.2): rótulos do tipo da consulta e dos selos novos, em texto (a cor só reforça). */
export const ROTULO_TIPO_CONSULTA: Record<'primeira' | 'retorno', string> = { primeira: 'Primeira consulta', retorno: 'Retorno' };
export const SELO_PRESENCA_A_REGISTRAR = 'Presença a registrar';

/** Situação e alertas da consulta, em texto (acessibilidade: nada só por cor). Era de src/app/painel/agenda/periodo.ts. */
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

/**
 * RN-416 num lugar só: a consulta `a` é "Retorno" se o paciente tem consulta `realizada` que começou antes dela **ou**
 * atendimento (`c`) com data anterior ao dia dela, no fuso do consultório; senão, "Primeira consulta". Só o fragmento SQL
 * (sem I/O), para quem lê por consulta (`tiposDasConsultas`, a seção "Consultas" da T9). A agenda lê o mesmo critério numa
 * consulta agregada por período (`min(inicio)`/`min(data)` por paciente, `visoes.ts`). As colunas de fora vão com o nome
 * da tabela: sem ele, o Drizzle as escreve soltas e, dentro do subselect, apontariam para a tabela de dentro.
 */
export function sqlEhRetorno(a: typeof appointments, c: typeof consultations): SQL {
  const fora = (coluna: string) => sql`${sql.identifier(getTableName(a))}.${sql.identifier(coluna)}`;
  const at = sql.identifier(getTableName(c));
  return sql`(exists (select 1 from appointments ant
      where ant.tenant_id = ${fora('tenant_id')} and ant.patient_id = ${fora('patient_id')} and ant.status = 'realizada' and ant.inicio < ${fora('inicio')})
    or exists (select 1 from ${at} atd
      where atd.tenant_id = ${fora('tenant_id')} and atd.patient_id = ${fora('patient_id')}
        and atd.data < (${fora('inicio')} at time zone (select t.fuso from tenants t where t.id = ${fora('tenant_id')}))::date))`;
}
