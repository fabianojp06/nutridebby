-- Plano 12 (spec C v0.3, §13.1, §6.5). CLAUDE.md regras 2, 8 e 9.
-- FK composta para exams com SET NULL só do exam_id (PostgreSQL 15+), como ia_tarefas (0099): excluir o exame aceito mantém o
-- registro de que ele veio do paciente; o tenant e o paciente do envio nunca mudam.
ALTER TABLE exam_submissions ADD CONSTRAINT exam_submissions_exame_fk
  FOREIGN KEY (tenant_id, patient_id, exam_id) REFERENCES exams (tenant_id, patient_id, id) ON DELETE SET NULL (exam_id);
--> statement-breakpoint
SELECT app_enable_tenant_rls('exam_submissions');
--> statement-breakpoint
SELECT app_enable_patient_rls('exam_submissions');
--> statement-breakpoint
SELECT app_enable_audit('exam_submissions', 'exames_enviados');
--> statement-breakpoint
SELECT app_allow_paciente_escrita('exam_submissions', 'insert', 'update');
--> statement-breakpoint
SELECT app_enable_tenant_rls('exam_submission_files');
--> statement-breakpoint
SELECT app_enable_patient_rls('exam_submission_files');
--> statement-breakpoint
SELECT app_enable_audit('exam_submission_files', 'exames_enviados');
--> statement-breakpoint
SELECT app_allow_paciente_escrita('exam_submission_files', 'insert');
--> statement-breakpoint
-- RN-160/RN-166 (NGS1.03.04): a sessão de paciente só CRIA envio "processando", dela (conta da sessão) e sem nada da revisão
-- nem do processamento; e só ALTERA envio "recebido" para "cancelado" (o gatilho abaixo confere que nenhuma outra coluna muda).
-- RESTRICTIVE e só para o papel `paciente`: soma-se às políticas de tenant e de paciente; a equipe e o worker não mudam.
CREATE POLICY paciente_envio_insert ON exam_submissions AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    app_current_role() IS DISTINCT FROM 'paciente'
    OR (status = 'processando' AND enviado_por = app_current_user() AND arquivo_path IS NULL AND exam_id IS NULL
        AND revisado_por IS NULL AND revisado_em IS NULL AND motivo_recusa IS NULL AND motivo_recusa_texto IS NULL AND motivo_falha IS NULL)
  );
--> statement-breakpoint
CREATE POLICY paciente_envio_update ON exam_submissions AS RESTRICTIVE FOR UPDATE
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR status = 'recebido')
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR status = 'cancelado');
--> statement-breakpoint
-- US-160: o paciente registra só os ORIGINAIS do próprio envio "processando", apontando para um exame_original dele (sem isto a
-- sessão de paciente poderia apontar o arquivo de OUTRO paciente do tenant — a FK não passa pela RLS — e o worker o
-- processaria para este envio). As imagens de página (D23) são do worker: o paciente nem as lê.
CREATE POLICY paciente_envio_arquivo ON exam_submission_files AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR papel = 'original')
  WITH CHECK (
    app_current_role() IS DISTINCT FROM 'paciente'
    OR (papel = 'original'
        AND EXISTS (SELECT 1 FROM exam_submissions s
                     WHERE s.tenant_id = exam_submission_files.tenant_id AND s.id = exam_submission_files.submission_id
                       AND s.patient_id = exam_submission_files.patient_id AND s.status = 'processando')
        AND EXISTS (SELECT 1 FROM stored_files sf
                     WHERE sf.tenant_id = exam_submission_files.tenant_id AND sf.caminho = exam_submission_files.arquivo_path
                       AND sf.patient_id = exam_submission_files.patient_id AND sf.tipo = 'exame_original'))
  );
