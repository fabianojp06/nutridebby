-- P09-02 (a) / spec §9.7: o worker confere, antes de registrar os consumidores, que a última migration do journal que veio
-- com o código dele já foi aplicada (o deploy sobe app e worker juntos; as migrations rodam no boot do app). O role da
-- aplicação não lê o schema `drizzle` (dono: o migrator); esta função devolve só o `created_at` da última aplicada, que o
-- drizzle grava com o `when` do journal. search_path fixo e nome qualificado (mesmo endurecimento da 0012).
CREATE OR REPLACE FUNCTION app_versao_do_schema() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT max(created_at)::bigint FROM drizzle.__drizzle_migrations $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_versao_do_schema() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_versao_do_schema() TO nutri_app_role;
