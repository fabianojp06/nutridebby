-- Plano 27 (spec §9.1 a §9.4): questionário pré-consulta, recordatório 24 h e metas. CLAUDE.md regras 2 e 8.
-- (1) questionario_envios: dado do titular (sem staff_only, sem app_allow_publico). RN-529: o paciente (com e sem login) só
-- responde, por UPDATE; o gatilho questionario_envios_regras confere as colunas e as transições de cada papel.
-- FK composta para a anamnese da cópia (RN-531): aqui, e não na gerada, porque o drizzle-kit cria o UNIQUE novo
-- anamneses_tenant_paciente_id_unique (tabela existente) depois das FKs da gerada (42830). MATCH SIMPLE: nulo não é conferido
ALTER TABLE questionario_envios ADD CONSTRAINT questionario_envios_anamnese_fk FOREIGN KEY (tenant_id, patient_id, anamnese_id)
  REFERENCES anamneses (tenant_id, patient_id, id) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
SELECT app_enable_tenant_rls('questionario_envios');
--> statement-breakpoint
SELECT app_enable_patient_rls('questionario_envios');
--> statement-breakpoint
-- QP-D36: entidade `questionario` ("Questionário pré-consulta"); a resposta também grava `questionario_resposta` pelo módulo
SELECT app_enable_audit('questionario_envios', 'questionario');
--> statement-breakpoint
SELECT app_allow_paciente_escrita('questionario_envios', 'update');
--> statement-breakpoint
-- o envio é prontuário: cancela-se ou expira, nunca se apaga
REVOKE DELETE, TRUNCATE ON questionario_envios FROM nutri_app_role;
--> statement-breakpoint
-- (2) anamnesis_templates (QP-D25): modelos de anamnese e de questionário e a configuração do envio automático — só a
-- equipe; o paciente recebe as perguntas pela cópia em questionario_envios.modelo_snapshot
SELECT app_enable_staff_only('anamnesis_templates');
--> statement-breakpoint
-- (3) recordatorios e recordatorio_itens: dado do titular (o portal não lê na v1, QP-D16); sem escrita do paciente (nega por
-- app_enable_tenant_rls) e sem publico
SELECT app_enable_tenant_rls('recordatorios');
--> statement-breakpoint
SELECT app_enable_patient_rls('recordatorios');
--> statement-breakpoint
SELECT app_enable_audit('recordatorios', 'recordatorio');
--> statement-breakpoint
SELECT app_enable_tenant_rls('recordatorio_itens');
--> statement-breakpoint
SELECT app_enable_patient_rls('recordatorio_itens');
--> statement-breakpoint
-- fora do Histórico (QP-D36): o Histórico mostra um "Criou"/"Alterou" da mãe por salvamento, nunca um "Excluiu" por item
SELECT app_enable_audit('recordatorio_itens', 'recordatorio_item');
--> statement-breakpoint
-- QP-D17: o recordatório não é apagado (os itens sim, na edição; e em cascata de um DELETE que o código não faz)
REVOKE DELETE, TRUNCATE ON recordatorios FROM nutri_app_role;
--> statement-breakpoint
-- P27-01d: o paciente sem login (link, contexto da IA Nutri, "No app do paciente") não lê recordatório nem item, nem os
-- próprios; o titular com login continua lendo (molde patient_cadastro_paciente_com_conta, 0125). Sem escrita do paciente,
-- basta FOR SELECT. Nenhum arquivo de SEM_CONTA_PERMITIDOS lê estas tabelas.
CREATE POLICY paciente_recordatorio_com_conta ON recordatorios AS RESTRICTIVE FOR SELECT
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY paciente_recordatorio_com_conta ON recordatorio_itens AS RESTRICTIVE FOR SELECT
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL);
--> statement-breakpoint
-- (4) metas_modelos: biblioteca de metas do consultório — só a equipe; o paciente recebe a cópia em metas_paciente. Sem
-- paciente: sem auditoria
SELECT app_enable_tenant_rls('metas_modelos');
--> statement-breakpoint
SELECT app_enable_staff_only('metas_modelos');
--> statement-breakpoint
-- metas_paciente: o paciente lê as próprias metas e nunca as grava (sem app_allow_paciente_escrita — QP-D34: sem `update`,
-- SELECT … FOR SHARE/KEY SHARE da sessão de paciente não enxerga a linha)
SELECT app_enable_tenant_rls('metas_paciente');
--> statement-breakpoint
SELECT app_enable_patient_rls('metas_paciente');
--> statement-breakpoint
SELECT app_enable_audit('metas_paciente', 'metas');
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON metas_paciente FROM nutri_app_role;
--> statement-breakpoint
-- metas_registros (RN-547): o paciente com login registra a própria meta de hoje ou de ontem e troca `cumprida`
SELECT app_enable_tenant_rls('metas_registros');
--> statement-breakpoint
SELECT app_enable_patient_rls('metas_registros');
--> statement-breakpoint
-- "Registrou meta" (QP-D36)
SELECT app_enable_audit('metas_registros', 'metas_registro');
--> statement-breakpoint
SELECT app_allow_paciente_escrita('metas_registros', 'insert', 'update');
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON metas_registros FROM nutri_app_role;
--> statement-breakpoint
-- O link sem login nunca registra meta, nem lê os registros (molde patient_cadastro_paciente_com_conta, 0125)
CREATE POLICY paciente_meta_registro_com_conta ON metas_registros AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL)
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL);
--> statement-breakpoint
-- (5) Dia no fuso do consultório (QP-D56, RN-547). app_dia_no_fuso é a função pura que os testes chamam com um instante fixo
-- (o now() do Postgres não se fixa); app_hoje_do_tenant() é o "hoje" do tenant de app.tenant_id (nulo sem app.tenant_id),
-- com o mesmo now() da transação que o gatilho de metas_registros usa. tenants está fora da RLS.
CREATE OR REPLACE FUNCTION app_dia_no_fuso(instante timestamptz, fuso text) RETURNS date
LANGUAGE sql STABLE
SET search_path = public, pg_temp AS $$
  SELECT (instante AT TIME ZONE fuso)::date
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_dia_no_fuso(timestamptz, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_dia_no_fuso(timestamptz, text) TO nutri_app_role;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_hoje_do_tenant() RETURNS date
LANGUAGE sql STABLE
SET search_path = public, pg_temp AS $$
  SELECT public.app_dia_no_fuso(now(), t.fuso) FROM public.tenants t WHERE t.id = public.app_current_tenant()
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_hoje_do_tenant() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_hoje_do_tenant() TO nutri_app_role;
--> statement-breakpoint
-- (6) Gatilhos de regras (spec §9.2–§9.4, QP-D35): UPDATE sem mudança passa para todo papel; tenant ou titular de fora da
-- sessão e papéis que não são donos da operação → RETURN NEW (a RLS da própria tabela recusa, com a mensagem que o teste de
-- isolamento espera, violaRlsDe); 42501 só depois. O contexto vazio ('': migration, semente, fábrica) não tem tenant na sessão:
-- para ele não há "tenant de fora", e as regras valem como escritas abaixo. Comparações com IS DISTINCT FROM.
--
-- questionario_envios_regras (BEFORE INSERT OR UPDATE), molde 0119/0116, tudo com IS DISTINCT FROM (QP-D35):
--   0. UPDATE sem mudança (to_jsonb(NEW) - 'updated_at' = to_jsonb(OLD) - 'updated_at') → RETURN NEW, qualquer papel
--   1. NEW.tenant_id ≠ app_current_tenant(), ou papel 'paciente' com NEW.patient_id ≠ app_current_patient() → RETURN NEW
--      (a RLS da própria tabela recusa: os testes negativos do isolamento esperam a mensagem dela, violaRlsDe)
--   2. papel 'publico', 'conta', 'recepcao' — e 'paciente' no INSERT — → RETURN NEW (publico_negado, isolamento da conta,
--      recepcao_negada e paciente_sem_insert recusam)
--   INSERT ('nutri', 'worker', ''): lê o titular FOR KEY SHARE (NOT FOUND → RETURN NEW; status ≠ 'ativo' ou anonimizado_em
--           → 42501): espera o bloqueio em curso e nunca cria envio para titular bloqueado (RN-533);
--           'nutri': origem 'nutri', enviado_por = app_current_user(); 'worker'/'': origem 'automatico', enviado_por nulo;
--           para os dois: situacao 'enviado', sem respostas, sem cancelamento, sem anamnese_id;
--           'nutri' e 'worker': enviado_em e created_at := clock_timestamp() (o valor mandado não vale) e expira_em nulo ou
--           <= enviado_em → 42501, antes do CHECK (P27-01d); '' grava o mandado (semente)
--   UPDATE, colunas fixas para todos: id, tenant_id, patient_id, modelo_id, modelo_snapshot, origem, enviado_por, enviado_em,
--           created_at; respostas, respondido_em e respondido_via nunca mudam depois de gravadas
--   'paciente': só enviado → respondido (RN-529), clock_timestamp() < OLD.expira_em, titular ativo e não anonimizado
--           (lê patients FOR KEY SHARE — visível: a sessão de paciente tem update em patients; o módulo já travou antes,
--           QP-D33), respondido_em := clock_timestamp(), respondido_via 'app' ⇔ app_current_user() IS NOT NULL;
--           nenhuma outra coluna (to_jsonb(NEW) - lista = to_jsonb(OLD) - lista); respondido_via fora de 'app'/'link' (ou
--           nulo) e respostas nulas → 42501 do gatilho, antes do CHECK (P27-01c: o 23514 levaria a linha — snapshot e
--           respostas — ao log do Postgres; regra 3)
--   'nutri': enviado → cancelado (cancelado_por = app_current_user(); motivo 'nutri', ou 'paciente_bloqueado' só com o
--           titular já em status 'bloqueado'; cancelado_em := clock_timestamp()); anamnese_id de nulo para valor só em
--           'respondido'; nada mais
--   'worker'/'': enviado → expirado (só com OLD.expira_em <= clock_timestamp() ou, com consulta, o inicio dela já passado);
--           enviado → cancelado (motivo 'consulta_cancelada', cancelado_por nulo, só com a consulta de OLD.appointment_id
--           em 'cancelada' — QP-D59; cancelado_em := clock_timestamp()); com situacao 'enviado', troca de expira_em, com ou
--           sem troca de appointment_id
--           (remarcação e consulta movida, RN-535: lê a consulta de NEW.appointment_id e exige expira_em = inicio dela;
--           consulta 'cancelada' → 42501, e expira_em <= OLD.enviado_em → 42501 antes do CHECK — P27-01d: o 23514 do
--           dono/migrator levaria a linha ao log do Postgres)
--   qualquer outro caso: 42501
-- A consulta é lida com FOR KEY SHARE (ordem de travas RN-559: paciente → envio → consulta). cancelado_em, como
-- respondido_em, é do relógio do banco: o valor mandado não vale (P27-01c).
CREATE OR REPLACE FUNCTION app_questionario_envios_regras() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
  v_status text;
  v_anonimizado timestamptz;
  v_consulta_status text;
  v_inicio timestamptz;
  v_resposta text[] := ARRAY['situacao', 'respostas', 'respondido_em', 'respondido_via', 'updated_at'];
  v_cancelamento text[] := ARRAY['situacao', 'cancelado_em', 'cancelado_por', 'cancelado_motivo', 'updated_at'];
BEGIN
  -- 0
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RETURN NEW;
  END IF;
  -- 1
  IF (r <> '' AND NEW.tenant_id IS DISTINCT FROM app_current_tenant())
     OR (r = 'paciente' AND NEW.patient_id IS DISTINCT FROM app_current_patient()) THEN
    RETURN NEW;
  END IF;
  -- 2
  IF r IN ('publico', 'conta', 'recepcao') OR (r = 'paciente' AND TG_OP = 'INSERT') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF r NOT IN ('nutri', 'worker', '') THEN
      RAISE EXCEPTION 'envio de questionário só pela equipe ou pelo envio automático' USING ERRCODE = '42501';
    END IF;
    SELECT p.status, p.anonimizado_em INTO v_status, v_anonimizado
      FROM public.patients p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.patient_id
      FOR KEY SHARE;
    IF NOT FOUND THEN
      RETURN NEW; -- a FK questionario_envios_paciente_fk recusa
    END IF;
    IF v_status IS DISTINCT FROM 'ativo' OR v_anonimizado IS NOT NULL THEN
      RAISE EXCEPTION 'questionário só para titular ativo' USING ERRCODE = '42501';
    END IF;
    IF r = 'nutri' THEN
      IF NEW.origem IS DISTINCT FROM 'nutri' OR NEW.enviado_por IS DISTINCT FROM app_current_user() THEN
        RAISE EXCEPTION 'o envio manual sai em nome da usuária da sessão' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.origem IS DISTINCT FROM 'automatico' OR NEW.enviado_por IS NOT NULL THEN
      RAISE EXCEPTION 'o worker só faz o envio automático, sem autora' USING ERRCODE = '42501';
    END IF;
    IF NEW.situacao IS DISTINCT FROM 'enviado'
       OR NEW.respostas IS NOT NULL OR NEW.respondido_em IS NOT NULL OR NEW.respondido_via IS NOT NULL
       OR NEW.cancelado_em IS NOT NULL OR NEW.cancelado_por IS NOT NULL OR NEW.cancelado_motivo IS NOT NULL
       OR NEW.anamnese_id IS NOT NULL THEN
      RAISE EXCEPTION 'o envio nasce enviado, sem resposta, cancelamento nem anamnese' USING ERRCODE = '42501';
    END IF;
    -- P27-01d: a data do envio no prontuário é do relógio do banco, e o prazo vem depois dela (42501 antes do CHECK)
    IF r IN ('nutri', 'worker') THEN
      NEW.enviado_em := clock_timestamp();
      NEW.created_at := NEW.enviado_em;
      IF NEW.expira_em IS NULL OR NEW.expira_em <= NEW.enviado_em THEN
        RAISE EXCEPTION 'o prazo do envio precisa ser depois do envio' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: colunas fixas para todos
  IF (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.modelo_id, NEW.modelo_snapshot, NEW.origem, NEW.enviado_por, NEW.enviado_em, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.modelo_id, OLD.modelo_snapshot, OLD.origem, OLD.enviado_por, OLD.enviado_em, OLD.created_at) THEN
    RAISE EXCEPTION 'coluna fixa do envio de questionário' USING ERRCODE = '42501';
  END IF;
  IF (OLD.respostas IS NOT NULL AND NEW.respostas IS DISTINCT FROM OLD.respostas)
     OR (OLD.respondido_em IS NOT NULL AND NEW.respondido_em IS DISTINCT FROM OLD.respondido_em)
     OR (OLD.respondido_via IS NOT NULL AND NEW.respondido_via IS DISTINCT FROM OLD.respondido_via) THEN
    RAISE EXCEPTION 'as respostas do questionário não mudam depois de gravadas' USING ERRCODE = '42501';
  END IF;

  IF r = 'paciente' THEN
    IF OLD.situacao IS DISTINCT FROM 'enviado' OR NEW.situacao IS DISTINCT FROM 'respondido'
       OR (to_jsonb(NEW) - v_resposta) IS DISTINCT FROM (to_jsonb(OLD) - v_resposta) THEN
      RAISE EXCEPTION 'o paciente só responde o questionário enviado' USING ERRCODE = '42501';
    END IF;
    IF NEW.respondido_via IS NULL OR NEW.respondido_via NOT IN ('app', 'link') OR NEW.respostas IS NULL THEN
      RAISE EXCEPTION 'resposta do questionário sem respostas ou com canal inválido' USING ERRCODE = '42501';
    END IF;
    IF clock_timestamp() >= OLD.expira_em THEN
      RAISE EXCEPTION 'o prazo do questionário acabou' USING ERRCODE = '42501';
    END IF;
    IF (NEW.respondido_via = 'app' AND app_current_user() IS NULL)
       OR (NEW.respondido_via = 'link' AND app_current_user() IS NOT NULL) THEN
      RAISE EXCEPTION 'resposta pelo app só com login; pelo link só sem login' USING ERRCODE = '42501';
    END IF;
    SELECT p.status, p.anonimizado_em INTO v_status, v_anonimizado
      FROM public.patients p WHERE p.tenant_id = OLD.tenant_id AND p.id = OLD.patient_id
      FOR KEY SHARE;
    IF NOT FOUND OR v_status IS DISTINCT FROM 'ativo' OR v_anonimizado IS NOT NULL THEN
      RAISE EXCEPTION 'questionário só para titular ativo' USING ERRCODE = '42501';
    END IF;
    NEW.respondido_em := clock_timestamp();
    RETURN NEW;
  END IF;

  IF r = 'nutri' THEN
    IF OLD.situacao = 'enviado' AND NEW.situacao = 'cancelado'
       AND (to_jsonb(NEW) - v_cancelamento) IS NOT DISTINCT FROM (to_jsonb(OLD) - v_cancelamento) THEN
      IF NEW.cancelado_por IS DISTINCT FROM app_current_user() THEN
        RAISE EXCEPTION 'o cancelamento sai em nome da usuária da sessão' USING ERRCODE = '42501';
      END IF;
      IF NEW.cancelado_motivo IS NOT DISTINCT FROM 'nutri' THEN
        NEW.cancelado_em := clock_timestamp();
        RETURN NEW;
      END IF;
      IF NEW.cancelado_motivo IS NOT DISTINCT FROM 'paciente_bloqueado' THEN
        SELECT p.status INTO v_status
          FROM public.patients p WHERE p.tenant_id = OLD.tenant_id AND p.id = OLD.patient_id
          FOR KEY SHARE;
        IF v_status IS NOT DISTINCT FROM 'bloqueado' THEN
          NEW.cancelado_em := clock_timestamp();
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'cancelamento por bloqueio só com o titular bloqueado' USING ERRCODE = '42501';
      END IF;
      RAISE EXCEPTION 'a nutricionista cancela pelo motivo nutri ou paciente_bloqueado' USING ERRCODE = '42501';
    END IF;
    IF OLD.situacao = 'respondido' AND OLD.anamnese_id IS NULL AND NEW.anamnese_id IS NOT NULL
       AND (to_jsonb(NEW) - 'anamnese_id' - 'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'anamnese_id' - 'updated_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'a nutricionista só cancela o envio aberto ou liga a anamnese da cópia' USING ERRCODE = '42501';
  END IF;

  IF r IN ('worker', '') AND OLD.situacao = 'enviado' THEN
    IF NEW.situacao = 'expirado'
       AND (to_jsonb(NEW) - 'situacao' - 'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'situacao' - 'updated_at') THEN
      IF OLD.expira_em <= clock_timestamp() THEN
        RETURN NEW;
      END IF;
      IF OLD.appointment_id IS NOT NULL THEN
        SELECT a.inicio INTO v_inicio
          FROM public.appointments a WHERE a.tenant_id = OLD.tenant_id AND a.id = OLD.appointment_id
          FOR KEY SHARE;
        IF v_inicio <= clock_timestamp() THEN
          RETURN NEW;
        END IF;
      END IF;
      RAISE EXCEPTION 'o envio ainda não venceu' USING ERRCODE = '42501';
    END IF;
    IF NEW.situacao = 'cancelado'
       AND (to_jsonb(NEW) - v_cancelamento) IS NOT DISTINCT FROM (to_jsonb(OLD) - v_cancelamento) THEN
      IF NEW.cancelado_motivo IS DISTINCT FROM 'consulta_cancelada' OR NEW.cancelado_por IS NOT NULL OR OLD.appointment_id IS NULL THEN
        RAISE EXCEPTION 'o worker só cancela pela consulta cancelada, sem autora' USING ERRCODE = '42501';
      END IF;
      SELECT a.status INTO v_consulta_status
        FROM public.appointments a WHERE a.tenant_id = OLD.tenant_id AND a.id = OLD.appointment_id
        FOR KEY SHARE;
      IF v_consulta_status IS NOT DISTINCT FROM 'cancelada' THEN
        NEW.cancelado_em := clock_timestamp();
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'a consulta do envio não foi cancelada' USING ERRCODE = '42501';
    END IF;
    IF NEW.situacao = 'enviado'
       AND (to_jsonb(NEW) - 'expira_em' - 'appointment_id' - 'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'expira_em' - 'appointment_id' - 'updated_at') THEN
      IF NEW.appointment_id IS NOT NULL THEN
        SELECT a.inicio, a.status INTO v_inicio, v_consulta_status
          FROM public.appointments a WHERE a.tenant_id = NEW.tenant_id AND a.patient_id = NEW.patient_id AND a.id = NEW.appointment_id
          FOR KEY SHARE;
        -- P27-01d: consulta cancelada não recebe o envio (o worker cancela pela consulta, RN-534); o prazo vem depois do envio
        IF v_consulta_status IS NOT DISTINCT FROM 'cancelada' THEN
          RAISE EXCEPTION 'o envio não passa para uma consulta cancelada' USING ERRCODE = '42501';
        END IF;
        IF NEW.expira_em <= OLD.enviado_em THEN
          RAISE EXCEPTION 'o prazo do envio precisa ser depois do envio' USING ERRCODE = '42501';
        END IF;
        IF NEW.expira_em IS NOT DISTINCT FROM v_inicio THEN
          RETURN NEW;
        END IF;
      END IF;
      RAISE EXCEPTION 'o prazo do envio acompanha o início da consulta' USING ERRCODE = '42501';
    END IF;
  END IF;

  RAISE EXCEPTION 'transição não permitida no envio de questionário' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE TRIGGER questionario_envios_regras BEFORE INSERT OR UPDATE ON questionario_envios FOR EACH ROW EXECUTE FUNCTION app_questionario_envios_regras();
--> statement-breakpoint
-- recordatorios_regras (BEFORE INSERT OR UPDATE): INSERT na sessão 'nutri' → criado_por := app_current_user(); 'worker' no
--   próprio tenant → 42501 (nenhum fluxo do worker grava recordatório, e o papel worker também roda no processo web — QP-D59);
--   '' (migration, semente, fábrica) passa; tenant de fora e os outros papéis → RETURN NEW (a RLS decide);
--   UPDATE: id, tenant_id, patient_id, criado_por, created_at fixos (42501); 'worker' → 42501
--   'nutri', INSERT e UPDATE (com mudança), P27-01d: lê o titular FOR KEY SHARE e recusa o bloqueado ou anonimizado com
--   42501 (o bloqueio congela o prontuário; arquivado segue, RN-540); ordem de travas: o módulo já travou o paciente antes
-- (QP-D35: o UPDATE sem mudança passa para todo papel, inclusive o worker)
CREATE OR REPLACE FUNCTION app_recordatorios_regras() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
  v_status text;
  v_anonimizado timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN
    RETURN NEW;
  END IF;
  IF r <> '' AND NEW.tenant_id IS DISTINCT FROM app_current_tenant() THEN
    RETURN NEW;
  END IF;
  IF r NOT IN ('nutri', 'worker', '') THEN
    RETURN NEW;
  END IF;
  IF r = 'worker' THEN
    RAISE EXCEPTION 'o recordatório só pela sessão da nutricionista' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.criado_por, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.criado_por, OLD.created_at) THEN
    RAISE EXCEPTION 'coluna fixa do recordatório' USING ERRCODE = '42501';
  END IF;
  IF r = 'nutri' THEN
    -- NOT FOUND (só no INSERT): a FK recordatorios_paciente_fk recusa
    SELECT p.status, p.anonimizado_em INTO v_status, v_anonimizado
      FROM public.patients p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.patient_id
      FOR KEY SHARE;
    IF v_status IS NOT DISTINCT FROM 'bloqueado' OR v_anonimizado IS NOT NULL THEN
      RAISE EXCEPTION 'recordatório de titular bloqueado ou anonimizado não muda' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'INSERT' THEN
      NEW.criado_por := app_current_user();
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER recordatorios_regras BEFORE INSERT OR UPDATE ON recordatorios FOR EACH ROW EXECUTE FUNCTION app_recordatorios_regras();
--> statement-breakpoint
-- recordatorio_itens_colunas_fixas (BEFORE UPDATE): id, tenant_id, patient_id, recordatorio_id fixos (42501): um item nunca
--   muda de recordatório nem de paciente (QP-D35: sem mudança passa; tenant de fora → RETURN NEW, a RLS recusa)
CREATE OR REPLACE FUNCTION app_recordatorio_itens_colunas_fixas() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
BEGIN
  IF r <> '' AND NEW.tenant_id IS DISTINCT FROM app_current_tenant() THEN
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.recordatorio_id) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.recordatorio_id) THEN
    RAISE EXCEPTION 'coluna fixa do item do recordatório' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER recordatorio_itens_colunas_fixas BEFORE UPDATE ON recordatorio_itens FOR EACH ROW EXECUTE FUNCTION app_recordatorio_itens_colunas_fixas();
--> statement-breakpoint
-- recordatorio_itens_sem_worker (BEFORE INSERT OR UPDATE OR DELETE), P27-01c: como a mãe (recordatorios_regras, QP-D59), o
--   'worker' no próprio tenant → 42501 no INSERT, no UPDATE e no DELETE (nenhum fluxo do worker grava ou apaga item, e o papel
--   worker também roda no processo web); o UPDATE sem mudança passa (QP-D35); tenant de fora → segue (a RLS recusa o INSERT e
--   o UPDATE e esconde a linha do DELETE); os outros papéis seguem (a RLS e recordatorio_itens_colunas_fixas decidem); o
--   contexto vazio ('': migration, semente, fábrica) é livre
CREATE OR REPLACE FUNCTION app_recordatorio_itens_sem_worker() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
BEGIN
  IF r <> 'worker' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.tenant_id IS DISTINCT FROM app_current_tenant() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'o item do recordatório só pela sessão da nutricionista' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM app_current_tenant() THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'o item do recordatório só pela sessão da nutricionista' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE TRIGGER recordatorio_itens_sem_worker BEFORE INSERT OR UPDATE OR DELETE ON recordatorio_itens FOR EACH ROW EXECUTE FUNCTION app_recordatorio_itens_sem_worker();
--> statement-breakpoint
-- metas_paciente_regras (BEFORE INSERT OR UPDATE), QP-D35: tenant de fora e papéis 'paciente', 'publico', 'conta', 'recepcao'
--   → RETURN NEW (a RLS recusa); INSERT 'nutri' → criado_por := app_current_user(); UPDATE sem mudança passa;
--   id, tenant_id, patient_id, inicio (depois do 1º registro, lido sob a trava do paciente que o módulo toma), criado_por,
--   created_at fixos (42501); 'ativa' → 'alcancada'|'encerrada' sem volta; só 'nutri' e '' gravam; 'worker' no próprio
--   tenant → 42501 (nenhum fluxo do worker grava meta: a meta terminada é derivada na leitura, QP-D55, QP-D59); o paciente é
--   negado pela RLS — NUNCA liberar update em metas_paciente ao paciente, QP-D34: este gatilho não tem ramo de paciente.
--   P27-01d ('nutri' e ''): ao ir para 'alcancada'|'encerrada', encerrada_em := clock_timestamp() (o valor mandado não vale);
--   meta terminada não muda mais nada (encerrada_em, título, como_fazer, categoria, lembrete, fim, inicio, modelo: 42501;
--   só updated_at — a spec não prevê editar meta encerrada: "Não há reabrir: nova meta", RN-546); encerrada_em numa meta
--   'ativa' → 42501 (antes do CHECK); INSERT 'nutri' nasce 'ativa', sem encerrada_em. Na sessão 'nutri' o titular é lido
--   FOR KEY SHARE (o módulo já o travou FOR UPDATE, QP-D33): anonimizado → 42501 em tudo; bloqueado → 42501 no INSERT e no
--   UPDATE, salvo 'ativa' → 'encerrada' sem outra coluna (o UPDATE do bloqueio em atenderPedidoExclusao, RN-550); '' livre
CREATE OR REPLACE FUNCTION app_metas_paciente_regras() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
  v_status text;
  v_anonimizado timestamptz;
  v_encerrar text[] := ARRAY['situacao', 'encerrada_em', 'updated_at'];
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN
    RETURN NEW;
  END IF;
  IF r <> '' AND NEW.tenant_id IS DISTINCT FROM app_current_tenant() THEN
    RETURN NEW;
  END IF;
  IF r IN ('paciente', 'publico', 'conta', 'recepcao') THEN
    RETURN NEW;
  END IF;
  IF r NOT IN ('nutri', '') THEN
    RAISE EXCEPTION 'a meta do paciente só pela sessão da nutricionista' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.criado_por, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.criado_por, OLD.created_at) THEN
    RAISE EXCEPTION 'coluna fixa da meta' USING ERRCODE = '42501';
  END IF;
  IF r = 'nutri' THEN
    -- NOT FOUND (só no INSERT): a FK metas_paciente_paciente_fk recusa
    SELECT p.status, p.anonimizado_em INTO v_status, v_anonimizado
      FROM public.patients p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.patient_id
      FOR KEY SHARE;
    IF v_anonimizado IS NOT NULL THEN
      RAISE EXCEPTION 'meta de titular anonimizado não muda' USING ERRCODE = '42501';
    END IF;
    IF v_status IS NOT DISTINCT FROM 'bloqueado'
       AND NOT (TG_OP = 'UPDATE' AND OLD.situacao = 'ativa' AND NEW.situacao = 'encerrada'
                AND (to_jsonb(NEW) - v_encerrar) IS NOT DISTINCT FROM (to_jsonb(OLD) - v_encerrar)) THEN
      RAISE EXCEPTION 'meta de titular bloqueado só se encerra' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF r = 'nutri' THEN
      IF NEW.situacao IS DISTINCT FROM 'ativa' OR NEW.encerrada_em IS NOT NULL THEN
        RAISE EXCEPTION 'a meta nasce ativa' USING ERRCODE = '42501';
      END IF;
      NEW.criado_por := app_current_user();
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.situacao IS DISTINCT FROM 'ativa' AND NEW.situacao IS DISTINCT FROM OLD.situacao THEN
    RAISE EXCEPTION 'meta encerrada não volta' USING ERRCODE = '42501';
  END IF;
  -- P27-01d: meta terminada é registro fechado do prontuário (só updated_at muda)
  IF OLD.situacao IS DISTINCT FROM 'ativa'
     AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'meta encerrada não muda' USING ERRCODE = '42501';
  END IF;
  IF OLD.situacao = 'ativa' AND NEW.situacao IN ('alcancada', 'encerrada') THEN
    NEW.encerrada_em := clock_timestamp();
  ELSIF NEW.situacao = 'ativa' AND NEW.encerrada_em IS NOT NULL THEN
    RAISE EXCEPTION 'meta ativa não tem data de encerramento' USING ERRCODE = '42501';
  END IF;
  IF NEW.inicio IS DISTINCT FROM OLD.inicio
     AND EXISTS (SELECT 1 FROM public.metas_registros m WHERE m.tenant_id = OLD.tenant_id AND m.meta_id = OLD.id) THEN
    RAISE EXCEPTION 'o início da meta não muda depois do primeiro registro' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER metas_paciente_regras BEFORE INSERT OR UPDATE ON metas_paciente FOR EACH ROW EXECUTE FUNCTION app_metas_paciente_regras();
