-- M13: admin_tenant_metrics() entra em cada tenant com set_config(..., true) e, no fim, zera
-- app.tenant_id/app.role. Chamada dentro de uma transação withTenant, apagaria o contexto do
-- tenant no meio dela (as consultas seguintes veriam zero linhas pela RLS e o gatilho de
-- auditoria gravaria sem tenant). O admin nunca usa withTenant: aqui a função se recusa.
-- CREATE OR REPLACE mantém o dono e os privilégios (REVOKE de PUBLIC e GRANT da 0012).
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
    -- Plano 03 (patients) e Plano 05 (appointments, notifications) trocam estes NULL por contagens
    pacientes_ativos := NULL;
    consultas_mes := NULL;
    mensagens_whatsapp_mes := NULL;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.role', '', true);
END $$;