--> statement-breakpoint
-- D4 (0080): a sessão de paciente grava só a foto original do diário e, agora, o original do exame enviado.
DROP POLICY paciente_arquivo_insert ON stored_files;
--> statement-breakpoint
CREATE POLICY paciente_arquivo_insert ON stored_files AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR tipo IN ('diario_foto_original', 'exame_original'));
--> statement-breakpoint
-- 0090 + Plano 12: o paciente também não vê as imagens de página do envio (temporárias, só para a revisão). O exame_original
-- continua visível ao dono: a paciente_envio_arquivo confere, sob a RLS da própria sessão, que o original é dele (Desvio 1).
DROP POLICY paciente_arquivos ON stored_files;
--> statement-breakpoint
CREATE POLICY paciente_arquivos ON stored_files AS RESTRICTIVE FOR ALL
  USING (
    app_current_role() IS DISTINCT FROM 'paciente'
    OR (patient_id = app_current_patient() AND tipo NOT IN ('documento_base', 'documento_digitalizado', 'exame_pagina'))
    OR tipo = 'logo'
    OR (tipo = 'capa' AND EXISTS (SELECT 1 FROM contents c WHERE c.tenant_id = stored_files.tenant_id AND c.capa_path = stored_files.caminho))
  )
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR patient_id = app_current_patient());
--> statement-breakpoint
-- PM-14 / §6.5 (NGS1.03.01, NGS1.03.04): cada papel só faz a sua transição, conferida no banco — nem o código da equipe pula
-- etapas. Colunas fixas; transições permitidas; quem faz cada uma; o PDF limpo só entra no fim do processamento e o exame só
-- no aceite (os dois podem ir a nulo a qualquer hora: limpeza e o SET NULL da FK); a revisão só é gravada no aceite ou na
-- recusa; a falha, só na falha; a sessão de paciente só muda a situação (e updated_at). Sem contexto (migrations, seed) as
-- transições continuam conferidas. Recusa com 42501, como a RLS.
-- search_path fixo (revisão do plano, molde de app_audit_row_change, 0007): uma tabela temporária `patients` não desvia as
-- conferências.
CREATE OR REPLACE FUNCTION app_exam_submissions_regras() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.enviado_por, NEW.data_coleta, NEW.nome, NEW.observacao, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.enviado_por, OLD.data_coleta, OLD.nome, OLD.observacao, OLD.created_at) THEN
    RAISE EXCEPTION 'coluna fixa do envio de exame' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF (OLD.status, NEW.status) NOT IN (('processando', 'recebido'), ('processando', 'falhou'), ('recebido', 'aceito'),
                                         ('recebido', 'recusado'), ('recebido', 'cancelado'), ('recebido', 'expirado')) THEN
      RAISE EXCEPTION 'transição de envio de exame inválida' USING ERRCODE = '42501';
    END IF;
    IF r <> '' AND NOT ((NEW.status IN ('recebido', 'falhou', 'expirado') AND r = 'worker')
                        OR (NEW.status IN ('aceito', 'recusado') AND r = 'nutri')
                        OR (NEW.status = 'cancelado' AND r = 'paciente')) THEN
      RAISE EXCEPTION 'este papel não faz esta transição do envio de exame' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Revisão do plano (§6.5 item 1, ECF.17.01): a revisão sai em nome de quem está agindo — "quem aceitou" não fica a critério
  -- do código
  IF r <> '' AND NEW.status IN ('aceito', 'recusado') AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.revisado_por IS DISTINCT FROM app_current_user() THEN
    RAISE EXCEPTION 'a revisão do envio de exame é gravada em nome de quem revisa' USING ERRCODE = '42501';
  END IF;
  IF NEW.arquivo_path IS NOT NULL AND NEW.arquivo_path IS DISTINCT FROM OLD.arquivo_path
     AND NOT (OLD.status = 'processando' AND NEW.status = 'recebido') THEN
    RAISE EXCEPTION 'o PDF limpo só entra no fim do processamento' USING ERRCODE = '42501';
  END IF;
  IF NEW.exam_id IS NOT NULL AND NEW.exam_id IS DISTINCT FROM OLD.exam_id AND NOT (OLD.status = 'recebido' AND NEW.status = 'aceito') THEN
    RAISE EXCEPTION 'o envio só ganha exame no aceite' USING ERRCODE = '42501';
  END IF;
  IF (NEW.revisado_por, NEW.revisado_em, NEW.motivo_recusa, NEW.motivo_recusa_texto)
     IS DISTINCT FROM (OLD.revisado_por, OLD.revisado_em, OLD.motivo_recusa, OLD.motivo_recusa_texto)
     AND NOT (OLD.status = 'recebido' AND NEW.status IN ('aceito', 'recusado')) THEN
    RAISE EXCEPTION 'a revisão só é gravada no aceite ou na recusa' USING ERRCODE = '42501';
  END IF;
  IF NEW.motivo_falha IS DISTINCT FROM OLD.motivo_falha AND NOT (OLD.status = 'processando' AND NEW.status = 'falhou') THEN
    RAISE EXCEPTION 'o motivo da falha só é gravado na falha' USING ERRCODE = '42501';
  END IF;
  IF r = 'paciente' AND (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at') THEN
    RAISE EXCEPTION 'o paciente só cancela o envio' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER exam_submissions_regras BEFORE UPDATE ON exam_submissions FOR EACH ROW EXECUTE FUNCTION app_exam_submissions_regras();
--> statement-breakpoint
-- Revisão do plano (07/10; §6.5 itens 1 e 3): o envio NASCE "processando", sem PDF limpo, exame, revisão nem falha, para
-- QUALQUER papel — sem isto a equipe ou o worker criariam um envio já "aceito" e fabricariam a origem "Enviado pelo paciente"
-- (ECF.17.01) sem passar pelo processamento. Sem contexto (migrations, o owner dos testes) fica livre, como as transições.
CREATE OR REPLACE FUNCTION app_exam_submissions_nasce() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF coalesce(app_current_role(), '') <> ''
     AND (NEW.status IS DISTINCT FROM 'processando' OR NEW.arquivo_path IS NOT NULL OR NEW.exam_id IS NOT NULL
          OR NEW.revisado_por IS NOT NULL OR NEW.revisado_em IS NOT NULL OR NEW.motivo_recusa IS NOT NULL
          OR NEW.motivo_recusa_texto IS NOT NULL OR NEW.motivo_falha IS NOT NULL) THEN
    RAISE EXCEPTION 'o envio de exame nasce em processamento' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER exam_submissions_nasce BEFORE INSERT ON exam_submissions FOR EACH ROW EXECUTE FUNCTION app_exam_submissions_nasce();
--> statement-breakpoint
-- §6.5 item 2 (NGS1.12.03): o registro do envio não é apagado na revisão (só os arquivos saem). A linha só sai no pedido de
-- exclusão atendido e na anonimização (lgpd.ts, contexto worker). O papel worker também roda no processo web (agendamento
-- público, webhook do WhatsApp, link de documento): por isso o gatilho exige o titular bloqueado ou anonimizado.
CREATE OR REPLACE FUNCTION app_exam_submissions_sem_apagar() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF app_current_role() IS DISTINCT FROM 'worker'
     OR NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.tenant_id = OLD.tenant_id AND p.id = OLD.patient_id
                       AND (p.status = 'bloqueado' OR p.anonimizado_em IS NOT NULL)) THEN
    RAISE EXCEPTION 'envios de exame só são apagados no pedido de exclusão atendido ou na anonimização' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER exam_submissions_sem_apagar BEFORE DELETE ON exam_submissions FOR EACH ROW EXECUTE FUNCTION app_exam_submissions_sem_apagar();
