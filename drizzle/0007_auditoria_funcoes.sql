CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_ip() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.ip', true), '') $$;
--> statement-breakpoint
-- RNF-08 / US-007: toda escrita numa tabela de saúde vira uma linha no audit_log, com o ator
-- e o IP que o withTenant aplicou. Nada do conteúdo da linha é copiado (só id e titular).
-- clock_timestamp(): várias ações na mesma transação ficam em ordem.
-- search_path fixo (T4-R2a): sem isso, uma sessão com CREATE TEMP TABLE audit_log (nutri_app
-- tem TEMP por padrão) desviaria a auditoria para a tabela temporária sem erro nenhum, porque
-- pg_temp é buscado antes de qualquer schema do search_path quando não está listado nele.
-- Citar "public.audit_log" explicitamente é defesa em profundidade além disso.
CREATE OR REPLACE FUNCTION app_audit_row_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
  INSERT INTO public.audit_log (tenant_id, actor_user_id, acao, entidade, entidade_id, patient_id, ip, criado_em)
  VALUES (
    (r ->> 'tenant_id')::uuid,
    app_current_user(),
    CASE TG_OP WHEN 'INSERT' THEN 'criar' WHEN 'UPDATE' THEN 'alterar' ELSE 'excluir' END,
    TG_ARGV[0],
    r ->> 'id',
    nullif(r ->> TG_ARGV[1], '')::uuid,
    app_current_ip(),
    clock_timestamp()
  );
  RETURN NULL;
END $$;
--> statement-breakpoint
-- T4-R2b: coluna do titular errada (typo) nunca deve instalar o gatilho silenciosamente —
-- ficaria gravando patient_id sempre nulo e a auditoria por paciente furaria sem avisar ninguém.
CREATE OR REPLACE FUNCTION app_enable_audit(tbl regclass, entidade text, col text DEFAULT 'patient_id') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = tbl AND a.attname = col AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'app_enable_audit: coluna "%" não existe em %', col, tbl;
  END IF;
  EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON %s', tbl);
  EXECUTE format(
    'CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON %s '
    'FOR EACH ROW EXECUTE FUNCTION app_audit_row_change(%L, %L)', tbl, entidade, col);
END $$;
--> statement-breakpoint
-- audit_log agora tem patient_id: sessão de paciente só vê/grava linhas do próprio titular
SELECT app_enable_patient_rls('audit_log');
