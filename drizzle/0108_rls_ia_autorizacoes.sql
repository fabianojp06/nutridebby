-- Plano 14A (spec da IA v0.5.1 §11, RN-107, RNF-102, RNF-110, RNF-111). CLAUDE.md regras 2 e 8.
SELECT app_enable_tenant_rls('ia_autorizacoes');
--> statement-breakpoint
SELECT app_enable_patient_rls('ia_autorizacoes');
--> statement-breakpoint
-- RNF-102: sem staff_only (o paciente lê as próprias linhas, na tela "Eu › Privacidade"). A escrita do paciente é só INSERT
-- da PRÓPRIA autorização ou retirada: no app, com a própria conta; no link (paciente sem conta, N7), sem conta nenhuma.
-- Nunca o pedido por e-mail nem os canais da equipe (RNF-111 d); em = registrado_em (j; o gatilho já grava assim).
SELECT app_allow_paciente_escrita('ia_autorizacoes', 'insert');
--> statement-breakpoint
CREATE POLICY paciente_autorizacao_propria ON ia_autorizacoes AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR (
    evento IN ('autorizou', 'retirou') AND em = registrado_em AND (
      (canal = 'app' AND registrado_por IS NOT NULL AND registrado_por = app_current_user())
      OR (canal = 'link' AND registrado_por IS NULL AND app_current_user() IS NULL))));
--> statement-breakpoint
-- RNF-110 / §5.11 item 8 (revisão de banco da v0.5, I1): prova só de inclusão; nenhum papel do app tem UPDATE legítimo.
REVOKE UPDATE, DELETE, TRUNCATE ON ia_autorizacoes FROM nutri_app_role;
--> statement-breakpoint
-- RN-107 (I2, I5) e defesa a mais (desvio 4 do plano): registrado_em pelo relógio do banco DEPOIS da trava do paciente;
-- fora do papel, o ato é o registro; papel exige o arquivo; quem registrou é obrigatório onde há sessão de login; o link
-- exige o HMAC do e-mail na autorização e no pedido; a sessão nutri só grava papel, nutricionista e pedido_email, em nome
-- da própria usuária; o worker não grava evento. A sessão de paciente fica com a política acima (recusa = erro de RLS).
-- No contexto vazio (migration, seed) só valem as regras de dado. Recusa com 42501, como a RLS.
CREATE OR REPLACE FUNCTION app_ia_autorizacoes_regras() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
BEGIN
  NEW.registrado_em := clock_timestamp();
  IF NEW.canal <> 'papel' THEN
    NEW.em := NEW.registrado_em;
  END IF;
  IF r = 'worker' THEN
    RAISE EXCEPTION 'o worker não registra autorização de IA' USING ERRCODE = '42501';
  END IF;
  IF r = 'nutri' THEN
    IF NOT (NEW.canal IN ('papel', 'nutricionista') OR NEW.evento = 'pedido_email') THEN
      RAISE EXCEPTION 'a equipe não registra autorização pelo app nem pelo link' USING ERRCODE = '42501';
    END IF;
    IF NEW.registrado_por IS DISTINCT FROM app_current_user() THEN
      RAISE EXCEPTION 'quem registrou é a usuária da sessão' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.canal = 'papel' AND NEW.arquivo_path IS NULL THEN
    RAISE EXCEPTION 'termo em papel sem o arquivo' USING ERRCODE = '42501';
  END IF;
  IF (NEW.canal IN ('app', 'papel', 'nutricionista') OR NEW.evento = 'pedido_email') AND NEW.registrado_por IS NULL THEN
    RAISE EXCEPTION 'autorização de IA sem quem registrou' USING ERRCODE = '42501';
  END IF;
  IF NEW.canal = 'link' AND NEW.evento IN ('autorizou', 'pedido_email') AND NEW.email_hmac IS NULL THEN
    RAISE EXCEPTION 'evento pelo link sem o e-mail (HMAC)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ia_autorizacoes_regras BEFORE INSERT ON ia_autorizacoes FOR EACH ROW EXECUTE FUNCTION app_ia_autorizacoes_regras();
