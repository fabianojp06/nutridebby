-- §3 / §4.1: o admin vê só contagens por tenant e nunca consulta tabelas 🔒.
-- A RLS é FORCE (vale até para o dono da tabela), então a função entra em cada tenant
-- (set_config local à transação) e, por garantia, também filtra por tenant_id.
-- search_path fixo (mesmo endurecimento da Tarefa 4, T4-R2a): sem isso, uma sessão com
-- CREATE TEMP TABLE stored_files (nutri_app tem TEMP por padrão) desviaria a contagem para a
-- tabela temporária sem erro nenhum. Citar "public.tabela" explicitamente é defesa em profundidade.
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
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin_tenant_metrics() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin_tenant_metrics() TO nutri_app_role;
