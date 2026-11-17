-- Plano 17 (spec de lembretes de rotina §5.3, §5.5). CLAUDE.md regras 2 e 8.
SELECT app_enable_tenant_rls('lembretes_rotina');
--> statement-breakpoint
SELECT app_enable_patient_rls('lembretes_rotina');
--> statement-breakpoint
-- §5.5: a configuração é parte da conduta (nome do suplemento, texto da nutricionista): escritas da equipe e do paciente auditadas
SELECT app_enable_audit('lembretes_rotina', 'lembretes');
--> statement-breakpoint
-- §5.3: o paciente só ATUALIZA o próprio lembrete (desligar/religar — o gatilho abaixo confere as colunas); não cria nem apaga
SELECT app_allow_paciente_escrita('lembretes_rotina', 'update');
--> statement-breakpoint
SELECT app_enable_tenant_rls('lembretes_rotina_envios');
--> statement-breakpoint
SELECT app_enable_patient_rls('lembretes_rotina_envios');
--> statement-breakpoint
-- §5.5: a marca do envio é registro técnico do worker — o paciente não a vê; sem gatilho de auditoria (AUDIT_EXCEPTIONS)
SELECT app_enable_staff_only('lembretes_rotina_envios');
--> statement-breakpoint
-- §5.3 (autonomia do titular; molde 0116): colunas fixas para todos; a sessão de paciente só muda a própria marca
-- `desligado_pelo_paciente_em` (e `updated_at`), com o relógio do banco ao desligar; a sessão `nutri` muda a configuração mas
-- nunca essa marca — nem para religar, nem para desligar em nome do paciente (nem ao criar). O worker e o contexto vazio
-- (migration, anonimização) mudam a marca. Público e conta nada. Tudo com IS DISTINCT FROM: o UPDATE sem mudança passa
-- (`set tenant_id = tenant_id` do teste de isolamento, editar o lembrete sem tocar na marca).
CREATE OR REPLACE FUNCTION app_lembretes_rotina_regras() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.desligado_pelo_paciente_em IS NOT NULL AND r NOT IN ('', 'worker') THEN
      RAISE EXCEPTION 'só o paciente desliga o próprio lembrete' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.tipo, NEW.criado_por, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.tipo, OLD.criado_por, OLD.created_at) THEN
    RAISE EXCEPTION 'coluna fixa do lembrete' USING ERRCODE = '42501';
  END IF;
  IF r = 'paciente' THEN
    IF (to_jsonb(NEW) - 'desligado_pelo_paciente_em' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'desligado_pelo_paciente_em' - 'updated_at') THEN
      RAISE EXCEPTION 'o paciente só liga e desliga o próprio lembrete' USING ERRCODE = '42501';
    END IF;
    IF NEW.desligado_pelo_paciente_em IS DISTINCT FROM OLD.desligado_pelo_paciente_em AND NEW.desligado_pelo_paciente_em IS NOT NULL THEN
      NEW.desligado_pelo_paciente_em := clock_timestamp();
    END IF;
  ELSIF r IN ('publico', 'conta') THEN
    RAISE EXCEPTION 'contexto sem escrita nos lembretes' USING ERRCODE = '42501';
  ELSIF r NOT IN ('', 'worker') AND NEW.desligado_pelo_paciente_em IS DISTINCT FROM OLD.desligado_pelo_paciente_em THEN
    RAISE EXCEPTION 'só o paciente liga e desliga a própria marca do lembrete' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER lembretes_rotina_regras BEFORE INSERT OR UPDATE ON lembretes_rotina FOR EACH ROW EXECUTE FUNCTION app_lembretes_rotina_regras();
--> statement-breakpoint
-- §5.5 / §5.6: a marca do último slot só pelo worker (e o contexto vazio). Nos outros papéis, o INSERT e o UPDATE que muda
-- alguma coluna são recusados; o UPDATE sem mudança passa (teste de isolamento). O DELETE fica com a RLS: a equipe apaga o
-- lembrete e a marca sai junto (ON DELETE CASCADE). Tenant, paciente e lembrete fixos para todos.
CREATE OR REPLACE FUNCTION app_lembretes_rotina_envios_do_worker() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id, NEW.patient_id, NEW.lembrete_id) IS DISTINCT FROM (OLD.tenant_id, OLD.patient_id, OLD.lembrete_id) THEN
    RAISE EXCEPTION 'coluna fixa da marca de envio do lembrete' USING ERRCODE = '42501';
  END IF;
  IF r IN ('', 'worker') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'a marca de envio do lembrete só pelo worker' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER lembretes_rotina_envios_do_worker BEFORE INSERT OR UPDATE ON lembretes_rotina_envios FOR EACH ROW EXECUTE FUNCTION app_lembretes_rotina_envios_do_worker();
