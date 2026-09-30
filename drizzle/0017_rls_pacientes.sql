SELECT app_enable_tenant_rls('patients');
--> statement-breakpoint
-- Sessão de paciente só vê a própria linha (a coluna do titular aqui é o próprio id)
SELECT app_enable_patient_rls('patients', 'id');
--> statement-breakpoint
SELECT app_enable_audit('patients', 'patients', 'id');
--> statement-breakpoint
-- §3: o admin passa a ver o nº de pacientes ativos (só a contagem). Mesmo corpo da 0015, trocando
-- o NULL de pacientes_ativos. CREATE OR REPLACE mantém dono e privilégios (REVOKE de PUBLIC da 0012).
CREATE OR REPLACE FUNCTION admin_tenant_metrics()
RETURNS TABLE (
  tenant_id uuid,
  arquivos bigint,
  armazenamento_bytes bigint,
  pacientes_ativos bigint,
  consultas_mes bigint,
  mensagens_whatsapp_mes bigint
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  t record;
BEGIN
  IF coalesce(current_setting('app.tenant_id', true), '') <> '' THEN
    RAISE EXCEPTION 'admin_tenant_metrics() não pode rodar dentro de withTenant (contexto app.* de um tenant ativo)'
      USING ERRCODE = '55000';
  END IF;
  FOR t IN SELECT tn.id, tn.armazenamento_bytes AS bytes FROM public.tenants tn ORDER BY tn.created_at LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    PERFORM set_config('app.role', 'worker', true);
    PERFORM set_config('app.patient_id', '', true);
    tenant_id := t.id;
    armazenamento_bytes := t.bytes;
    SELECT count(*) INTO arquivos FROM public.stored_files sf WHERE sf.tenant_id = t.id;
    SELECT count(*) INTO pacientes_ativos FROM public.patients p WHERE p.tenant_id = t.id AND p.status = 'ativo';
    -- Plano 05 (appointments, notifications) troca estes NULL por contagens
    consultas_mes := NULL;
    mensagens_whatsapp_mes := NULL;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.role', '', true);
END $$;
