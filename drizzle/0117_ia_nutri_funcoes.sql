-- Plano 15 (spec F3-02 v0.4 §4.2, RN-178, RN-179, RN-182, §13.3, D22, D30, D32). Funções SECURITY DEFINER: dona = role de
-- migração; search_path fixo; nomes qualificados. Nenhuma toca pgboss.* ou ia_gasto_plataforma nem grava em ia_uso (regra 1,
-- D30; só admin_metricas_ia_nutri LÊ ia_uso, como a 0099): o job `ia-paciente` e o `ia-nutri-revogacao` são enfileirados
-- pelo módulo TS na mesma transação. A troca de papel é a da 0083 (só nas três que gravam por um paciente):
-- `app.role` vira `worker` (e `app.patient_id` vazio) SÓ dentro da função e volta antes do único RETURN; o ator da auditoria
-- continua a conta do paciente (`app.user_id` não muda).

-- O versaoAtende de textos-legais.ts: só a parte numérica, campo a campo (falta = 0); fora do formato não atende. Campos em
-- numeric (não int): uma versão com campo enorme (a coluna aceita até 40 caracteres) compara em vez de estourar (22003).
CREATE OR REPLACE FUNCTION app_versao_atende(p_versao text, p_minima text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  va text := substring(coalesce(p_versao, '') from '^[0-9]+(?:\.[0-9]+)*');
  vb text := substring(coalesce(p_minima, '') from '^[0-9]+(?:\.[0-9]+)*');
  a numeric[];
  b numeric[];
  x numeric;
  y numeric;
BEGIN
  IF va IS NULL OR vb IS NULL THEN
    RETURN false;
  END IF;
  a := string_to_array(va, '.')::numeric[];
  b := string_to_array(vb, '.')::numeric[];
  FOR i IN 1 .. greatest(cardinality(a), cardinality(b)) LOOP
    x := coalesce(a[i], 0);
    y := coalesce(b[i], 0);
    IF x <> y THEN
      RETURN x > y;
    END IF;
  END LOOP;
  RETURN true;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_versao_atende(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_versao_atende(text, text) TO nutri_app_role;
--> statement-breakpoint
-- RN-179: a pergunta. Tenant, paciente e conta vêm do CONTEXTO da sessão (nunca de parâmetro). A parte do consultório da
-- RN-170 (IA da plataforma, retenção, aditivo ≥ 1.2, ativação, pausa, IA_NUTRI_DESLIGADA) é conferida pelo módulo antes;
-- versão mínima e destino em uso chegam do servidor (configIA + constante), nunca do cliente. Ordem: trava o paciente →
-- liberação → último evento do consentimento → (risco: grava e devolve) → plano publicado → uma por vez → limites → grava.
CREATE OR REPLACE FUNCTION app_ia_nutri_perguntar(p_texto text, p_risco text, p_texto_fixo text, p_versao_min text, p_destino text)
RETURNS TABLE (codigo text, mensagem_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := current_setting('app.role', true);
  v_patient_txt text := current_setting('app.patient_id', true);
  v_tenant uuid := public.app_current_tenant();
  v_user uuid := public.app_current_user();
  v_patient uuid;
  v_agora timestamptz;
  v_fuso text;
  v_status text;
  v_anon timestamptz;
  v_evento text;
  v_versao text;
  v_destino text;
  v_ultima_em timestamptz;
  v_ultima_sessao timestamptz;
  v_sessao timestamptz;
  v_dia timestamptz;
  v_mes timestamptz;
  v_hoje int;
  v_no_mes int;
  v_codigo text;
  v_id uuid;
BEGIN
  IF v_role IS DISTINCT FROM 'paciente' OR nullif(v_patient_txt, '') IS NULL OR v_tenant IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'app_ia_nutri_perguntar() só roda na sessão de paciente com conta' USING ERRCODE = '42501';
  END IF;
  IF p_texto IS NULL OR char_length(btrim(p_texto)) NOT BETWEEN 1 AND 500 OR char_length(p_texto) > 500 THEN
    RAISE EXCEPTION 'pergunta fora do tamanho' USING ERRCODE = '22023';
  END IF;
  -- coalesce: com um dos dois nulo, a comparação dá NULL (nem verdadeiro nem falso) e o IF NOT NULL não recusaria
  IF NOT coalesce((p_risco IS NULL AND p_texto_fixo IS NULL)
          OR (p_risco = 'emergencia' AND p_texto_fixo IN ('risco_emergencia', 'sintoma_agudo'))
          OR (p_risco = 'transtorno_alimentar' AND p_texto_fixo = 'risco_transtorno'), false) THEN
    RAISE EXCEPTION 'risco e texto fixo não combinam' USING ERRCODE = '22023';
  END IF;
  v_patient := v_patient_txt::uuid;
  PERFORM set_config('app.role', 'worker', true);
  PERFORM set_config('app.patient_id', '', true);

  SELECT p.status, p.anonimizado_em INTO v_status, v_anon
    FROM public.patients p WHERE p.tenant_id = v_tenant AND p.id = v_patient FOR UPDATE;
  v_agora := clock_timestamp(); -- depois da trava: a ordem com a revogação é a ordem real (RN-170)
  SELECT t.fuso INTO v_fuso FROM public.tenants t WHERE t.id = v_tenant;
  SELECT c.evento, c.versao, c.destino INTO v_evento, v_versao, v_destino
    FROM public.ia_nutri_consentimentos c WHERE c.tenant_id = v_tenant AND c.patient_id = v_patient
    ORDER BY c.registrado_em DESC, c.id DESC LIMIT 1;

  IF v_status IS DISTINCT FROM 'ativo' OR v_anon IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM public.ia_nutri_participacoes x
                     WHERE x.tenant_id = v_tenant AND x.patient_id = v_patient AND x.liberada_em IS NOT NULL AND x.bloqueada_em IS NULL)
     OR v_evento IS DISTINCT FROM 'aceite' OR NOT public.app_versao_atende(v_versao, p_versao_min) OR v_destino IS DISTINCT FROM p_destino THEN
    v_codigo := 'indisponivel';
  END IF;

  IF v_codigo IS NULL THEN
    SELECT m.created_at, m.sessao_inicio INTO v_ultima_em, v_ultima_sessao
      FROM public.ia_nutri_mensagens m WHERE m.tenant_id = v_tenant AND m.patient_id = v_patient
      ORDER BY m.created_at DESC LIMIT 1;
    v_sessao := CASE WHEN v_ultima_em > v_agora - interval '30 minutes' THEN v_ultima_sessao ELSE v_agora END;
    v_dia := date_trunc('day', v_agora AT TIME ZONE v_fuso) AT TIME ZONE v_fuso;
    v_mes := date_trunc('month', v_agora AT TIME ZONE v_fuso) AT TIME ZONE v_fuso;
  END IF;

  IF v_codigo IS NULL AND p_risco IS NOT NULL THEN
    -- RN-174 / RN-178: grava a pergunta com risco (na fila, até 10 por dia) e o texto fixo do grupo; sem job, sem limite, sem
    -- cota. Acima de 50 gravadas no dia (LIMITE_RISCO_GRAVADO_DIA), devolve `risco` sem gravar: a tela mostra o texto fixo
    -- pelo código que o módulo devolve, e nenhuma linha ou job a mais nasce de um paciente que repete o texto.
    -- /code-review do PR #37: a gravada FORA da fila (já 10 na fila hoje) não foi ao consultório — o texto de transtorno
    -- ("Sua mensagem foi enviada ao consultório") seria falso; vai o de emergência (188 e 192, sem prometer envio). O módulo
    -- devolve à tela o texto fixo que ficou gravado aqui.
    SELECT count(*) FILTER (WHERE m.encaminhada_em IS NOT NULL), count(*) INTO v_hoje, v_no_mes
      FROM public.ia_nutri_mensagens m
     WHERE m.tenant_id = v_tenant AND m.patient_id = v_patient AND m.autor = 'paciente' AND m.risco IS NOT NULL
       AND m.created_at >= v_dia;
    IF v_no_mes < 50 THEN
      INSERT INTO public.ia_nutri_mensagens (tenant_id, patient_id, sessao_inicio, autor, texto, status, risco, encaminhada_em, contou_no_limite, expira_em, created_at, updated_at)
        VALUES (v_tenant, v_patient, v_sessao, 'paciente', p_texto, 'respondida', p_risco, CASE WHEN v_hoje < 10 THEN v_agora END, false, v_agora + interval '180 days', v_agora, v_agora)
        RETURNING id INTO v_id;
      INSERT INTO public.ia_nutri_mensagens (tenant_id, patient_id, sessao_inicio, autor, texto_fixo, responde_a, expira_em, created_at, updated_at)
        VALUES (v_tenant, v_patient, v_sessao, 'sistema',
                CASE WHEN v_hoje >= 10 AND p_texto_fixo = 'risco_transtorno' THEN 'risco_emergencia' ELSE p_texto_fixo END,
                v_id, v_agora + interval '180 days', v_agora, v_agora);
    END IF;
    v_codigo := 'risco';
  ELSIF v_codigo IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.meal_plans mp WHERE mp.tenant_id = v_tenant AND mp.patient_id = v_patient AND mp.status = 'publicado') THEN
      v_codigo := 'sem_plano';
    ELSE
      -- RN-178: a presa há mais de 3 min (45 s × 2 tentativas) vira falhou SÓ pelo tempo (a função não lê pgboss.job);
      -- a reserva dela (se houve) é conciliada pela varredura expirar-ia-paciente. /code-review do PR #37: com a resposta
      -- `ia` de texto fixo `falha` (motivo `interrompida`), como a varredura grava — a varredura só olha na_fila/processando
      -- e nunca voltaria a esta pergunta; sem a resposta, o paciente não leria "Não consegui responder agora…"
      WITH presas AS (
        UPDATE public.ia_nutri_mensagens m SET status = 'falhou', motivo_tecnico = 'interrompida', updated_at = v_agora
         WHERE m.tenant_id = v_tenant AND m.patient_id = v_patient AND m.status IN ('na_fila', 'processando') AND m.created_at <= v_agora - interval '3 minutes'
        RETURNING m.id, m.sessao_inicio, m.modelo, m.prompt_versao, m.expira_em
      )
      INSERT INTO public.ia_nutri_mensagens (tenant_id, patient_id, sessao_inicio, autor, texto_fixo, motivo_tecnico, responde_a, modelo, prompt_versao, expira_em, created_at, updated_at)
        SELECT v_tenant, v_patient, x.sessao_inicio, 'ia', 'falha', 'interrompida', x.id, x.modelo, x.prompt_versao, x.expira_em, v_agora, v_agora FROM presas x;
      IF EXISTS (SELECT 1 FROM public.ia_nutri_mensagens m WHERE m.tenant_id = v_tenant AND m.patient_id = v_patient AND m.status IN ('na_fila', 'processando')) THEN
        v_codigo := 'em_andamento';
      ELSE
        SELECT count(*) FILTER (WHERE m.created_at >= v_dia), count(*) INTO v_hoje, v_no_mes
          FROM public.ia_nutri_mensagens m
         WHERE m.tenant_id = v_tenant AND m.patient_id = v_patient AND m.autor = 'paciente' AND m.contou_no_limite AND m.created_at >= v_mes;
        IF v_hoje >= 10 THEN
          v_codigo := 'limite_dia';
        ELSIF v_no_mes >= 100 THEN
          v_codigo := 'limite_mes';
        ELSE
          INSERT INTO public.ia_nutri_mensagens (tenant_id, patient_id, sessao_inicio, autor, texto, status, contou_no_limite, expira_em, created_at, updated_at)
            VALUES (v_tenant, v_patient, v_sessao, 'paciente', p_texto, 'na_fila', true, v_agora + interval '180 days', v_agora, v_agora)
            RETURNING id INTO v_id;
          v_codigo := 'ok';
        END IF;
      END IF;
    END IF;
  END IF;

  PERFORM set_config('app.role', v_role, true);
  PERFORM set_config('app.patient_id', v_patient_txt, true);
  codigo := v_codigo;
  mensagem_id := v_id;
  RETURN NEXT;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_ia_nutri_perguntar(text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_ia_nutri_perguntar(text, text, text, text, text) TO nutri_app_role;
--> statement-breakpoint
-- DP-16 / §7.5 / RN-178: "Enviar para minha nutricionista" direto do formulário — a pergunta já encaminhada, sem resposta,
-- sem job e sem contar no limite (vale com limite_dia, limite_mes e cota esgotada). Mesma parte do paciente da RN-170 que
-- app_ia_nutri_perguntar (liberação, consentimento vigente, paciente ativo); até 3 dúvidas abertas sem risco (RN-177).
-- Texto com sinal de risco NÃO vem aqui (o módulo usa o ramo de risco de app_ia_nutri_perguntar). Mesma troca de papel.
CREATE OR REPLACE FUNCTION app_ia_nutri_enviar_a_nutri(p_texto text, p_versao_min text, p_destino text)
RETURNS TABLE (codigo text, mensagem_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := current_setting('app.role', true);
  v_patient_txt text := current_setting('app.patient_id', true);
  v_tenant uuid := public.app_current_tenant();
  v_user uuid := public.app_current_user();
  v_patient uuid;
  v_agora timestamptz;
  v_status text;
  v_anon timestamptz;
  v_evento text;
  v_versao text;
  v_destino text;
  v_ultima_em timestamptz;
  v_ultima_sessao timestamptz;
  v_sessao timestamptz;
  v_abertas int;
  v_codigo text;
  v_id uuid;
BEGIN
  IF v_role IS DISTINCT FROM 'paciente' OR nullif(v_patient_txt, '') IS NULL OR v_tenant IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'app_ia_nutri_enviar_a_nutri() só roda na sessão de paciente com conta' USING ERRCODE = '42501';
  END IF;
  IF p_texto IS NULL OR char_length(btrim(p_texto)) NOT BETWEEN 1 AND 500 OR char_length(p_texto) > 500 THEN
    RAISE EXCEPTION 'pergunta fora do tamanho' USING ERRCODE = '22023';
  END IF;
  v_patient := v_patient_txt::uuid;
  PERFORM set_config('app.role', 'worker', true);
  PERFORM set_config('app.patient_id', '', true);

  SELECT p.status, p.anonimizado_em INTO v_status, v_anon
    FROM public.patients p WHERE p.tenant_id = v_tenant AND p.id = v_patient FOR UPDATE;
  v_agora := clock_timestamp();
  SELECT c.evento, c.versao, c.destino INTO v_evento, v_versao, v_destino
    FROM public.ia_nutri_consentimentos c WHERE c.tenant_id = v_tenant AND c.patient_id = v_patient
    ORDER BY c.registrado_em DESC, c.id DESC LIMIT 1;
  IF v_status IS DISTINCT FROM 'ativo' OR v_anon IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM public.ia_nutri_participacoes x
                     WHERE x.tenant_id = v_tenant AND x.patient_id = v_patient AND x.liberada_em IS NOT NULL AND x.bloqueada_em IS NULL)
     OR v_evento IS DISTINCT FROM 'aceite' OR NOT public.app_versao_atende(v_versao, p_versao_min) OR v_destino IS DISTINCT FROM p_destino THEN
    v_codigo := 'indisponivel';
  ELSE
    SELECT count(*) INTO v_abertas FROM public.ia_nutri_mensagens m
     WHERE m.tenant_id = v_tenant AND m.patient_id = v_patient AND m.encaminhada_em IS NOT NULL AND m.resolvida_em IS NULL AND m.risco IS NULL;
    IF v_abertas >= 3 THEN
      v_codigo := 'limite';
    ELSE
      SELECT m.created_at, m.sessao_inicio INTO v_ultima_em, v_ultima_sessao
        FROM public.ia_nutri_mensagens m WHERE m.tenant_id = v_tenant AND m.patient_id = v_patient
        ORDER BY m.created_at DESC LIMIT 1;
      v_sessao := CASE WHEN v_ultima_em > v_agora - interval '30 minutes' THEN v_ultima_sessao ELSE v_agora END;
      INSERT INTO public.ia_nutri_mensagens (tenant_id, patient_id, sessao_inicio, autor, texto, status, encaminhada_em, contou_no_limite, expira_em, created_at, updated_at)
        VALUES (v_tenant, v_patient, v_sessao, 'paciente', p_texto, 'respondida', v_agora, false, v_agora + interval '180 days', v_agora, v_agora)
        RETURNING id INTO v_id;
      v_codigo := 'encaminhada';
    END IF;
  END IF;

  PERFORM set_config('app.role', v_role, true);
  PERFORM set_config('app.patient_id', v_patient_txt, true);
  codigo := v_codigo;
  mensagem_id := v_id;
  RETURN NEXT;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_ia_nutri_enviar_a_nutri(text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_ia_nutri_enviar_a_nutri(text, text, text) TO nutri_app_role;
--> statement-breakpoint
-- RN-182 / D22 / D32: a revogação. Pelo paciente (sessão de paciente com conta, `p_patient` nulo, canal `app`) ou, a pedido
-- dele, pela nutricionista (sessão `nutri`, `p_patient` do paciente do tenant em qualquer situação, canal `nutricionista`,
-- registrado_por = a usuária da sessão — DP-17, LGPD art. 8º, § 5º). O evento `revogacao` com o marcador local que o
-- gatilho de ia_nutri_consentimentos exige; perguntas na_fila e processando → cancelada (sem estorno aqui: o job
-- ia-nutri-revogacao, enfileirado pelo módulo, estorna pelo cota.ts); a pergunta com risco que a nutricionista ainda não
-- abriu fica com o texto até ela abrir ou no máximo 30 dias; o resto perde o conteúdo e fica como esqueleto até o fim do mês
-- (os limites contam).
CREATE OR REPLACE FUNCTION app_ia_nutri_revogar(p_ip text, p_user_agent text, p_patient uuid DEFAULT NULL)
RETURNS TABLE (revogacao_id uuid, canceladas int)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := current_setting('app.role', true);
  v_patient_txt text := current_setting('app.patient_id', true);
  v_tenant uuid := public.app_current_tenant();
  v_user uuid := public.app_current_user();
  v_patient uuid;
  v_canal text;
  v_agora timestamptz;
  v_fuso text;
  v_fim_mes timestamptz;
  v_evento text;
  v_rev uuid;
  v_n int := 0;
BEGIN
  IF v_tenant IS NULL OR v_user IS NULL
     OR NOT coalesce((v_role = 'paciente' AND nullif(v_patient_txt, '') IS NOT NULL AND p_patient IS NULL)
                     OR (v_role = 'nutri' AND p_patient IS NOT NULL), false) THEN -- app.role nunca definido: NULL não passa
    RAISE EXCEPTION 'app_ia_nutri_revogar() só roda na sessão de paciente com conta ou, com o paciente, na sessão da nutricionista' USING ERRCODE = '42501';
  END IF;
  v_patient := coalesce(p_patient, nullif(v_patient_txt, '')::uuid);
  v_canal := CASE WHEN v_role = 'nutri' THEN 'nutricionista' ELSE 'app' END;
  PERFORM set_config('app.role', 'worker', true);
  PERFORM set_config('app.patient_id', '', true);

  PERFORM 1 FROM public.patients p WHERE p.tenant_id = v_tenant AND p.id = v_patient FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'app_ia_nutri_revogar(): paciente fora deste tenant' USING ERRCODE = '42501';
  END IF;
  v_agora := clock_timestamp();
  SELECT t.fuso INTO v_fuso FROM public.tenants t WHERE t.id = v_tenant;
  v_fim_mes := (date_trunc('month', v_agora AT TIME ZONE v_fuso) + interval '1 month') AT TIME ZONE v_fuso;
  SELECT c.evento INTO v_evento FROM public.ia_nutri_consentimentos c
   WHERE c.tenant_id = v_tenant AND c.patient_id = v_patient ORDER BY c.registrado_em DESC, c.id DESC LIMIT 1;

  IF v_evento = 'aceite' THEN
    PERFORM set_config('app.ia_nutri_revogando', '1', true);
    INSERT INTO public.ia_nutri_consentimentos (tenant_id, patient_id, evento, canal, registrado_por, ip, user_agent)
      VALUES (v_tenant, v_patient, 'revogacao', v_canal, v_user, left(p_ip, 45), left(p_user_agent, 300))
      RETURNING id INTO v_rev;
    PERFORM set_config('app.ia_nutri_revogando', '', true);
    UPDATE public.ia_nutri_mensagens m SET status = 'cancelada', updated_at = v_agora
     WHERE m.tenant_id = v_tenant AND m.patient_id = v_patient AND m.status IN ('na_fila', 'processando');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    -- D22: guardada com o texto até ela abrir, no máximo 30 dias
    UPDATE public.ia_nutri_mensagens m SET revogada_em = v_agora, expira_em = least(m.expira_em, v_agora + interval '30 days'), updated_at = v_agora
     WHERE m.tenant_id = v_tenant AND m.patient_id = v_patient AND m.autor = 'paciente' AND m.risco IS NOT NULL
       AND m.encaminhada_em IS NOT NULL AND m.aberta_pela_nutri_em IS NULL AND m.resolvida_em IS NULL AND m.texto IS NOT NULL;
    -- D32: o resto vira esqueleto (autor, data, situação, contou_no_limite) até o fim do mês (least: nunca estende a guarda
    -- de quem já vencia antes, como o esqueleto de uma revogação anterior); dúvidas abertas encerradas
    UPDATE public.ia_nutri_mensagens m
       SET texto = NULL, texto_fixo = NULL, categoria = NULL, fontes = NULL, risco = NULL, tipo_resposta = NULL, motivo_tecnico = NULL,
           resolvida_em = coalesce(m.resolvida_em, CASE WHEN m.encaminhada_em IS NOT NULL THEN v_agora END),
           resolucao = coalesce(m.resolucao, CASE WHEN m.encaminhada_em IS NOT NULL THEN 'encerrada' END),
           revogada_em = coalesce(m.revogada_em, v_agora), expira_em = least(m.expira_em, v_fim_mes), updated_at = v_agora
     WHERE m.tenant_id = v_tenant AND m.patient_id = v_patient
       AND NOT (m.autor = 'paciente' AND m.risco IS NOT NULL AND m.encaminhada_em IS NOT NULL AND m.aberta_pela_nutri_em IS NULL
                AND m.resolvida_em IS NULL AND m.texto IS NOT NULL);
  END IF;

  PERFORM set_config('app.role', v_role, true);
  PERFORM set_config('app.patient_id', coalesce(v_patient_txt, ''), true);
  revogacao_id := v_rev;
  canceladas := v_n;
  RETURN NEXT;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_ia_nutri_revogar(text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_ia_nutri_revogar(text, text, uuid) TO nutri_app_role;
--> statement-breakpoint
-- §13.3 (molde de app_anonimizar_autorizacoes_ia, 0108): na anonimização, sem IP, user-agent e conta; evento, versão,
-- destino, canal e data ficam (prova de que houve consentimento). Só no worker, com o paciente bloqueado à espera.
CREATE OR REPLACE FUNCTION app_anonimizar_consentimentos_ia_nutri(p_patient uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.app_current_tenant();
BEGIN
  IF v_tenant IS NULL OR public.app_current_role() IS DISTINCT FROM 'worker' THEN
    RAISE EXCEPTION 'app_anonimizar_consentimentos_ia_nutri() só roda no contexto worker de um tenant' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.patients p
    WHERE p.id = p_patient AND p.tenant_id = v_tenant AND p.status = 'bloqueado' AND p.anonimizado_em IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'app_anonimizar_consentimentos_ia_nutri(): o paciente não está bloqueado à espera da anonimização neste tenant' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ia_nutri_consentimentos SET ip = NULL, user_agent = NULL, registrado_por = NULL
   WHERE tenant_id = v_tenant AND patient_id = p_patient AND (ip IS NOT NULL OR user_agent IS NOT NULL OR registrado_por IS NOT NULL);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_anonimizar_consentimentos_ia_nutri(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_anonimizar_consentimentos_ia_nutri(uuid) TO nutri_app_role;
--> statement-breakpoint
-- §3 / DP-11 (molde de admin_metricas_ia, 0099): por tenant, só contagens e somas do mês — perguntas que foram ao modelo
-- (contou_no_limite) e, de ia_uso, os DOIS escopos (paciente = conversa_paciente; nutri = o resto) com o mesmo filtro de
-- situação da 0099, num SELECT só por tenant: o TS lê a IA da nutricionista daqui, sem subtrair duas chamadas separadas
-- (/code-review do PR #37: duas leituras em momentos diferentes davam número negativo). A 0099 fica como está (o app
-- antigo a chama na janela do deploy). Fora de withTenant (o admin); o contexto worker é local a cada volta.
CREATE OR REPLACE FUNCTION admin_metricas_ia_nutri()
RETURNS TABLE (tenant_id uuid, perguntas_mes bigint, usos_mes bigint, custo_mes_micro_usd bigint, nutri_tarefas_mes bigint, nutri_custo_mes_micro_usd bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  t record;
  v_mes text;
  v_inicio timestamptz;
BEGIN
  IF coalesce(current_setting('app.tenant_id', true), '') <> '' THEN
    RAISE EXCEPTION 'admin_metricas_ia_nutri() não pode rodar dentro de withTenant' USING ERRCODE = '55000';
  END IF;
  FOR t IN SELECT tn.id, tn.fuso FROM public.tenants tn ORDER BY tn.created_at LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    PERFORM set_config('app.role', 'worker', true);
    PERFORM set_config('app.patient_id', '', true);
    v_mes := to_char(now() AT TIME ZONE t.fuso, 'YYYY-MM');
    v_inicio := date_trunc('month', now() AT TIME ZONE t.fuso) AT TIME ZONE t.fuso;
    tenant_id := t.id;
    SELECT count(*) INTO perguntas_mes FROM public.ia_nutri_mensagens m
     WHERE m.tenant_id = t.id AND m.autor = 'paciente' AND m.contou_no_limite AND m.created_at >= v_inicio;
    SELECT count(*) FILTER (WHERE u.tipo = 'conversa_paciente'),
           coalesce(sum(u.custo_micro_usd) FILTER (WHERE u.tipo = 'conversa_paciente' AND u.situacao IN ('reservado', 'confirmado', 'incerto')), 0)::bigint,
           count(*) FILTER (WHERE u.tipo <> 'conversa_paciente'),
           coalesce(sum(u.custo_micro_usd) FILTER (WHERE u.tipo <> 'conversa_paciente' AND u.situacao IN ('reservado', 'confirmado', 'incerto')), 0)::bigint
      INTO usos_mes, custo_mes_micro_usd, nutri_tarefas_mes, nutri_custo_mes_micro_usd
      FROM public.ia_uso u WHERE u.tenant_id = t.id AND u.mes = v_mes;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.role', '', true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin_metricas_ia_nutri() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin_metricas_ia_nutri() TO nutri_app_role;
