-- P-16 (a) / D1 (Plano 06): a sessão de paciente não grava em tabela nenhuma, a não ser as de PACIENTE_ESCREVE
-- (src/db/rls-guard.ts), só nos comandos listados. RESTRICTIVE: soma-se (AND) às políticas de tenant/paciente.
-- Mesmo desenho do contexto `publico` (0051): negar por padrão, liberar por comando. A leitura continua com as
-- políticas de sempre (tenant_isolation, patient_isolation, staff_only, paciente_sem_rascunho).
CREATE OR REPLACE FUNCTION app_deny_paciente_escrita(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['insert', 'update', 'delete'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', 'paciente_sem_' || c, tbl);
    IF c = 'insert' THEN
      EXECUTE format('CREATE POLICY %I ON %s AS RESTRICTIVE FOR INSERT WITH CHECK (app_current_role() IS DISTINCT FROM %L)',
        'paciente_sem_' || c, tbl, 'paciente');
    ELSE
      -- Sem WITH CHECK: no UPDATE o USING vale também para a linha nova. Atenção: sem a política de UPDATE,
      -- SELECT … FOR UPDATE/SHARE da sessão de paciente não enxerga a linha (ela some do resultado).
      EXECUTE format('CREATE POLICY %I ON %s AS RESTRICTIVE FOR %s USING (app_current_role() IS DISTINCT FROM %L)',
        'paciente_sem_' || c, tbl, upper(c), 'paciente');
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- Libera à sessão de paciente só os comandos listados (as outras políticas paciente_sem_* continuam). Idempotente:
-- recria as três negações e tira só as liberadas.
CREATE OR REPLACE FUNCTION app_allow_paciente_escrita(tbl regclass, VARIADIC comandos text[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  IF NOT comandos <@ ARRAY['insert', 'update', 'delete'] THEN
    RAISE EXCEPTION 'app_allow_paciente_escrita: comando inválido em % (use insert, update, delete)', comandos;
  END IF;
  PERFORM app_deny_paciente_escrita(tbl);
  FOREACH c IN ARRAY comandos LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', 'paciente_sem_' || c, tbl);
  END LOOP;
END $$;
--> statement-breakpoint
-- Tabela nova nasce fechada também para a escrita do paciente: o mesmo corpo da 0051 + app_deny_paciente_escrita.
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
  PERFORM app_deny_paciente_escrita(tbl);
END $$;
--> statement-breakpoint
-- As tabelas que já existem (Planos 01–05) também ficam fechadas
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation' LOOP
    PERFORM app_deny_paciente_escrita(format('public.%I', t)::regclass);
  END LOOP;
END $$;
--> statement-breakpoint
-- PACIENTE_ESCREVE (o que os Planos 03 e 05 já fazem como paciente): aceite do convite e opt-in/opt-out (patients),
-- agenda pelo link e pelo WhatsApp (appointments, notifications) e a auditoria (gatilho e auditRead)
SELECT app_allow_paciente_escrita('patients', 'update');
--> statement-breakpoint
SELECT app_allow_paciente_escrita('appointments', 'insert', 'update');
--> statement-breakpoint
SELECT app_allow_paciente_escrita('notifications', 'insert', 'update');
--> statement-breakpoint
SELECT app_allow_paciente_escrita('audit_log', 'insert');
