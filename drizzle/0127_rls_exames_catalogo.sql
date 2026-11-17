-- Plano 22 (editado à mão). Spec §9.7, RN-370, RN-378, RN-383, RN-385. CLAUDE.md regras 2 e 8.
-- RN-370: bibliotecas do consultório — só a equipe; nada em PUBLICO_LIBERADO nem em PACIENTE_ESCREVE.
SELECT app_enable_tenant_rls('exames_catalogo');
--> statement-breakpoint
SELECT app_enable_staff_only('exames_catalogo');
--> statement-breakpoint
SELECT app_enable_tenant_rls('exames_modelos_solicitacao');
--> statement-breakpoint
SELECT app_enable_staff_only('exames_modelos_solicitacao');
--> statement-breakpoint
-- RN-383: nota de interpretação — só a equipe, auditada (entidade `exames_nota`, EP-D61 do plano), só de inclusão (EP-D41)
SELECT app_enable_tenant_rls('exam_interpretacoes');
--> statement-breakpoint
SELECT app_enable_patient_rls('exam_interpretacoes');
--> statement-breakpoint
SELECT app_enable_staff_only('exam_interpretacoes');
--> statement-breakpoint
SELECT app_enable_audit('exam_interpretacoes', 'exames_nota');
--> statement-breakpoint
-- Só de inclusão. As linhas saem só com o exame, pela cascata da FK composta: a ação referencial roda como dono da tabela
-- (sem a RLS forçada e sem a permissão revogada de nutri_app_role). Escolha da T1 pelo src/db/migrate-owner.test.ts (migrator
-- sem superusuário, FORCE RLS, como em produção): a cascata passa com o REVOKE DELETE — o plano B da §9.5 (gatilho que só
-- aceita pg_trigger_depth() > 1) não foi preciso.
REVOKE UPDATE, DELETE, TRUNCATE ON exam_interpretacoes FROM nutri_app_role;
--> statement-breakpoint
-- RN-378: versões anteriores do exame — só a equipe, auditada (entidade `exames_versoes`), só de inclusão (EP-D41)
SELECT app_enable_tenant_rls('exam_versoes');
--> statement-breakpoint
SELECT app_enable_patient_rls('exam_versoes');
--> statement-breakpoint
SELECT app_enable_staff_only('exam_versoes');
--> statement-breakpoint
SELECT app_enable_audit('exam_versoes', 'exames_versoes');
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON exam_versoes FROM nutri_app_role;
--> statement-breakpoint
-- RN-378, RN-383 (molde de app_fin_lancamentos_regras, 0123). O BEFORE roda antes do WITH CHECK da RLS, então a ordem importa:
--   (1) contexto vazio ou `worker` → 42501 ANTES do RETURN NEW dos outros papéis (o worker roda também no processo web;
--       staff_only só barra o paciente), mesmo enviando o autor;
--   (2) qualquer papel diferente de `nutri` (paciente, publico, conta) → RETURN NEW SEM ler patients: a RLS da própria tabela
--       recusa (staff_only, paciente_sem_insert, publico_negado, tenant_isolation) — lendo o paciente antes, nesses contextos
--       ele viria vazio pela RLS e a recusa mudaria de mensagem (test/isolamento.test.ts, violaRlsDe);
--   (3) só na sessão `nutri`: usuário obrigatório; titular bloqueado ou anonimizado recusado também no banco (defesa além de
--       carregarPacienteParaEscrita), lendo `status, anonimizado_em` com FOR KEY SHARE (espera o FOR UPDATE de um bloqueio em
--       andamento e lê a versão nova); autor e hora pela sessão e pelo relógio do banco (o valor enviado é ignorado).
CREATE OR REPLACE FUNCTION app_exam_interpretacoes_regras() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
  v_status text;
  v_anonimizado timestamptz;
BEGIN
  IF r IN ('', 'worker') THEN
    RAISE EXCEPTION 'nota/versão do exame só pela sessão da nutricionista' USING ERRCODE = '42501';
  END IF;
  IF r <> 'nutri' THEN
    RETURN NEW;
  END IF;
  IF app_current_user() IS NULL THEN
    RAISE EXCEPTION 'nota/versão do exame sem usuário da sessão' USING ERRCODE = '42501';
  END IF;
  SELECT p.status, p.anonimizado_em INTO v_status, v_anonimizado
    FROM public.patients p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.patient_id
    FOR KEY SHARE;
  IF v_status = 'bloqueado' OR v_anonimizado IS NOT NULL THEN
    RAISE EXCEPTION 'paciente bloqueado ou anonimizado: nenhuma nota/versão nova' USING ERRCODE = '42501';
  END IF;
  NEW.criado_por := app_current_user();
  NEW.criado_em := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER exam_interpretacoes_regras BEFORE INSERT ON exam_interpretacoes FOR EACH ROW EXECUTE FUNCTION app_exam_interpretacoes_regras();
--> statement-breakpoint
-- RN-378: a mesma ordem do app_exam_interpretacoes_regras, com alterado_por/alterado_em
CREATE OR REPLACE FUNCTION app_exam_versoes_regras() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
  v_status text;
  v_anonimizado timestamptz;
BEGIN
  IF r IN ('', 'worker') THEN
    RAISE EXCEPTION 'nota/versão do exame só pela sessão da nutricionista' USING ERRCODE = '42501';
  END IF;
  IF r <> 'nutri' THEN
    RETURN NEW;
  END IF;
  IF app_current_user() IS NULL THEN
    RAISE EXCEPTION 'nota/versão do exame sem usuário da sessão' USING ERRCODE = '42501';
  END IF;
  SELECT p.status, p.anonimizado_em INTO v_status, v_anonimizado
    FROM public.patients p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.patient_id
    FOR KEY SHARE;
  IF v_status = 'bloqueado' OR v_anonimizado IS NOT NULL THEN
    RAISE EXCEPTION 'paciente bloqueado ou anonimizado: nenhuma nota/versão nova' USING ERRCODE = '42501';
  END IF;
  NEW.alterado_por := app_current_user();
  NEW.alterado_em := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER exam_versoes_regras BEFORE INSERT ON exam_versoes FOR EACH ROW EXECUTE FUNCTION app_exam_versoes_regras();
--> statement-breakpoint
-- RN-385 (EP-D22): o paciente só lê o exame liberado ("Mostrar no app"). A RLS decide quais exames; a projeção do portal
-- decide quais campos. As outras sessões (nutri, worker, publico, conta) seguem só com as políticas de antes.
CREATE POLICY paciente_exame_liberado ON exams AS RESTRICTIVE FOR SELECT
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR mostrar_no_app_em IS NOT NULL);
