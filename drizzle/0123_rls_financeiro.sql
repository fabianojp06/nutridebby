-- Plano 20 (spec §9.4, RN-300, RN-303, RN-308, RN-309, RN-315, RN-316, RN-319). CLAUDE.md regras 1, 2 e 8.
-- As três tabelas são só da equipe (F-D1): staff_only, nada em PUBLICO_LIBERADO nem em PACIENTE_ESCREVE.
SELECT app_enable_tenant_rls('fin_configuracoes');
--> statement-breakpoint
SELECT app_enable_staff_only('fin_configuracoes');
--> statement-breakpoint
SELECT app_enable_tenant_rls('fin_categorias');
--> statement-breakpoint
SELECT app_enable_staff_only('fin_categorias');
--> statement-breakpoint
SELECT app_enable_tenant_rls('fin_lancamentos');
--> statement-breakpoint
SELECT app_enable_patient_rls('fin_lancamentos');
--> statement-breakpoint
SELECT app_enable_staff_only('fin_lancamentos');
--> statement-breakpoint
-- RN-319: "Criou"/"Alterou" no Histórico de acessos (entidade `financeiro`); o lançamento sem paciente grava sem paciente
SELECT app_enable_audit('fin_lancamentos', 'financeiro');
--> statement-breakpoint
-- RN-309: lançamento não se apaga (cancela-se); RN-302: a linha de configuração não se apaga (a próxima "primeira gravação"
-- semearia as categorias de novo)
REVOKE DELETE, TRUNCATE ON fin_lancamentos FROM nutri_app_role;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON fin_configuracoes FROM nutri_app_role;
--> statement-breakpoint
-- RN-303: `tipo` e `chave` não mudam; "Consultas" (chave preenchida) nunca é apagada, mesmo sem lançamento (o arquivamento
-- dela é recusado pelo CHECK fin_categorias_chave_nunca_arquivada).
CREATE OR REPLACE FUNCTION app_fin_categorias_fixas() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.chave IS NOT NULL THEN
      RAISE EXCEPTION 'a categoria "Consultas" não é excluída' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.tipo, NEW.chave) IS DISTINCT FROM (OLD.tipo, OLD.chave) THEN
    RAISE EXCEPTION 'tipo e chave da categoria não mudam' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fin_categorias_fixas BEFORE UPDATE OR DELETE ON fin_categorias FOR EACH ROW EXECUTE FUNCTION app_fin_categorias_fixas();
--> statement-breakpoint
-- RN-304, RN-308, RN-309, RN-315, RN-316 (spec §9.4). O BEFORE roda antes do WITH CHECK da RLS, então a ordem importa:
--   (1) contexto vazio ou `worker` → 42501 (no UPDATE, o worker só passa no ramo da anonimização, com o marcador local
--       app.fin_anonimizando = '1', ligado só por app_anonimizar_financeiro, e o paciente bloqueado com o prazo vencido);
--   (2) qualquer papel diferente de `nutri` → RETURN NEW SEM ler patients: paciente, publico e conta são recusados pela RLS
--       da própria tabela (paciente_sem_insert, publico_negado, tenant_isolation) — lendo o paciente antes, nesses contextos
--       ele viria vazio pela RLS e a recusa mudaria de mensagem (test/isolamento.test.ts, violaRlsDe);
--   (3) só na sessão `nutri` o gatilho lê `status, anonimizado_em` do paciente com FOR KEY SHARE (espera o FOR UPDATE de um
--       bloqueio em andamento e lê a versão nova), no INSERT e no UPDATE.
-- Autoria pelo banco: `criado_por`, `cancelado_por` e `cancelado_em` vêm da sessão e do relógio, não do módulo.
-- Comparações com IS DISTINCT FROM: o UPDATE sem mudança passa (isolamento: `set tenant_id = tenant_id`).
CREATE OR REPLACE FUNCTION app_fin_lancamentos_regras() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
  v_status text;
  v_anonimizado timestamptz;
  v_vencido boolean;