--> statement-breakpoint
-- US-113 / I4: o ponteiro do termo em papel sai no naMesmaTransacao do apagarArquivo do termo (lgpd.ts,
-- apagarTermosDeAutorizacao), só no contexto worker e com o titular bloqueado ou anonimizado (molde do
-- exam_submissions_sem_apagar, 0102). Devolve se anulou. SECURITY DEFINER: o UPDATE foi revogado de nutri_app_role.
CREATE OR REPLACE FUNCTION app_ia_autorizacao_soltar_termo(p_autorizacao uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := app_current_tenant();
BEGIN
  IF v_tenant IS NULL OR app_current_role() IS DISTINCT FROM 'worker' THEN
    RAISE EXCEPTION 'app_ia_autorizacao_soltar_termo() só roda no contexto worker de um tenant' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ia_autorizacoes a SET arquivo_path = NULL
   WHERE a.id = p_autorizacao AND a.tenant_id = v_tenant AND a.arquivo_path IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.patients p
                  WHERE p.tenant_id = a.tenant_id AND p.id = a.patient_id AND (p.status = 'bloqueado' OR p.anonimizado_em IS NOT NULL));
  RETURN FOUND;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_ia_autorizacao_soltar_termo(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_ia_autorizacao_soltar_termo(uuid) TO nutri_app_role;
--> statement-breakpoint
-- US-113 / I3: na anonimização (lgpd.ts, ao lado da app_anonimizar_aceites e com a mesma condição da 0065: worker, paciente
-- do tenant bloqueado à espera, anonimizado_em nulo), as linhas ficam sem IP, user-agent e HMAC do e-mail e, SÓ no canal
-- app, sem a conta do titular; evento, versão, usos, destino, canal e datas ficam (prova de que houve consentimento).
CREATE OR REPLACE FUNCTION app_anonimizar_autorizacoes_ia(p_patient uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := app_current_tenant();
BEGIN
  IF v_tenant IS NULL OR app_current_role() IS DISTINCT FROM 'worker' THEN
    RAISE EXCEPTION 'app_anonimizar_autorizacoes_ia() só roda no contexto worker de um tenant' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.patients p
    WHERE p.id = p_patient AND p.tenant_id = v_tenant AND p.status = 'bloqueado' AND p.anonimizado_em IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'app_anonimizar_autorizacoes_ia(): o paciente não está bloqueado à espera da anonimização neste tenant' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ia_autorizacoes
     SET ip = NULL, user_agent = NULL, email_hmac = NULL,
         registrado_por = CASE WHEN canal = 'app' THEN NULL ELSE registrado_por END
   WHERE tenant_id = v_tenant AND patient_id = p_patient
     AND (ip IS NOT NULL OR user_agent IS NOT NULL OR email_hmac IS NOT NULL OR (canal = 'app' AND registrado_por IS NOT NULL));
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_anonimizar_autorizacoes_ia(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_anonimizar_autorizacoes_ia(uuid) TO nutri_app_role;
--> statement-breakpoint
-- RN-109: app_ia_tarefas_imutavel (0100) + o destino: depois de gravado no portão do envio, não muda nem volta a nulo
-- (é o que a exportação do titular mostra). O resto é o da 0100, linha a linha.
CREATE OR REPLACE FUNCTION app_ia_tarefas_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.tipo, NEW.pedido_por, NEW.modelo, NEW.prompt_versao, NEW.criado_em)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.tipo, OLD.pedido_por, OLD.modelo, OLD.prompt_versao, OLD.criado_em) THEN
    RAISE EXCEPTION 'coluna fixa da tarefa de IA' USING ERRCODE = '42501';
  END IF;
  IF NEW.exam_id IS NOT NULL AND NEW.exam_id IS DISTINCT FROM OLD.exam_id THEN
    RAISE EXCEPTION 'a tarefa de IA não muda de exame' USING ERRCODE = '42501';
  END IF;
  IF OLD.saiu_em IS NOT NULL AND NEW.saiu_em IS DISTINCT FROM OLD.saiu_em THEN
    RAISE EXCEPTION 'a saída do laudo ao provedor não é apagada nem reescrita' USING ERRCODE = '42501';
  END IF;
  IF OLD.destino IS NOT NULL AND NEW.destino IS DISTINCT FROM OLD.destino THEN
    RAISE EXCEPTION 'o destino da saída ao provedor não muda' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