--> statement-breakpoint
-- metas_registros_regras (BEFORE INSERT OR UPDATE), RN-547 e QP-D35: UPDATE sem mudança passa; tenant/titular de fora e os
--   papéis 'publico', 'conta', 'recepcao' → RETURN NEW (a RLS recusa); 'nutri' e 'worker' no próprio tenant → 42501; '' passa;
--   'paciente': titular FOR KEY SHARE (ativo, não anonimizado) e DEPOIS a meta SEM trava (FOR SHARE/KEY SHARE some na sessão
--   de paciente: paciente_sem_update, 0070:15-16) — a trava do titular é que serializa com "Encerrar"/"Editar" (QP-D33, QP-D34)
-- No papel paciente (INSERT e UPDATE, que é o ON CONFLICT … DO UPDATE do mesmo dia): meta do próprio paciente, 'ativa', com
-- `dia` entre inicio e coalesce(fim, dia) e `dia` = hoje ou ontem no fuso do tenant (app_hoje_do_tenant(), mesmo now() da
-- transação); no UPDATE só `cumprida` muda. registrado_em (e atualizado_em) := clock_timestamp() no INSERT, atualizado_em no
-- UPDATE: o valor mandado não vale.
CREATE OR REPLACE FUNCTION app_metas_registros_regras() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
  v_status text;
  v_anonimizado timestamptz;
  v_situacao text;
  v_inicio date;
  v_fim date;
  v_hoje date;
  v_agora timestamptz := clock_timestamp();
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN
    RETURN NEW;
  END IF;
  IF (r <> '' AND NEW.tenant_id IS DISTINCT FROM app_current_tenant())
     OR (r = 'paciente' AND NEW.patient_id IS DISTINCT FROM app_current_patient()) THEN
    RETURN NEW;
  END IF;
  IF r IN ('publico', 'conta', 'recepcao') THEN
    RETURN NEW;
  END IF;
  IF r = '' THEN
    RETURN NEW;
  END IF;
  IF r <> 'paciente' THEN
    RAISE EXCEPTION 'o registro da meta só pelo paciente' USING ERRCODE = '42501';
  END IF;

  SELECT p.status, p.anonimizado_em INTO v_status, v_anonimizado
    FROM public.patients p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.patient_id
    FOR KEY SHARE;
  IF NOT FOUND OR v_status IS DISTINCT FROM 'ativo' OR v_anonimizado IS NOT NULL THEN
    RAISE EXCEPTION 'registro de meta só do titular ativo' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'cumprida' - 'atualizado_em') IS DISTINCT FROM (to_jsonb(OLD) - 'cumprida' - 'atualizado_em') THEN
    RAISE EXCEPTION 'no registro da meta só "cumprida" muda' USING ERRCODE = '42501';
  END IF;
  SELECT m.situacao, m.inicio, m.fim INTO v_situacao, v_inicio, v_fim
    FROM public.metas_paciente m WHERE m.tenant_id = NEW.tenant_id AND m.patient_id = NEW.patient_id AND m.id = NEW.meta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'meta de outro paciente' USING ERRCODE = '42501';
  END IF;
  IF v_situacao IS DISTINCT FROM 'ativa' THEN
    RAISE EXCEPTION 'meta não ativa' USING ERRCODE = '42501';
  END IF;
  IF NEW.dia < v_inicio OR NEW.dia > coalesce(v_fim, NEW.dia) THEN
    RAISE EXCEPTION 'dia fora do período da meta' USING ERRCODE = '42501';
  END IF;
  v_hoje := app_hoje_do_tenant();
  IF NEW.dia IS DISTINCT FROM v_hoje AND NEW.dia IS DISTINCT FROM v_hoje - 1 THEN
    RAISE EXCEPTION 'o registro da meta é de hoje ou de ontem' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.registrado_em := v_agora;
  END IF;
  NEW.atualizado_em := v_agora;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER metas_registros_regras BEFORE INSERT OR UPDATE ON metas_registros FOR EACH ROW EXECUTE FUNCTION app_metas_registros_regras();
