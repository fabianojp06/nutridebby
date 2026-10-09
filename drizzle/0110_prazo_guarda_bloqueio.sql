-- JUR-01 (decisão do dono, 09/10/2026; Res. CFN 594/2017, art. 3º, VI, "b"): o prazo de guarda do prontuário conta do
-- último registro, e no pedido de exclusão o último registro é o próprio bloqueio (atenderPedidoExclusao, lgpd.ts). Até
-- aqui, anonimizar_apos contava da última consulta (ou do bloqueio, sem consulta). Esta migration recalcula quem já está
-- bloqueado e ainda não foi anonimizado: anonimizar_apos = data do bloqueio no fuso do tenant + 20 anos
-- (PRAZO_GUARDA_ANOS, lgpd.ts; P-01).
--
-- Data do bloqueio: patients.bloqueado_em, gravado na mesma transação do bloqueio (o único caminho que leva a
-- 'bloqueado'). Sem ela (nenhuma linha é esperada), a data do pedido de exclusão atendido (privacy_requests,
-- tipo 'exclusao', status 'concluido', o mais recente), que atenderPedidoExclusao conclui na mesma transação, com o
-- mesmo instante. Sem nenhuma das duas, ou sem anonimizar_apos, a linha não muda.
--
-- Só para mais: GREATEST(atual, novo) e a linha só é tocada quando o novo prazo é maior — nunca antecipa a
-- anonimização de ninguém, e rodar de novo não muda nada.
--
-- Auditoria (regra 8): set_config('app.tenant_id', …) por tenant, com o gatilho audit_row_change LIGADO. O
-- set_config é obrigatório de todo jeito — em produção o migrator não é superusuário e a RLS é FORCE em patients
-- (0017) — e, com ele, cada paciente cujo prazo mudou ganha uma linha "alterar" no audit_log (ator nulo = Sistema,
-- tenant e titular da própria linha): a mudança do prazo de guarda de um prontuário fica rastreável. O contexto
-- 'worker' passa pelos gatilhos de patients (paciente_colunas, patients_ia_quem) como o job de retenção.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT id, fuso FROM tenants ORDER BY created_at LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    PERFORM set_config('app.role', 'worker', true);
    PERFORM set_config('app.patient_id', '', true);
    UPDATE patients p
       SET anonimizar_apos = greatest(p.anonimizar_apos, n.novo)
      FROM (
        SELECT q.id,
               ((coalesce(
                   q.bloqueado_em,
                   (SELECT max(pr.concluido_em)
                      FROM privacy_requests pr
                     WHERE pr.tenant_id = t.id AND pr.patient_id = q.id
                       AND pr.tipo = 'exclusao' AND pr.status = 'concluido')
                 ) AT TIME ZONE t.fuso)::date + interval '20 years')::date AS novo
          FROM patients q
         WHERE q.tenant_id = t.id AND q.status = 'bloqueado' AND q.anonimizado_em IS NULL
      ) n
     WHERE p.id = n.id
       AND p.tenant_id = t.id
       AND p.anonimizar_apos IS NOT NULL
       AND n.novo > p.anonimizar_apos;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.role', '', true);
  PERFORM set_config('app.patient_id', '', true);
END $$;
