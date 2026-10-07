-- Plano 11 (spec da IA v0.3, §11 e §5.11). CLAUDE.md regras 2 e 8.
-- D9: FK composta para exams com SET NULL só do exam_id (PostgreSQL 15+). Excluir o exame mantém o registro de que o laudo foi
-- enviado à IA; o tenant e o paciente da tarefa nunca mudam.
ALTER TABLE ia_tarefas ADD CONSTRAINT ia_tarefas_exame_fk
  FOREIGN KEY (tenant_id, patient_id, exam_id) REFERENCES exams (tenant_id, patient_id, id) ON DELETE SET NULL (exam_id);
--> statement-breakpoint
SELECT app_enable_tenant_rls('ia_tarefas');
--> statement-breakpoint
SELECT app_enable_patient_rls('ia_tarefas');
--> statement-breakpoint
-- o paciente nunca vê pedidos nem sugestões da IA, nem os próprios (spec §3)
SELECT app_enable_staff_only('ia_tarefas');
--> statement-breakpoint
SELECT app_enable_audit('ia_tarefas', 'ia');
--> statement-breakpoint
SELECT app_enable_tenant_rls('ia_uso');
--> statement-breakpoint
SELECT app_enable_staff_only('ia_uso');
--> statement-breakpoint
-- RNF-110 / NGS1.12.03: o registro técnico de custo nunca é apagado pela aplicação
REVOKE DELETE, TRUNCATE ON ia_uso FROM nutri_app_role;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON ia_gasto_plataforma FROM nutri_app_role;
--> statement-breakpoint
-- RNF-110: DELETE em ia_tarefas só na anonimização (lgpd.ts, contexto worker, DEPOIS do UPDATE de patients que grava
-- anonimizado_em, na mesma transação — como a regra da 0065). O papel worker também roda no processo web (agendamento
-- público, webhook do WhatsApp, link de documento, acesso do portal): por isso o gatilho exige o paciente anonimizado.
-- Descartar, expirar, cancelar e "Não usar IA" só esvaziam o conteúdo. Recusa com 42501, o mesmo código da RLS.
CREATE OR REPLACE FUNCTION app_ia_tarefas_sem_apagar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_current_role() IS DISTINCT FROM 'worker'
     OR NOT EXISTS (SELECT 1 FROM patients p WHERE p.tenant_id = OLD.tenant_id AND p.id = OLD.patient_id AND p.anonimizado_em IS NOT NULL) THEN
    RAISE EXCEPTION 'tarefas de IA só são apagadas na anonimização do paciente' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER ia_tarefas_sem_apagar BEFORE DELETE ON ia_tarefas FOR EACH ROW EXECUTE FUNCTION app_ia_tarefas_sem_apagar();
--> statement-breakpoint
-- Defesa em profundidade (US-103/US-104): a ciência e a recusa de IA só mudam pela nutricionista (em mãos, recusa) ou pelo
-- worker (pós-envio do e-mail). O contexto publico tem INSERT em patients (0051) e não pode criar paciente "informado";
-- a sessão de paciente já é barrada pelo gatilho paciente_colunas (0085). Sem contexto (migrations, seed) passa.
CREATE OR REPLACE FUNCTION app_patients_ia_quem() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
BEGIN
  IF (TG_OP = 'INSERT' AND (NEW.ia_aviso_versao IS NOT NULL OR NEW.ia_aviso_enviado_em IS NOT NULL OR NEW.ia_recusada_em IS NOT NULL))
     OR (TG_OP = 'UPDATE' AND (NEW.ia_aviso_versao, NEW.ia_aviso_em, NEW.ia_aviso_canal, NEW.ia_aviso_enviado_em, NEW.ia_recusada_em)
         IS DISTINCT FROM (OLD.ia_aviso_versao, OLD.ia_aviso_em, OLD.ia_aviso_canal, OLD.ia_aviso_enviado_em, OLD.ia_recusada_em)) THEN
    IF r NOT IN ('', 'nutri', 'worker') THEN
      RAISE EXCEPTION 'a ciência e a recusa de IA só mudam pela nutricionista ou pelo worker' USING ERRCODE = '42501';
    END IF;
    IF r = 'nutri' AND NEW.ia_aviso_canal = 'email' AND (TG_OP = 'INSERT' OR OLD.ia_aviso_canal IS DISTINCT FROM 'email') THEN
      RAISE EXCEPTION 'a ciência por e-mail só é registrada no pós-envio (worker)' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER patients_ia_quem BEFORE INSERT OR UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION app_patients_ia_quem();
--> statement-breakpoint
-- US-100: o admin vê só contagens e somas do mês por tenant (molde de admin_metricas_sucesso, 0087). Mês no fuso do tenant.
CREATE OR REPLACE FUNCTION admin_metricas_ia()
RETURNS TABLE (tenant_id uuid, tarefas_mes bigint, custo_mes_micro_usd bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  t record;
  v_mes text;
BEGIN
  IF coalesce(current_setting('app.tenant_id', true), '') <> '' THEN
    RAISE EXCEPTION 'admin_metricas_ia() não pode rodar dentro de withTenant' USING ERRCODE = '55000';
  END IF;
  FOR t IN SELECT tn.id, tn.fuso FROM public.tenants tn ORDER BY tn.created_at LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    PERFORM set_config('app.role', 'worker', true);
    PERFORM set_config('app.patient_id', '', true);
    v_mes := to_char(now() AT TIME ZONE t.fuso, 'YYYY-MM');
    tenant_id := t.id;
    SELECT count(*),
           coalesce(sum(u.custo_micro_usd) FILTER (WHERE u.situacao IN ('reservado', 'confirmado', 'incerto')), 0)::bigint
      INTO tarefas_mes, custo_mes_micro_usd
      FROM public.ia_uso u
     WHERE u.tenant_id = t.id AND u.mes = v_mes;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.role', '', true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin_metricas_ia() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin_metricas_ia() TO nutri_app_role;
