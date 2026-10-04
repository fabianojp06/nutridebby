-- P08-05 / B-4: o banco confere O QUE a sessão de paciente grava, não só ONDE (PACIENTE_ESCREVE). Em patients: o aceite do
-- convite (user_id de nulo para a própria conta) e o WhatsApp (opt-in com origem 'paciente', opt-out). O gatilho de
-- auditoria continua (AFTER); este roda antes e recusa com 42501, o mesmo código da RLS.
CREATE OR REPLACE FUNCTION app_paciente_colunas_patients() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  livres text[] := ARRAY['user_id', 'whatsapp_optin_em', 'whatsapp_optin_origem', 'whatsapp_optout_em', 'updated_at'];
BEGIN
  IF app_current_role() IS DISTINCT FROM 'paciente' THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - livres) IS DISTINCT FROM (to_jsonb(OLD) - livres) THEN
    RAISE EXCEPTION 'a sessão de paciente só altera o aceite do convite e o WhatsApp' USING ERRCODE = '42501';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id AND (OLD.user_id IS NOT NULL OR NEW.user_id IS DISTINCT FROM app_current_user()) THEN
    RAISE EXCEPTION 'a sessão de paciente só liga o prontuário à própria conta' USING ERRCODE = '42501';
  END IF;
  IF NEW.whatsapp_optin_origem IS DISTINCT FROM OLD.whatsapp_optin_origem AND NEW.whatsapp_optin_origem IS DISTINCT FROM 'paciente' THEN
    RAISE EXCEPTION 'opt-in do paciente tem origem paciente' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER paciente_colunas BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION app_paciente_colunas_patients();
--> statement-breakpoint
-- B-4: em data_exports o titular só marca o pedido esquecido como falhou (solicitarExportacao, US-046)
CREATE OR REPLACE FUNCTION app_paciente_colunas_exports() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_current_role() IS DISTINCT FROM 'paciente' THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'updated_at'])
     OR NOT (OLD.status = 'pendente' AND NEW.status = 'falhou') THEN
    RAISE EXCEPTION 'a sessão de paciente só marca o pedido pendente como falhou' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER paciente_colunas BEFORE UPDATE ON data_exports FOR EACH ROW EXECUTE FUNCTION app_paciente_colunas_exports();
--> statement-breakpoint
-- B-6: o portal nunca mostra o audit_log ao paciente (D5 do Plano 06); com SQL arbitrário ele leria as próprias linhas,
-- com IP e ator da equipe. auditRead e o gatilho só fazem INSERT sem RETURNING: não precisam de SELECT.
CREATE POLICY paciente_sem_leitura ON audit_log AS RESTRICTIVE FOR SELECT USING (app_current_role() IS DISTINCT FROM 'paciente');
--> statement-breakpoint
-- N38 (revisão do Plano 07): a capa só é visível ao paciente se o conteúdo dela for visível a ele. A subconsulta em
-- contents passa pela RLS de contents (paciente_conteudo_visivel, 0083) — inclusive a liberação das receitas do plano
-- (app.receitas_do_plano) na mesma transação. Logo do consultório: sempre.
DROP POLICY paciente_arquivos ON stored_files;
--> statement-breakpoint
CREATE POLICY paciente_arquivos ON stored_files AS RESTRICTIVE FOR ALL
  USING (
    app_current_role() IS DISTINCT FROM 'paciente'
    OR patient_id = app_current_patient()
    OR tipo = 'logo'
    OR (tipo = 'capa' AND EXISTS (SELECT 1 FROM contents c WHERE c.tenant_id = stored_files.tenant_id AND c.capa_path = stored_files.caminho))
  )
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR patient_id = app_current_patient());