BEGIN
  IF r = '' THEN
    RAISE EXCEPTION 'lançamento do Financeiro só com o contexto de uma sessão' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF r = 'worker' THEN
      RAISE EXCEPTION 'lançamento do Financeiro só pela sessão da nutricionista' USING ERRCODE = '42501';
    END IF;
    IF r <> 'nutri' THEN
      RETURN NEW;
    END IF;
    NEW.criado_por := app_current_user();
    NEW.cancelado_em := NULL;
    NEW.cancelado_por := NULL;
    NEW.motivo_cancelamento := NULL;
    NEW.anonimizado_em := NULL;
    IF NEW.patient_id IS NOT NULL THEN
      SELECT p.status, p.anonimizado_em INTO v_status, v_anonimizado
        FROM public.patients p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.patient_id
        FOR KEY SHARE;
      IF v_status = 'bloqueado' OR v_anonimizado IS NOT NULL THEN
        RAISE EXCEPTION 'paciente bloqueado ou anonimizado: nenhum lançamento novo' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: colunas fixas para todo papel (antes do WITH CHECK da RLS: IMUTAVEIS no teste de isolamento)
  IF (NEW.id, NEW.tenant_id, NEW.tipo, NEW.patient_id, NEW.appointment_id, NEW.criado_por, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.tipo, OLD.patient_id, OLD.appointment_id, OLD.criado_por, OLD.created_at) THEN
    RAISE EXCEPTION 'coluna fixa do lançamento' USING ERRCODE = '42501';
  END IF;

  IF r = 'worker' THEN
    -- RN-316: só a anonimização, dentro de app_anonimizar_financeiro, de um lançamento ainda não anonimizado de um paciente
    -- bloqueado com o prazo de guarda vencido, mexendo só nos textos, no cancelamento e nas datas de controle. As defesas
    -- não confiam no marcador (um código do worker pode ligá-lo à mão): o prazo é conferido aqui também, o pago não vira
    -- cancelado (só os em aberto, RN-316) e o cancelamento é sem autora, na hora do banco.
    IF coalesce(current_setting('app.fin_anonimizando', true), '') <> '1'
       OR OLD.anonimizado_em IS NOT NULL OR NEW.anonimizado_em IS NULL
       OR (to_jsonb(NEW) - 'anonimizado_em' - 'descricao' - 'motivo_cancelamento' - 'cancelado_em' - 'cancelado_por' - 'updated_at')
          IS DISTINCT FROM (to_jsonb(OLD) - 'anonimizado_em' - 'descricao' - 'motivo_cancelamento' - 'cancelado_em' - 'cancelado_por' - 'updated_at')
       OR (OLD.cancelado_em IS NOT NULL AND (NEW.cancelado_em, NEW.cancelado_por) IS DISTINCT FROM (OLD.cancelado_em, OLD.cancelado_por))
       OR (OLD.cancelado_em IS NULL AND NEW.cancelado_por IS NOT NULL)
       OR (OLD.cancelado_em IS NULL AND OLD.pago_em IS NOT NULL AND NEW.cancelado_em IS NOT NULL) THEN
      RAISE EXCEPTION 'o worker só altera o lançamento na anonimização (app_anonimizar_financeiro)' USING ERRCODE = '42501';
    END IF;
    SELECT p.status, p.anonimizado_em,
           (p.anonimizar_apos IS NOT NULL AND p.anonimizar_apos < (now() AT TIME ZONE t.fuso)::date)
      INTO v_status, v_anonimizado, v_vencido
      FROM public.patients p JOIN public.tenants t ON t.id = p.tenant_id
      WHERE p.tenant_id = OLD.tenant_id AND p.id = OLD.patient_id
      FOR KEY SHARE OF p;
    IF v_status IS DISTINCT FROM 'bloqueado' OR v_anonimizado IS NOT NULL OR v_vencido IS NOT TRUE THEN
      RAISE EXCEPTION 'anonimização do Financeiro só de paciente bloqueado, ainda não anonimizado, com o prazo vencido' USING ERRCODE = '42501';
    END IF;
    -- o em aberto que a anonimização cancela: na hora do banco e sem autora (a data mandada pelo UPDATE não vale)
    IF OLD.cancelado_em IS NULL AND NEW.cancelado_em IS NOT NULL THEN
      NEW.cancelado_em := clock_timestamp();
      NEW.cancelado_por := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF r <> 'nutri' THEN
    RETURN NEW;
  END IF;

  IF to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN
    RETURN NEW;
  END IF;
  IF OLD.anonimizado_em IS NOT NULL OR OLD.cancelado_em IS NOT NULL THEN
    RAISE EXCEPTION 'lançamento cancelado ou anonimizado não muda' USING ERRCODE = '42501';
  END IF;
  IF NEW.anonimizado_em IS NOT NULL THEN
    RAISE EXCEPTION 'a anonimização do Financeiro só pela função app_anonimizar_financeiro' USING ERRCODE = '42501';
  END IF;
  -- RN-309: o cancelamento em nome da usuária da sessão, na hora do banco (o motivo é conferido pelo CHECK)
  IF NEW.cancelado_em IS NOT NULL THEN
    NEW.cancelado_em := clock_timestamp();
    NEW.cancelado_por := app_current_user();
  END IF;
  IF OLD.patient_id IS NOT NULL THEN
    SELECT p.status, p.anonimizado_em INTO v_status, v_anonimizado
      FROM public.patients p WHERE p.tenant_id = OLD.tenant_id AND p.id = OLD.patient_id
      FOR KEY SHARE;
    IF v_anonimizado IS NOT NULL THEN
      RAISE EXCEPTION 'lançamento de paciente anonimizado não muda' USING ERRCODE = '42501';
    END IF;
    -- RN-315: com o paciente bloqueado, só receber/desfazer, reduzir o valor e cancelar
    IF v_status = 'bloqueado'
       AND ((to_jsonb(NEW) - 'pago_em' - 'forma_pagamento' - 'valor_centavos' - 'cancelado_em' - 'cancelado_por' - 'motivo_cancelamento' - 'updated_at')
            IS DISTINCT FROM (to_jsonb(OLD) - 'pago_em' - 'forma_pagamento' - 'valor_centavos' - 'cancelado_em' - 'cancelado_por' - 'motivo_cancelamento' - 'updated_at')
            OR NEW.valor_centavos > OLD.valor_centavos) THEN
      RAISE EXCEPTION 'paciente bloqueado: só receber, desfazer, reduzir o valor ou cancelar' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fin_lancamentos_regras BEFORE INSERT OR UPDATE ON fin_lancamentos FOR EACH ROW EXECUTE FUNCTION app_fin_lancamentos_regras();