--> statement-breakpoint
-- §3: o admin vê só contagens por tenant — envios no mês (fuso do tenant) e aguardando (processando + recebido). Molde de
-- admin_metricas_ia (0099); função própria para não mudar o tipo de retorno de admin_tenant_metrics (Desvio 2).
CREATE OR REPLACE FUNCTION admin_metricas_exames_enviados()
RETURNS TABLE (tenant_id uuid, enviados_mes bigint, pendentes bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  t record;
  v_inicio timestamptz;
BEGIN
  IF coalesce(current_setting('app.tenant_id', true), '') <> '' THEN
    RAISE EXCEPTION 'admin_metricas_exames_enviados() não pode rodar dentro de withTenant' USING ERRCODE = '55000';
  END IF;
  FOR t IN SELECT tn.id, tn.fuso FROM public.tenants tn ORDER BY tn.created_at LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    PERFORM set_config('app.role', 'worker', true);
    PERFORM set_config('app.patient_id', '', true);
    v_inicio := date_trunc('month', now() AT TIME ZONE t.fuso) AT TIME ZONE t.fuso;
    tenant_id := t.id;
    SELECT count(*) FILTER (WHERE s.created_at >= v_inicio), count(*) FILTER (WHERE s.status IN ('processando', 'recebido'))
      INTO enviados_mes, pendentes
      FROM public.exam_submissions s
     WHERE s.tenant_id = t.id;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.role', '', true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin_metricas_exames_enviados() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin_metricas_exames_enviados() TO nutri_app_role;
