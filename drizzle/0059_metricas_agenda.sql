-- §3: o admin passa a ver consultas e WhatsApps do mês (só contagens). Mesmo corpo da 0017, trocando os NULL.
-- Mês civil no fuso de cada tenant (RN-09). Variáveis com prefixo v_ (#variable_conflict use_column: "inicio" é coluna).
-- consultas_mes: não canceladas que começam no mês; mensagens_whatsapp_mes: as que contam na cota (CONTA_COTA de
-- src/modules/notificacoes/whatsapp/cota.ts — lembretes e convite; as respostas "1"/"2" não) aceitas no mês.
-- CREATE OR REPLACE mantém dono e privilégios (REVOKE de PUBLIC e GRANT da 0012).
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
  v_inicio_mes timestamptz;
  v_fim_mes timestamptz;
BEGIN
  IF coalesce(current_setting('app.tenant_id', true), '') <> '' THEN
    RAISE EXCEPTION 'admin_tenant_metrics() não pode rodar dentro de withTenant (contexto app.* de um tenant ativo)'
      USING ERRCODE = '55000';
  END IF;
  FOR t IN SELECT tn.id, tn.armazenamento_bytes AS bytes, tn.fuso FROM public.tenants tn ORDER BY tn.created_at LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    PERFORM set_config('app.role', 'worker', true);
    PERFORM set_config('app.patient_id', '', true);
    v_inicio_mes := date_trunc('month', now() AT TIME ZONE t.fuso) AT TIME ZONE t.fuso;
    v_fim_mes := (date_trunc('month', now() AT TIME ZONE t.fuso) + interval '1 month') AT TIME ZONE t.fuso;
    tenant_id := t.id;
    armazenamento_bytes := t.bytes;
    SELECT count(*) INTO arquivos FROM public.stored_files sf WHERE sf.tenant_id = t.id;
    SELECT count(*) INTO pacientes_ativos FROM public.patients p WHERE p.tenant_id = t.id AND p.status = 'ativo';
    SELECT count(*) INTO consultas_mes FROM public.appointments a
      WHERE a.tenant_id = t.id AND a.status <> 'cancelada' AND a.inicio >= v_inicio_mes AND a.inicio < v_fim_mes;
    SELECT count(*) INTO mensagens_whatsapp_mes FROM public.notifications n
      WHERE n.tenant_id = t.id AND n.canal = 'whatsapp' AND n.tipo IN ('lembrete_24h', 'lembrete_2h', 'convite_paciente')
        AND n.enviada_em >= v_inicio_mes AND n.enviada_em < v_fim_mes;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.role', '', true);
END $$;
