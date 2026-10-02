-- D11: o contexto `publico` (páginas sem login) não toca tabela nenhuma, a não ser as de PUBLICO_LIBERADO
-- (src/db/rls-guard.ts), só nos comandos listados. RESTRICTIVE: soma-se (AND) às políticas de tenant/paciente.
CREATE OR REPLACE FUNCTION app_deny_publico(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['select', 'insert', 'update', 'delete'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', 'publico_sem_' || c, tbl);
  END LOOP;
  EXECUTE format('DROP POLICY IF EXISTS publico_negado ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY publico_negado ON %s AS RESTRICTIVE FOR ALL '
    'USING (app_current_role() IS DISTINCT FROM %L) WITH CHECK (app_current_role() IS DISTINCT FROM %L)',
    tbl, 'publico', 'publico');
END $$;
--> statement-breakpoint
-- Libera ao `publico` só os comandos listados: uma política RESTRICTIVE por comando que continua negado.
-- (SELECT … FOR UPDATE/SHARE também exige 'update'; INSERT … RETURNING/ON CONFLICT exige 'select'.)
CREATE OR REPLACE FUNCTION app_allow_publico(tbl regclass, VARIADIC comandos text[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  IF NOT comandos <@ ARRAY['select', 'insert', 'update', 'delete'] THEN
    RAISE EXCEPTION 'app_allow_publico: comando inválido em % (use select, insert, update, delete)', comandos;
  END IF;
  EXECUTE format('DROP POLICY IF EXISTS publico_negado ON %s', tbl);
  FOREACH c IN ARRAY ARRAY['select', 'insert', 'update', 'delete'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', 'publico_sem_' || c, tbl);
    CONTINUE WHEN c = ANY (comandos);
    IF c = 'insert' THEN
      EXECUTE format('CREATE POLICY %I ON %s AS RESTRICTIVE FOR INSERT WITH CHECK (app_current_role() IS DISTINCT FROM %L)',
        'publico_sem_' || c, tbl, 'publico');
    ELSE
      EXECUTE format('CREATE POLICY %I ON %s AS RESTRICTIVE FOR %s USING (app_current_role() IS DISTINCT FROM %L)',
        'publico_sem_' || c, tbl, upper(c), 'publico');
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- Tabela nova nasce fechada para o `publico`: o mesmo corpo da 0000 + app_deny_publico no fim.
CREATE OR REPLACE FUNCTION app_enable_tenant_rls(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s AS PERMISSIVE FOR ALL '
    'USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', tbl);
  PERFORM app_deny_publico(tbl);
END $$;
--> statement-breakpoint
-- As tabelas que já existem (Planos 01–04 e Tarefa 2) também ficam fechadas
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation' LOOP
    PERFORM app_deny_publico(format('public.%I', t)::regclass);
  END LOOP;
END $$;
--> statement-breakpoint
-- PUBLICO_LIBERADO: horários livres (Tarefa 3), dono do link da consulta (Tarefa 7) e página pública (Tarefa 8)
SELECT app_allow_publico('availability_rules', 'select');
--> statement-breakpoint
SELECT app_allow_publico('availability_blocks', 'select');
--> statement-breakpoint
SELECT app_allow_publico('patients', 'select', 'insert');
--> statement-breakpoint
SELECT app_allow_publico('audit_log', 'insert');
--> statement-breakpoint
SELECT app_enable_tenant_rls('appointments');
--> statement-breakpoint
SELECT app_enable_patient_rls('appointments');
--> statement-breakpoint
-- D10: dado de saúde adjacente — criar, alterar e cancelar vão para o "Histórico de acessos" do paciente
SELECT app_enable_audit('appointments', 'agenda');
--> statement-breakpoint
SELECT app_allow_publico('appointments', 'select', 'insert');
--> statement-breakpoint
-- D9 / RN-03: duas consultas não canceladas do mesmo tenant nunca se sobrepõem. A restrição vale acima da
-- RLS: a corrida entre dois pacientes (que não se veem) é decidida aqui. O "=" do uuid no GiST vem do
-- btree_gist (migration 0000). '[)': terminar às 10:00 e começar às 10:00 não é sobreposição.
ALTER TABLE appointments ADD CONSTRAINT appointments_sem_sobreposicao
  EXCLUDE USING gist (tenant_id WITH =, tstzrange(inicio, fim, '[)') WITH &&) WHERE (status <> 'cancelada');
