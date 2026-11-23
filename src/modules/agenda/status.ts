import { getTableName, sql, type SQL } from 'drizzle-orm';
import type { appointments, consultations } from '@/db/schema';
import { MSG_AGENDA, MSG_SOLICITACOES } from './constantes';
import type { Consulta, StatusConsulta, TenantAgenda } from './consultas';

/**
 * Plano 23 (AG-D57): status da consulta sem banco — importável pelo painel, pela seção "Consultas" da ficha e pela impressão.
 * Só tipos de consultas.ts (o módulo dela fala com o banco).
 */

/**
 * Status que ocupam o horário e contam no teto de 3 futuras: `STATUS_ATIVOS` ("consulta marcada") mais o pedido
 * (`solicitada`). Só nos pontos da tabela fechada da spec §4.3 (guarda em status-guarda.test.ts). Literal, sem importar
 * `STATUS_ATIVOS` (consultas.ts fala com o banco); status.test.ts confere que é `[...STATUS_ATIVOS, 'solicitada']`.
 */
export const STATUS_OCUPA: readonly StatusConsulta[] = ['agendada', 'confirmada', 'solicitada'];

/** AG-D43: no painel, o pedido é "Pedido a responder" (selo, legenda, seção da ficha). */
export const ROTULO_STATUS: Record<StatusConsulta, string> = {
  agendada: 'Agendada',
  confirmada: 'Confirmada',
  cancelada: 'Cancelada',
  realizada: 'Realizada',
  faltou: 'Faltou',
  solicitada: MSG_SOLICITACOES.pedidoAResponder,
};

/**
 * O selo da cancelada por quem cancelou (AG-D44): `sistema` continua só a exclusão LGPD; os três do pedido dizem o que
 * aconteceu com ele. A cancelada pela nutricionista fica "Cancelada".
 */
const SELO_DA_CANCELADA: Partial<Record<NonNullable<Consulta['canceladoPor']>, string>> = {
  paciente: 'Cancelada pelo paciente',
  sistema: 'Cancelada pelo pedido de exclusão',
  pedido_desistido: MSG_SOLICITACOES.selos.retirado,
  pedido_recusado: MSG_SOLICITACOES.selos.naoAceito,
  pedido_vencido: MSG_SOLICITACOES.selos.vencido,
};

/** Plano 23 (RN-415, RN-416, §6.2): rótulos do tipo da consulta e dos selos novos, em texto (a cor só reforça). */
export const ROTULO_TIPO_CONSULTA: Record<'primeira' | 'retorno', string> = { primeira: 'Primeira consulta', retorno: 'Retorno' };
export const SELO_PRESENCA_A_REGISTRAR = 'Presença a registrar';

/** Situação e alertas da consulta, em texto (acessibilidade: nada só por cor). Era de src/app/painel/agenda/periodo.ts. */
export function selosDaConsulta(c: Consulta, dentroDeBloqueio: boolean): string[] {
  const s: string[] = [];
  if (c.status === 'confirmada' && c.confirmadaVia === 'whatsapp') s.push('Confirmada via WhatsApp');
  else if (c.status === 'confirmada' && c.confirmadaVia === 'link') s.push('Confirmada pelo link');
  else if (c.status === 'cancelada' && c.canceladoPor && SELO_DA_CANCELADA[c.canceladoPor]) s.push(SELO_DA_CANCELADA[c.canceladoPor]!);
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

/**
 * Plano 23 (AG-D43, AG-D44, §4.3): a situação da consulta para o paciente (portal e link). O pedido é "Aguardando
 * confirmação da nutricionista"; recusado e vencido, "Não confirmado"; retirado por ele, "Pedido cancelado".
 */
export const SITUACAO_NO_PORTAL: Record<StatusConsulta, string> = {
  agendada: 'Agendada',
  confirmada: 'Confirmada',
  cancelada: 'Cancelada',
  realizada: 'Realizada',
  faltou: 'Faltou',
  solicitada: MSG_SOLICITACOES.portal.aguardando,
};
const SITUACAO_DO_PEDIDO_CANCELADO: Partial<Record<NonNullable<Consulta['canceladoPor']>, string>> = {
  pedido_recusado: MSG_SOLICITACOES.portal.naoConfirmado,
  pedido_vencido: MSG_SOLICITACOES.portal.naoConfirmado,
  pedido_desistido: MSG_SOLICITACOES.portal.pedidoCancelado,
};

/** O pedido (`solicitada`) ou o que ele virou: recusado, vencido ou retirado (AG-D44). */
export const ehPedido = (c: Pick<Consulta, 'status' | 'canceladoPor'>): boolean => c.status === 'solicitada' || !!(c.canceladoPor && SITUACAO_DO_PEDIDO_CANCELADO[c.canceladoPor]);

/** RN-427: o pedido vence em `inicio − antecedencia_min_h` (o mesmo prazo em que o horário deixa de ser oferecido). */
export const prazoDoPedido = (inicio: Date, tenant: Pick<TenantAgenda, 'antecedenciaMinH'>): Date => new Date(inicio.getTime() - tenant.antecedenciaMinH * 3_600_000);

/** Pedido ainda `solicitada` cujo prazo de resposta já passou (a varredura do minuto ainda não o venceu). */
export function pedidoVencido(c: Pick<Consulta, 'status' | 'inicio'>, tenant: Pick<TenantAgenda, 'antecedenciaMinH'>, agora: Date): boolean {
  return c.status === 'solicitada' && prazoDoPedido(c.inicio, tenant).getTime() <= agora.getTime();
}

/** A situação para o paciente; o pedido vencido e ainda não processado já é "Não confirmado" (leitura preguiçosa, RN-427). */
export function situacaoNoPortal(c: Pick<Consulta, 'status' | 'inicio' | 'canceladoPor'>, tenant: Pick<TenantAgenda, 'antecedenciaMinH'>, agora: Date): string {
  if (pedidoVencido(c, tenant, agora)) return MSG_SOLICITACOES.portal.naoConfirmado;
  return (c.canceladoPor && SITUACAO_DO_PEDIDO_CANCELADO[c.canceladoPor]) || SITUACAO_NO_PORTAL[c.status];
}
