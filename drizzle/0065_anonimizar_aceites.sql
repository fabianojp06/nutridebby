-- US-018 / RNF-08 (Plano 05, Tarefa 15): a anonimização também trata as provas de aceite do termo do paciente.
-- `consents` é append-only para a aplicação (0009: REVOKE UPDATE, DELETE de nutri_app_role) e fica fora da RLS; esta
-- função é a única porta de escrita depois do INSERT, e só para um caso: o paciente bloqueado que o job de retenção
-- (contexto `worker` do próprio tenant) está anonimizando AGORA (`anonimizado_em` ainda nulo, chamada antes do UPDATE de
-- `patients`, na mesma transação).
--   * O que fica (prova de que o termo foi aceito, e quando): versão do termo e data do aceite, ligados ao prontuário
--     já anonimizado (`tenant_id` + `patient_id`).
--   * O que sai: o IP (dado pessoal que não serve mais como prova sem titular identificável) e o vínculo com a conta
--     de login (`user_id`): o aceite da conta neste tenant passa para o prontuário (senão a conta continuaria dizendo
--     "foi paciente desta nutricionista"). Se o prontuário já tinha o aceite da mesma versão (página pública, D13),
--     fica um só, com a data mais antiga.
-- search_path fixo e nomes qualificados (mesmo endurecimento da 0012).
CREATE OR REPLACE FUNCTION app_anonimizar_aceites(p_patient uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := app_current_tenant();
  v_user uuid;
BEGIN
  IF v_tenant IS NULL OR app_current_role() IS DISTINCT FROM 'worker' THEN
    RAISE EXCEPTION 'app_anonimizar_aceites() só roda no contexto worker de um tenant' USING ERRCODE = '42501';
  END IF;
  SELECT p.user_id INTO v_user FROM public.patients p
    WHERE p.id = p_patient AND p.tenant_id = v_tenant AND p.status = 'bloqueado' AND p.anonimizado_em IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'app_anonimizar_aceites(): o paciente não está bloqueado à espera da anonimização neste tenant' USING ERRCODE = '42501';
  END IF;
  IF v_user IS NOT NULL THEN
    UPDATE public.consents o SET aceito_em = c.aceito_em
      FROM public.consents c
      WHERE o.user_id IS NULL AND o.tenant_id = v_tenant AND o.patient_id = p_patient
        AND c.user_id = v_user AND c.tenant_id = v_tenant AND c.termo_versao = o.termo_versao AND c.aceito_em < o.aceito_em;
    DELETE FROM public.consents c
      WHERE c.user_id = v_user AND c.tenant_id = v_tenant
        AND EXISTS (SELECT 1 FROM public.consents o
                    WHERE o.user_id IS NULL AND o.tenant_id = v_tenant AND o.patient_id = p_patient AND o.termo_versao = c.termo_versao);
    UPDATE public.consents SET user_id = NULL, patient_id = p_patient WHERE user_id = v_user AND tenant_id = v_tenant;
  END IF;
  UPDATE public.consents SET ip = NULL WHERE tenant_id = v_tenant AND patient_id = p_patient AND ip IS NOT NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_anonimizar_aceites(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_anonimizar_aceites(uuid) TO nutri_app_role;
