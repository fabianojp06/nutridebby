-- Plano 18 (spec D1, §9.1): cadastro complementar do paciente. CLAUDE.md regras 2 e 8. Sem staff_only (é dado do titular,
-- D3), sem app_allow_publico e sem app_allow_paciente_escrita: o paciente com login só lê a própria linha.
SELECT app_enable_tenant_rls('patient_cadastro');
--> statement-breakpoint
SELECT app_enable_patient_rls('patient_cadastro');
--> statement-breakpoint
-- Escritas auditadas como o cadastro do paciente (entidade `patients`, "Cadastro do paciente"); entidade_id = id desta linha
SELECT app_enable_audit('patient_cadastro', 'patients');
--> statement-breakpoint
REVOKE TRUNCATE ON patient_cadastro FROM nutri_app_role;
--> statement-breakpoint
-- D1: o contexto de paciente sem sessão de login (convite, links, webhook, contexto da IA Nutri, "No app do paciente") não
-- lê nem a própria linha — CPF, endereço e observação ficam só para a equipe e para o titular logado.
CREATE POLICY patient_cadastro_paciente_com_conta ON patient_cadastro AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL)
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL);
--> statement-breakpoint
-- id (o entidade_id da trilha), tenant e paciente não mudam, para ninguém: para outro paciente do MESMO tenant a RLS da
-- equipe deixaria passar. IS DISTINCT FROM: o UPDATE sem mudança (`set tenant_id = tenant_id` do teste de isolamento) passa.
CREATE OR REPLACE FUNCTION app_patient_cadastro_colunas_fixas() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id THEN
    RAISE EXCEPTION 'coluna fixa do cadastro do paciente' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER patient_cadastro_colunas_fixas BEFORE UPDATE ON patient_cadastro FOR EACH ROW EXECUTE FUNCTION app_patient_cadastro_colunas_fixas();
--> statement-breakpoint
-- O cadastro complementar só sai na anonimização (lgpd.ts, contexto worker), depois de marcar anonimizado_em: nem a equipe
-- nem o pedido de exclusão (bloqueado) o apagam. O papel worker também roda no processo web (agendamento público, webhook,
-- link de documento): por isso o gatilho exige o titular anonimizado. Molde: exam_submissions_sem_apagar (0102).
CREATE OR REPLACE FUNCTION app_patient_cadastro_sem_apagar() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
BEGIN
  IF app_current_role() IS DISTINCT FROM 'worker'
     OR NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.tenant_id = OLD.tenant_id AND p.id = OLD.patient_id
                       AND p.anonimizado_em IS NOT NULL) THEN
    RAISE EXCEPTION 'o cadastro do paciente só é apagado na anonimização' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER patient_cadastro_sem_apagar BEFORE DELETE ON patient_cadastro FOR EACH ROW EXECUTE FUNCTION app_patient_cadastro_sem_apagar();
--> statement-breakpoint
-- Titular anonimizado não ganha cadastro de volta, para ninguém (nem o worker): a anonimização apaga a linha depois de
-- marcar anonimizado_em, e um INSERT ou UPDATE posterior (imagem antiga no deploy, corrida com a tela aberta) traria CPF e
-- endereço de volta para um titular que já saiu. O apagamento (BEFORE DELETE) não passa por aqui.
CREATE OR REPLACE FUNCTION app_patient_cadastro_titular_ativo() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.patients p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.patient_id
               AND p.anonimizado_em IS NOT NULL) THEN
    RAISE EXCEPTION 'titular anonimizado não tem cadastro' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER patient_cadastro_titular_ativo BEFORE INSERT OR UPDATE ON patient_cadastro FOR EACH ROW EXECUTE FUNCTION app_patient_cadastro_titular_ativo();
