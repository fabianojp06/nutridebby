-- D6: unaccent é STABLE e não entra em índice; o wrapper fixa o dicionário e pode ser IMMUTABLE
CREATE OR REPLACE FUNCTION app_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
--> statement-breakpoint
CREATE INDEX foods_busca_idx ON foods USING gin (app_unaccent(lower(nome)) gin_trgm_ops);
--> statement-breakpoint
SELECT app_enable_tenant_rls('foods');
--> statement-breakpoint
-- D1: a TACO (tenant_id nulo) é lida por todos os tenants; só SELECT, então UPDATE/DELETE/INSERT continuam
-- presos à política tenant_isolation (a aplicação nunca altera a TACO)
CREATE POLICY taco_leitura ON foods AS PERMISSIVE FOR SELECT USING (tenant_id IS NULL);
