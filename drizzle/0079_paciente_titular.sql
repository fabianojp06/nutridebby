-- US-046: o titular pede a exclusão (privacy_requests) e os próprios dados (data_exports; o pedido pendente
-- esquecido vira "falhou" — solicitarExportacao)
SELECT app_allow_paciente_escrita('privacy_requests', 'insert');
--> statement-breakpoint
SELECT app_allow_paciente_escrita('data_exports', 'insert', 'update');
--> statement-breakpoint
-- P06-08 (D18): a anonimização (job retencao-lgpd, contexto `worker` de um tenant) só anonimiza a conta de login do
-- titular se ela não tiver OUTRO vínculo não anonimizado, em qualquer tenant. A conferência é feita DENTRO da
-- transação que anonimiza (uma conexão só): trava a conta (FOR UPDATE — um vínculo novo gravado agora por outro
-- consultório pega KEY SHARE nela pela FK patients.user_id: espera este commit, ou já foi gravado e é visto) e lê os
-- prontuários da conta no contexto `conta` (política `paciente_por_conta`, 0073); devolve o contexto do chamador no
-- fim. Chamar DEPOIS do UPDATE de `patients` que solta a conta do prontuário anonimizado.
-- search_path fixo e nomes qualificados (mesmo endurecimento da 0012).
CREATE OR REPLACE FUNCTION app_conta_sem_outro_vinculo(p_user uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant text := current_setting('app.tenant_id', true);
  v_role text := current_setting('app.role', true);
  v_patient text := current_setting('app.patient_id', true);
  v_actor text := current_setting('app.user_id', true);
  v_sozinha boolean;
BEGIN
  IF app_current_tenant() IS NULL OR app_current_role() IS DISTINCT FROM 'worker' THEN
    RAISE EXCEPTION 'app_conta_sem_outro_vinculo() só roda no contexto worker de um tenant' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public."user" u WHERE u.id = p_user FOR UPDATE;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.role', 'conta', true);
  PERFORM set_config('app.patient_id', '', true);
  PERFORM set_config('app.user_id', p_user::text, true);
  v_sozinha := NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.user_id = p_user AND p.anonimizado_em IS NULL);
  PERFORM set_config('app.tenant_id', coalesce(v_tenant, ''), true);
  PERFORM set_config('app.role', coalesce(v_role, ''), true);
  PERFORM set_config('app.patient_id', coalesce(v_patient, ''), true);
  PERFORM set_config('app.user_id', coalesce(v_actor, ''), true);
  RETURN v_sozinha;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_conta_sem_outro_vinculo(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_conta_sem_outro_vinculo(uuid) TO nutri_app_role;
