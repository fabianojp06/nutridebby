SELECT app_enable_tenant_rls('access_events');
--> statement-breakpoint
SELECT app_enable_patient_rls('access_events');
--> statement-breakpoint
-- D9: o próprio paciente registra o acesso do dia
SELECT app_allow_paciente_escrita('access_events', 'insert');
--> statement-breakpoint
-- D7 / contrato da Tarefa 13 do Plano 05: a inscrição é gravada (e cancelada) pela sessão do paciente
SELECT app_allow_paciente_escrita('push_subscriptions', 'insert', 'delete');
--> statement-breakpoint
-- Review Focus 4 (aparelho compartilhado): um endpoint de push pertence a UMA conta. O paciente A ativa no celular e a
-- sessão dele expira (ou ele não toca em "Sair"); B entra no mesmo navegador, que continua com a inscrição de A: sem
-- isto, os avisos de A seguem chegando no aparelho (com B logado) e B nunca ganha linha. Quem apresenta o endpoint (um
-- segredo que só o navegador do aparelho conhece) logado como paciente tira o endpoint de TODA outra conta, em qualquer
-- tenant, e fica sabendo se ele já tinha linha da própria conta (senão o cliente descarta a inscrição e mostra "Ativar
-- notificações" — B não passa a receber push sem ter pedido). A RLS é FORCE: a função entra em cada tenant
-- (set_config local à transação, como a admin_tenant_metrics da 0012) e devolve o contexto do chamador no fim.
-- Roda só ao ativar e uma vez por abertura do portal com inscrição no navegador (não a cada requisição — D2).
-- search_path fixo e nomes qualificados (mesmo endurecimento da 0012).
CREATE OR REPLACE FUNCTION app_soltar_endpoint_push(p_endpoint text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app_current_user();
  v_tenant text := current_setting('app.tenant_id', true);
  v_role text := current_setting('app.role', true);
  v_patient text := current_setting('app.patient_id', true);
  v_da_conta boolean := false;
  t record;
BEGIN
  IF v_user IS NULL OR app_current_role() IS DISTINCT FROM 'paciente' THEN
    RAISE EXCEPTION 'app_soltar_endpoint_push() só roda na sessão de um paciente' USING ERRCODE = '42501';
  END IF;
  IF p_endpoint IS NULL OR p_endpoint !~ '^https://' OR char_length(p_endpoint) > 1000 THEN
    RAISE EXCEPTION 'app_soltar_endpoint_push(): endpoint inválido' USING ERRCODE = '22023';
  END IF;
  FOR t IN SELECT tn.id FROM public.tenants tn LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    PERFORM set_config('app.role', 'worker', true);
    PERFORM set_config('app.patient_id', '', true);
    DELETE FROM public.push_subscriptions s
      WHERE s.tenant_id = t.id AND s.endpoint = p_endpoint
        AND NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.tenant_id = s.tenant_id AND p.id = s.patient_id AND p.user_id = v_user);
    v_da_conta := v_da_conta OR EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.tenant_id = t.id AND s.endpoint = p_endpoint);
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_tenant, ''), true);
  PERFORM set_config('app.role', coalesce(v_role, ''), true);
  PERFORM set_config('app.patient_id', coalesce(v_patient, ''), true);
  RETURN v_da_conta;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_soltar_endpoint_push(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_soltar_endpoint_push(text) TO nutri_app_role;
