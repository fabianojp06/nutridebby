import type { Pool, PoolClient } from 'pg';

/** Tabelas com patient_id que não levam o gatilho de auditoria, com a justificativa. */
export const AUDIT_EXCEPTIONS: Record<string, string> = {
  audit_log: 'é o próprio registro de auditoria (append-only)',
  invites: 'convite de acesso (hash do token, validade), não é dado de saúde',
  consents: 'prova de aceite do termo (versão, data, IP), append-only; não é dado de saúde',
  notifications: 'D10: registro técnico de entrega (canal, tipo, situação); nenhum dado clínico — o horário da consulta fica em appointments, que é auditada',
  push_subscriptions: 'INT-03: endereço do dispositivo para push; não é dado de saúde',
  access_events: 'CS-02: só o dia em que o paciente abriu o portal; não é dado de saúde',
  stored_files:
    'metadados do arquivo (caminho, tamanho, tipo, dono); o registro que aponta para ele — exame, plano, diário, exportação — é o auditado',
  content_views: 'D6 (Plano 07): registro de uso (o paciente abriu o conteúdo da nutricionista), como access_events; não é prontuário',
  content_favorites: 'D6 (Plano 07): preferência do paciente na biblioteca de conteúdo; não é prontuário',
  document_access_codes: 'RN-158: código do link de uso único (só HMAC, validade, tentativas); não é dado de saúde — a abertura vira evento auditado em signed_document_receipts',
  ia_autorizacoes:
    'Plano 14A (RN-107, §11): consentimento do titular para a transferência à IA (LGPD art. 33, VIII), não é dado de saúde; prova só de inclusão (UPDATE e DELETE revogados) com quem registrou, quando, canal, IP e user-agent na própria linha, como consents; a abertura do termo em papel chama auditRead (entidade ia_autorizacao)',
  ia_nutri_consentimentos: 'Plano 15 (RN-171, D26): prova só de inclusão do consentimento da IA Nutri (evento, versão, destino, data, conta, IP e user-agent na própria linha), como ia_autorizacoes e consents; não é dado de saúde',
  lembretes_rotina_envios: 'registro técnico de envio (último horário enviado); nenhum dado clínico — a configuração fica em lembretes_rotina, que é auditada',
};

/** Tabelas de dado de saúde (com patient_id, ou a própria `patients`) sem o gatilho audit_row_change. */
export async function findAuditViolations(db: Pool | PoolClient): Promise<{ table: string; problem: string }[]> {
  const { rows } = await db.query<{ table: string }>(`
    select c.relname as table
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind in ('r', 'p')
       and (c.relname = 'patients'
            or exists (select 1 from information_schema.columns k
                        where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'patient_id'))
       and not exists (select 1 from pg_trigger t
                        where t.tgrelid = c.oid and t.tgname = 'audit_row_change' and not t.tgisinternal)
     order by 1`);
  return rows
    .filter((r) => !AUDIT_EXCEPTIONS[r.table])
    .map((r) => ({ table: r.table, problem: 'sem gatilho de auditoria (app_enable_audit)' }));
}