--> statement-breakpoint
-- RN-316 / F-D23 (molde da app_anonimizar_aceites, 0065, e do marcador da 0117): chamada por anonimizarVencidos antes do
-- UPDATE de `patients`, na mesma transação. SECURITY INVOKER: no contexto `worker`, tenant_isolation, patient_isolation,
-- staff_only e paciente_sem_* deixam passar, e o UPDATE não está revogado. Textos (descrição, motivo) saem; os em aberto viram
-- cancelados sem autora nem motivo; valor, datas, categoria, forma, tipo e o vínculo com o paciente ficam. Só de paciente
-- bloqueado, ainda não anonimizado, com o prazo de guarda já vencido (antes de hoje no fuso do consultório, como o filtro de
-- anonimizarVencidos). O marcador liga só durante o UPDATE (desligado no fim, para não valer até o fim da transação).
-- search_path fixo e nomes qualificados (defesa da tabela temporária, 0007, T4-R2a).
CREATE OR REPLACE FUNCTION app_anonimizar_financeiro(p_patient uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := app_current_tenant();
  v_agora timestamptz := clock_timestamp();
BEGIN
  IF v_tenant IS NULL OR app_current_role() IS DISTINCT FROM 'worker' THEN
    RAISE EXCEPTION 'app_anonimizar_financeiro() só roda no contexto worker de um tenant' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.patients p JOIN public.tenants t ON t.id = p.tenant_id
    WHERE p.id = p_patient AND p.tenant_id = v_tenant AND p.status = 'bloqueado' AND p.anonimizado_em IS NULL
      AND p.anonimizar_apos IS NOT NULL AND p.anonimizar_apos < (now() AT TIME ZONE t.fuso)::date
    FOR UPDATE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'app_anonimizar_financeiro(): paciente não bloqueado com o prazo vencido neste tenant' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.fin_anonimizando', '1', true);
  UPDATE public.fin_lancamentos l
     SET descricao = NULL,
         motivo_cancelamento = NULL,
         cancelado_em = CASE WHEN l.cancelado_em IS NULL AND l.pago_em IS NULL THEN v_agora ELSE l.cancelado_em END,
         anonimizado_em = v_agora,
         updated_at = v_agora
   WHERE l.tenant_id = v_tenant AND l.patient_id = p_patient AND l.anonimizado_em IS NULL;
  PERFORM set_config('app.fin_anonimizando', '', true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_anonimizar_financeiro(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_anonimizar_financeiro(uuid) TO nutri_app_role;
