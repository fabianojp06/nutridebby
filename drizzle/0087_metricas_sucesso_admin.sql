-- P08-07 (D15): o admin vê só contagens do CS-02 e do CS-03 por tenant. Mesmo molde da admin_tenant_metrics (0059):
-- SECURITY DEFINER, entra tenant a tenant (RLS forçada), recusa rodar dentro de withTenant.
CREATE OR REPLACE FUNCTION admin_metricas_sucesso()
RETURNS TABLE (tenant_id uuid, pacientes_com_conta bigint, abriram_7_dias bigint, faltas_mes bigint, iniciadas_mes bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  t record;
  v_hoje date;
  v_inicio_mes timestamptz;
BEGIN
  IF coalesce(current_setting('app.tenant_id', true), '') <> '' THEN
    RAISE EXCEPTION 'admin_metricas_sucesso() não pode rodar dentro de withTenant' USING ERRCODE = '55000';
  END IF;
  FOR t IN SELECT tn.id, tn.fuso FROM public.tenants tn ORDER BY tn.created_at LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    PERFORM set_config('app.role', 'worker', true);
    PERFORM set_config('app.patient_id', '', true);
    v_hoje := (now() AT TIME ZONE t.fuso)::date;
    v_inicio_mes := date_trunc('month', now() AT TIME ZONE t.fuso) AT TIME ZONE t.fuso;
    tenant_id := t.id;
    SELECT count(*),
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.access_events e WHERE e.tenant_id = p.tenant_id AND e.patient_id = p.id AND e.dia >= v_hoje - 6))
      INTO pacientes_com_conta, abriram_7_dias
      FROM public.patients p
     WHERE p.tenant_id = t.id AND p.status = 'ativo' AND p.user_id IS NOT NULL AND p.anonimizado_em IS NULL;
    SELECT count(*) FILTER (WHERE a.status = 'faltou'), count(*) FILTER (WHERE a.status <> 'cancelada')
      INTO faltas_mes, iniciadas_mes
      FROM public.appointments a
     WHERE a.tenant_id = t.id AND a.inicio >= v_inicio_mes AND a.inicio <= now();
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.role', '', true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin_metricas_sucesso() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin_metricas_sucesso() TO nutri_app_role;
