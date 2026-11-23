-- Limpeza dos Minor P17–P20 (TRI-17-20; triagem, seção 3). CLAUDE.md regra 2 (Plano 17). Nada de 0119/0120 é editado.
-- TRI-17-20 #5 (triagem, seção 3, item 2): a equipe apagava a marca do último slot e reabria o envio (o push saía de novo em
-- até 10 min). O DELETE da marca passa a ser só do worker e do contexto vazio (migration, anonimização) — e da cascata do
-- lembrete (FK lembretes_rotina_envios_lembrete_fk, ON DELETE CASCADE): a equipe ainda apaga o lembrete e a marca sai junto,
-- inclusive na exclusão atendida (lgpd.ts). A cascata roda dentro do gatilho de RI do lembrete, então aqui pg_trigger_depth()
-- é 2 (conferido em banco.test.ts); um DELETE direto da sessão `nutri` tem profundidade 1. Os outros papéis: 42501.
CREATE OR REPLACE FUNCTION app_lembretes_rotina_envios_sem_apagar() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF coalesce(app_current_role(), '') IN ('', 'worker') OR pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'a marca de envio do lembrete só sai pelo worker ou com o lembrete' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE TRIGGER lembretes_rotina_envios_sem_apagar BEFORE DELETE ON lembretes_rotina_envios FOR EACH ROW EXECUTE FUNCTION app_lembretes_rotina_envios_sem_apagar();
--> statement-breakpoint
-- TRI-17-20 #6 (triagem, seção 3, item 5): 0119 + duas regras, o resto linha a linha:
-- (#6) a sessão de paciente sem conta (link, WhatsApp, convite: app.user_id vazio — mesmo critério da política
--      patient_cadastro_paciente_com_conta, 0125) não grava nada; nem o UPDATE sem mudança.
-- (#6) na sessão de paciente, `updated_at` é o now() da transação, não o valor enviado.
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
    IF app_current_user() IS NULL THEN
      RAISE EXCEPTION 'o paciente sem conta não altera os lembretes' USING ERRCODE = '42501';
    END IF;
    IF (to_jsonb(NEW) - 'desligado_pelo_paciente_em' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'desligado_pelo_paciente_em' - 'updated_at') THEN
      RAISE EXCEPTION 'o paciente só liga e desliga o próprio lembrete' USING ERRCODE = '42501';
    END IF;
    IF NEW.desligado_pelo_paciente_em IS DISTINCT FROM OLD.desligado_pelo_paciente_em AND NEW.desligado_pelo_paciente_em IS NOT NULL THEN
      NEW.desligado_pelo_paciente_em := clock_timestamp();
    END IF;
    NEW.updated_at := now();
  ELSIF r IN ('publico', 'conta') THEN
    RAISE EXCEPTION 'contexto sem escrita nos lembretes' USING ERRCODE = '42501';
  ELSIF r NOT IN ('', 'worker') AND NEW.desligado_pelo_paciente_em IS DISTINCT FROM OLD.desligado_pelo_paciente_em THEN
    RAISE EXCEPTION 'só o paciente liga e desliga a própria marca do lembrete' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