--> statement-breakpoint
-- §5.3 (molde app_patients_ia_quem, 0099): "Pausar todos os lembretes" só na sessão de paciente (nulo ↔ valor, com o relógio
-- do banco ao pausar) ou no worker/contexto vazio (anonimização). Exceção única da sessão `nutri`: a limpeza no mesmo UPDATE
-- que leva o paciente a `bloqueado` (exclusão atendida, src/modules/pacientes/lgpd.ts). Fora disso — inclusive o INSERT de um
-- paciente já pausado —, nutri, público e conta recebem 42501. O paciente_colunas (abaixo) libera a coluna para o paciente.
CREATE OR REPLACE FUNCTION app_patients_lembretes_do_paciente() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lembretes_pausados_em IS NOT NULL AND r NOT IN ('', 'worker') THEN
      RAISE EXCEPTION 'só o paciente pausa os próprios lembretes' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.lembretes_pausados_em IS NOT DISTINCT FROM OLD.lembretes_pausados_em THEN
    RETURN NEW;
  END IF;
  IF r = 'paciente' THEN
    IF NEW.lembretes_pausados_em IS NOT NULL THEN
      NEW.lembretes_pausados_em := clock_timestamp();
    END IF;
    RETURN NEW;
  END IF;
  IF r IN ('', 'worker') THEN
    RETURN NEW;
  END IF;
  IF r = 'nutri' AND OLD.status <> 'bloqueado' AND NEW.status = 'bloqueado' AND NEW.lembretes_pausados_em IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'só o paciente pausa e retoma os próprios lembretes' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE TRIGGER patients_lembretes_do_paciente BEFORE INSERT OR UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION app_patients_lembretes_do_paciente();
--> statement-breakpoint
-- 0085 + a pausa dos lembretes em `livres` (Plano 17). O resto é o da 0085, linha a linha.
CREATE OR REPLACE FUNCTION app_paciente_colunas_patients() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  livres text[] := ARRAY['user_id', 'whatsapp_optin_em', 'whatsapp_optin_origem', 'whatsapp_optout_em', 'lembretes_pausados_em', 'updated_at'];
BEGIN
  IF app_current_role() IS DISTINCT FROM 'paciente' THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - livres) IS DISTINCT FROM (to_jsonb(OLD) - livres) THEN
    RAISE EXCEPTION 'a sessão de paciente só altera o aceite do convite, o WhatsApp e a pausa dos lembretes' USING ERRCODE = '42501';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id AND (OLD.user_id IS NOT NULL OR NEW.user_id IS DISTINCT FROM app_current_user()) THEN
    RAISE EXCEPTION 'a sessão de paciente só liga o prontuário à própria conta' USING ERRCODE = '42501';
  END IF;
  -- WhatsApp: só as duas formas de escolhaWhatsapp. A prova do consentimento da nutricionista (data e origem 'nutri')
  -- não é reescrita nem reativada (anular o optout_em) pela sessão de paciente. Tudo com IS [NOT] DISTINCT / IS [NOT]
  -- NULL: um NULL dentro do NOT (...) deixaria passar.
  IF (NEW.whatsapp_optin_em IS DISTINCT FROM OLD.whatsapp_optin_em
      OR NEW.whatsapp_optin_origem IS DISTINCT FROM OLD.whatsapp_optin_origem
      OR NEW.whatsapp_optout_em IS DISTINCT FROM OLD.whatsapp_optout_em)
     AND NOT (
       -- opt-in novo do próprio paciente
       (NEW.whatsapp_optin_em IS NOT NULL AND NEW.whatsapp_optin_em IS DISTINCT FROM OLD.whatsapp_optin_em
        AND NEW.whatsapp_optin_origem IS NOT DISTINCT FROM 'paciente' AND NEW.whatsapp_optout_em IS NULL)
       -- opt-out a partir de agora, sem mexer no opt-in
       OR (NEW.whatsapp_optin_em IS NOT DISTINCT FROM OLD.whatsapp_optin_em
           AND NEW.whatsapp_optin_origem IS NOT DISTINCT FROM OLD.whatsapp_optin_origem
           AND OLD.whatsapp_optout_em IS NULL AND NEW.whatsapp_optout_em IS NOT NULL)
     ) THEN
    RAISE EXCEPTION 'a sessão de paciente só faz opt-in com origem paciente ou opt-out' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
