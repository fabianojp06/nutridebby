CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_ip() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.ip', true), '') $$;
--> statement-breakpoint
-- RNF-08 / US-007: toda escrita numa tabela de saúde vira uma linha no audit_log, com o ator
-- e o IP que o withTenant aplicou. Nada do conteúdo da linha é copiado (só id e titular).
-- clock_timestamp(): várias ações na mesma transação ficam em ordem.
CREATE OR REPLACE FUNCTION app_audit_row_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
  INSERT INTO audit_log (tenant_id, actor_user_id, acao, entidade, entidade_id, patient_id, ip, criado_em)
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
CREATE OR REPLACE FUNCTION app_enable_audit(tbl regclass, entidade text, col text DEFAULT 'patient_id') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON %s', tbl);
  EXECUTE format(
    'CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON %s '
    'FOR EACH ROW EXECUTE FUNCTION app_audit_row_change(%L, %L)', tbl, entidade, col);
END $$;
--> statement-breakpoint
-- audit_log agora tem patient_id: sessão de paciente só vê/grava linhas do próprio titular
SELECT app_enable_patient_rls('audit_log');
