-- Plano 26 (spec §9.3; RN-498 a RN-505, RE-D15, RE-D28). CLAUDE.md regras 2 e 7. Uma custom só, escrita em três tarefas
-- (RE-D54): blocos 1 e 2 (negação por padrão e equipe_membros) na T4; bloco 3 (liberações e condições) na T5a; blocos 4 e 5
-- (gatilhos de colunas, funções refeitas e as SECURITY DEFINER da RN-510) na T5b.
-- Sem SET LOCAL lock_timeout aqui (RE-D64): o migrador aplica todas as pendentes numa transação só, e o limite de 10 s vem da
-- conexão dele (src/db/migrate.ts). Ele vale para CADA espera de trava, em todos os comandos da execução — a migration gerada
-- (CHECK e coluna em "user", lida em toda requisição) e o laço abaixo, que trava cada tabela com tenant_id —, não para a
-- execução inteira: as esperas podem somar, e a trava de "user" fica presa até o fim. Estourou uma: a transação volta inteira
-- e o boot tenta de novo (docs/operacao/recepcao.md).

-- 1. Negação por padrão (RN-505). A sessão `recepcao` não lê nem grava nada numa tabela com tenant_id, a não ser nas de
-- RECEPCAO_LIBERADO (src/db/rls-guard.ts), só nos comandos listados. RESTRICTIVE: soma-se (AND) às políticas de sempre.
-- Mesmo desenho do contexto `publico` (0051).
CREATE OR REPLACE FUNCTION app_deny_recepcao(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['select', 'insert', 'update', 'delete'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', 'recepcao_sem_' || c, tbl);
  END LOOP;
  EXECUTE format('DROP POLICY IF EXISTS recepcao_negada ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY recepcao_negada ON %s AS RESTRICTIVE FOR ALL '
    'USING (app_current_role() IS DISTINCT FROM %L) WITH CHECK (app_current_role() IS DISTINCT FROM %L)',
    tbl, 'recepcao', 'recepcao');
END $$;
--> statement-breakpoint
-- Libera à recepção só os comandos listados: uma política RESTRICTIVE por comando que continua negado (molde de
-- app_allow_publico, 0051). As condições extras (recepcao_cond_<assunto>, RECEPCAO_CONDICOES) não são tocadas aqui.
-- (SELECT … FOR UPDATE/SHARE também exige 'update'; INSERT … RETURNING/ON CONFLICT exige 'select'.)
CREATE OR REPLACE FUNCTION app_allow_recepcao(tbl regclass, VARIADIC comandos text[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  IF coalesce(cardinality(comandos), 0) = 0 OR NOT comandos <@ ARRAY['select', 'insert', 'update', 'delete'] THEN
    RAISE EXCEPTION 'app_allow_recepcao: comando inválido em % (use select, insert, update, delete)', comandos;
  END IF;
  EXECUTE format('DROP POLICY IF EXISTS recepcao_negada ON %s', tbl);
  FOREACH c IN ARRAY ARRAY['select', 'insert', 'update', 'delete'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', 'recepcao_sem_' || c, tbl);
    CONTINUE WHEN c = ANY (comandos);
    IF c = 'insert' THEN
      EXECUTE format('CREATE POLICY %I ON %s AS RESTRICTIVE FOR INSERT WITH CHECK (app_current_role() IS DISTINCT FROM %L)',
        'recepcao_sem_' || c, tbl, 'recepcao');
    ELSE
      EXECUTE format('CREATE POLICY %I ON %s AS RESTRICTIVE FOR %s USING (app_current_role() IS DISTINCT FROM %L)',
        'recepcao_sem_' || c, tbl, upper(c), 'recepcao');
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- Tabela nova nasce fechada também para a recepção: o corpo da 0070 (o último da main até a 0131) + app_deny_recepcao no fim.
CREATE OR REPLACE FUNCTION app_enable_tenant_rls(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s AS PERMISSIVE FOR ALL '
    'USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', tbl);
  PERFORM app_deny_publico(tbl);
  PERFORM app_deny_paciente_escrita(tbl);
  PERFORM app_deny_recepcao(tbl);
END $$;
--> statement-breakpoint
-- As tabelas que já existem (Planos 01 a 25, com as do 22 e do 23 da main) também ficam fechadas — só as do schema public
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation' LOOP
    PERFORM app_deny_recepcao(format('public.%I', t)::regclass);
  END LOOP;
END $$;
--> statement-breakpoint
-- 2. equipe_membros (spec §9.1). app_enable_tenant_rls já nega `publico` e `recepcao`; staff_only nega o paciente.
SELECT app_enable_tenant_rls('equipe_membros');
--> statement-breakpoint
SELECT app_enable_staff_only('equipe_membros');
--> statement-breakpoint
-- RN-502, RN-503: a recepção lê a própria linha (permissão do Financeiro e situação da conta), nunca a das outras
SELECT app_allow_recepcao('equipe_membros', 'select');
--> statement-breakpoint
CREATE POLICY recepcao_cond_propria_linha ON equipe_membros AS RESTRICTIVE FOR SELECT
  USING (app_current_role() IS DISTINCT FROM 'recepcao' OR user_id = app_current_user());
--> statement-breakpoint
-- RE-D28: a linha nunca é apagada (desativa-se)
REVOKE DELETE, TRUNCATE ON equipe_membros FROM nutri_app_role;
--> statement-breakpoint
-- RN-499, RN-502, RN-503 (spec §9.1). O BEFORE roda antes do WITH CHECK da RLS, então a ordem importa:
--   (1) contexto vazio e `worker` → 42501 (ninguém grava a equipe fora da sessão da nutricionista);
--   (2) `recepcao` → 42501 (ela só lê a própria linha; o UPDATE e o DELETE dela nem alcançam a linha: recepcao_sem_update e
--       DELETE revogado);
--   (3) UPDATE: `id`, `tenant_id`, `user_id`, `papel`, `convidada_por` e `created_at` fixos para todo papel (42501 antes da
--       RLS: IMUTAVEIS no teste de isolamento);
--   (4) paciente, publico e conta → RETURN NEW sem ler nada: a RLS da própria tabela recusa (staff_only, publico_negado,
--       tenant_isolation; molde da 0123, para o violaRlsDe de test/isolamento.test.ts ver a recusa da política);
--   (5) sessão `nutri`: no INSERT, linha de outro consultório → RETURN NEW sem ler a conta (a RLS recusa, e a mensagem não diz
--       de quem é o user_id); no próprio, `convidada_por` = a usuária da sessão, desativação nula e a conta tem de ser
--       `recepcao` do mesmo consultório (senão 42501); no UPDATE, desativar grava `desativada_em` (relógio do banco) e
--       `desativada_por` (a usuária da sessão), reativar limpa, e a desativação já registrada não muda — o módulo nunca
--       reenvia `desativada_em` lida do banco (o Date do JS perde os microssegundos do clock_timestamp()). O limite de 3 ativas é do módulo, sob a trava do tenant (RN-499, RN-503).
-- Comparações com IS DISTINCT FROM: o UPDATE sem mudança passa (isolamento: `set tenant_id = tenant_id`).
CREATE OR REPLACE FUNCTION app_equipe_membros_regras() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
BEGIN
  IF r = '' OR r = 'worker' THEN
    RAISE EXCEPTION 'a equipe do consultório só muda pela sessão da nutricionista' USING ERRCODE = '42501';
  END IF;
  IF r = 'recepcao' THEN
    RAISE EXCEPTION 'a recepção não altera a equipe do consultório' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW.id, NEW.tenant_id, NEW.user_id, NEW.papel, NEW.convidada_por, NEW.created_at)
         IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.user_id, OLD.papel, OLD.convidada_por, OLD.created_at) THEN
    RAISE EXCEPTION 'coluna fixa da equipe do consultório' USING ERRCODE = '42501';
  END IF;
  IF r <> 'nutri' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.tenant_id IS DISTINCT FROM app_current_tenant() THEN
      RETURN NEW;
    END IF;
    NEW.convidada_por := app_current_user();
    NEW.desativada_em := NULL;
    NEW.desativada_por := NULL;
    IF NOT EXISTS (
      SELECT 1 FROM public."user" u
       WHERE u.id = NEW.user_id AND u.app_role = 'recepcao' AND u.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'a conta não é da recepção deste consultório' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.desativada_em IS NULL AND NEW.desativada_em IS NOT NULL THEN
    NEW.desativada_em := clock_timestamp();
    NEW.desativada_por := app_current_user();
  ELSIF NEW.desativada_em IS NULL THEN
    NEW.desativada_por := NULL;
  ELSIF (NEW.desativada_em, NEW.desativada_por) IS DISTINCT FROM (OLD.desativada_em, OLD.desativada_por) THEN
    RAISE EXCEPTION 'a desativação registrada não muda (reative antes)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER equipe_membros_regras BEFORE INSERT OR UPDATE ON equipe_membros FOR EACH ROW EXECUTE FUNCTION app_equipe_membros_regras();
--> statement-breakpoint
-- 3. Liberações (spec §4.3, RN-506 a RN-508) e condições. Só as tabelas da matriz, só os comandos listados; cada uma também
-- em RECEPCAO_LIBERADO (src/db/rls-guard.ts). Sem public_booking_requests (pedido de pessoa nova fica com a nutricionista,
-- RE-D59: continua com recepcao_negada). As tabelas do Plano 22 (exames_catalogo, exames_modelos_solicitacao,
-- exam_interpretacoes, exam_versoes) e do 23 (locais_atendimento, aniversario_autorizacoes) seguem negadas pelo laço do bloco 1;
-- a liberação de locais_atendimento é da T5b.
-- Lembrete do Postgres: SELECT … FOR UPDATE/SHARE exige a política de UPDATE (o fin_lancamentos_regras lê o paciente
-- FOR KEY SHARE: `patients` tem update liberado); INSERT … RETURNING e ON CONFLICT exigem a de SELECT.
SELECT app_allow_recepcao('patients', 'select', 'insert', 'update');
--> statement-breakpoint
SELECT app_allow_recepcao('patient_cadastro', 'select', 'insert', 'update');
--> statement-breakpoint
SELECT app_allow_recepcao('appointments', 'select', 'insert', 'update');
--> statement-breakpoint
SELECT app_allow_recepcao('notifications', 'select', 'insert', 'update');
--> statement-breakpoint
SELECT app_allow_recepcao('availability_rules', 'select');
--> statement-breakpoint
SELECT app_allow_recepcao('availability_blocks', 'select');
--> statement-breakpoint
-- o gatilho de auditoria e o auditRead gravam com o papel de quem age (a recepção não lê a trilha)
SELECT app_allow_recepcao('audit_log', 'insert');
--> statement-breakpoint
SELECT app_allow_recepcao('fin_configuracoes', 'select');
--> statement-breakpoint
SELECT app_allow_recepcao('fin_categorias', 'select');
--> statement-breakpoint
SELECT app_allow_recepcao('fin_lancamentos', 'select', 'insert', 'update');
--> statement-breakpoint
-- 3b. Condições (RESTRICTIVE, comando declarado; RECEPCAO_CONDICOES guarda a expressão inteira). Todas começam por
-- `app_current_role() IS DISTINCT FROM 'recepcao' OR …`: para os outros papéis o OR para no primeiro termo (o EXISTS, que não
-- vira semi-join dentro de um OR, nem roda; o InitPlan da permissão só é avaliado quando o parâmetro é lido).
--
-- RN-508 / RE-D40: paciente visível = nem bloqueado nem anonimizado. Em `patients`, nas colunas da própria linha (USING e WITH
-- CHECK: a recepção também não leva ninguém a bloqueado); nas filhas, por EXISTS no paciente com os mesmos filtros escritos
-- (sem depender de a RLS de `patients` valer dentro da subconsulta). Escondido = falha fechada: SELECT e UPDATE não alcançam a
-- linha, INSERT com o id dele é recusado pela política.
CREATE POLICY recepcao_cond_paciente_visivel ON patients AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'recepcao' OR (status <> 'bloqueado' AND anonimizado_em IS NULL))
  WITH CHECK (app_current_role() IS DISTINCT FROM 'recepcao' OR (status <> 'bloqueado' AND anonimizado_em IS NULL));
--> statement-breakpoint
CREATE POLICY recepcao_cond_paciente_visivel ON patient_cadastro AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'recepcao' OR EXISTS (
    SELECT 1 FROM public.patients p WHERE p.tenant_id = patient_cadastro.tenant_id AND p.id = patient_cadastro.patient_id
       AND p.status <> 'bloqueado' AND p.anonimizado_em IS NULL))
  WITH CHECK (app_current_role() IS DISTINCT FROM 'recepcao' OR EXISTS (
    SELECT 1 FROM public.patients p WHERE p.tenant_id = patient_cadastro.tenant_id AND p.id = patient_cadastro.patient_id
       AND p.status <> 'bloqueado' AND p.anonimizado_em IS NULL));
--> statement-breakpoint
CREATE POLICY recepcao_cond_paciente_visivel ON appointments AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'recepcao' OR EXISTS (
    SELECT 1 FROM public.patients p WHERE p.tenant_id = appointments.tenant_id AND p.id = appointments.patient_id
       AND p.status <> 'bloqueado' AND p.anonimizado_em IS NULL))
  WITH CHECK (app_current_role() IS DISTINCT FROM 'recepcao' OR EXISTS (
    SELECT 1 FROM public.patients p WHERE p.tenant_id = appointments.tenant_id AND p.id = appointments.patient_id
       AND p.status <> 'bloqueado' AND p.anonimizado_em IS NULL));
--> statement-breakpoint
CREATE POLICY recepcao_cond_paciente_visivel ON notifications AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'recepcao' OR EXISTS (
    SELECT 1 FROM public.patients p WHERE p.tenant_id = notifications.tenant_id AND p.id = notifications.patient_id
       AND p.status <> 'bloqueado' AND p.anonimizado_em IS NULL))
  WITH CHECK (app_current_role() IS DISTINCT FROM 'recepcao' OR EXISTS (
    SELECT 1 FROM public.patients p WHERE p.tenant_id = notifications.tenant_id AND p.id = notifications.patient_id
       AND p.status <> 'bloqueado' AND p.anonimizado_em IS NULL));
--> statement-breakpoint
-- lançamento sem paciente (saída, entrada avulsa) fica visível a quem tem a permissão do Financeiro
CREATE POLICY recepcao_cond_paciente_visivel ON fin_lancamentos AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'recepcao' OR patient_id IS NULL OR EXISTS (
    SELECT 1 FROM public.patients p WHERE p.tenant_id = fin_lancamentos.tenant_id AND p.id = fin_lancamentos.patient_id
       AND p.status <> 'bloqueado' AND p.anonimizado_em IS NULL))
  WITH CHECK (app_current_role() IS DISTINCT FROM 'recepcao' OR patient_id IS NULL OR EXISTS (
    SELECT 1 FROM public.patients p WHERE p.tenant_id = fin_lancamentos.tenant_id AND p.id = fin_lancamentos.patient_id
       AND p.status <> 'bloqueado' AND p.anonimizado_em IS NULL));
--> statement-breakpoint
-- RN-507: só os tipos da agenda (TIPOS_DA_AGENDA, src/modules/notificacoes/tipos.ts; tipos.test.ts compara esta lista com a
-- constante e com o CHECK notifications_tipo_valido). Sem convite_paciente (RE-D37). Plano 23 (0130): pedido_nao_confirmado
-- (recusa ou vencimento do pedido de consulta do paciente cadastrado, RN-428) entra; aniversario fica fora (RN-432: mensagem
-- da nutricionista com a autorização de aniversario_autorizacoes, negada à recepção — não é aviso da consulta).
CREATE POLICY recepcao_cond_notificacoes_da_agenda ON notifications AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'recepcao' OR tipo IN ('lembrete_24h', 'lembrete_2h', 'consulta_marcada', 'consulta_cancelada', 'resposta_confirmacao', 'resposta_remarcar', 'pedido_nao_confirmado'))
  WITH CHECK (app_current_role() IS DISTINCT FROM 'recepcao' OR tipo IN ('lembrete_24h', 'lembrete_2h', 'consulta_marcada', 'consulta_cancelada', 'resposta_confirmacao', 'resposta_remarcar', 'pedido_nao_confirmado'));
--> statement-breakpoint
-- RN-502, RN-506: a conta da sessão é da recepção deste consultório, ativa e com a permissão do Financeiro. SECURITY INVOKER:
-- lê equipe_membros pela RLS de quem age (a recepção vê só a própria linha). `SET search_path` impede o inline da função; nas
-- políticas ela vai dentro de `(SELECT …)`, um InitPlan avaliado uma vez por consulta, não por linha.
CREATE OR REPLACE FUNCTION app_recepcao_tem_financeiro() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT app_current_role() = 'recepcao' AND EXISTS (
    SELECT 1 FROM public.equipe_membros m
     WHERE m.tenant_id = app_current_tenant() AND m.user_id = app_current_user()
       AND m.financeiro AND m.desativada_em IS NULL)
$$;
--> statement-breakpoint
CREATE POLICY recepcao_cond_financeiro ON fin_configuracoes AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'recepcao' OR (SELECT app_recepcao_tem_financeiro()))
  WITH CHECK (app_current_role() IS DISTINCT FROM 'recepcao' OR (SELECT app_recepcao_tem_financeiro()));
--> statement-breakpoint
CREATE POLICY recepcao_cond_financeiro ON fin_categorias AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'recepcao' OR (SELECT app_recepcao_tem_financeiro()))
  WITH CHECK (app_current_role() IS DISTINCT FROM 'recepcao' OR (SELECT app_recepcao_tem_financeiro()));
--> statement-breakpoint
CREATE POLICY recepcao_cond_financeiro ON fin_lancamentos AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'recepcao' OR (SELECT app_recepcao_tem_financeiro()))
  WITH CHECK (app_current_role() IS DISTINCT FROM 'recepcao' OR (SELECT app_recepcao_tem_financeiro()));
--> statement-breakpoint
-- RN-506 (spec §4.4): fin_lancamentos_regras com o corpo da 0123 (o último da main até a 0131) e a recepção "como nutri, com falha
-- fechada". Mudou só: (a) os dois ramos "papel diferente de `nutri` → RETURN NEW (a RLS recusa)" passam a "papel fora de
-- (`nutri`, `recepcao`)"; (b) na recepção, linha de outro consultório → RETURN NEW sem ler o paciente (a RLS recusa; molde do
-- equipe_membros_regras); (c) na recepção, o paciente lido FOR KEY SHARE pela RLS dela e NÃO achado (bloqueado ou anonimizado:
-- escondido por recepcao_cond_paciente_visivel) → 42501, no INSERT e no UPDATE — sem isso, `v_status = 'bloqueado'` com tudo
-- nulo passaria (RE-D40). A nutricionista segue exatamente como na 0123 (RN-315). As regras do resto valem para as duas:
-- criado_por, cancelado_por e cancelado_em da sessão e do relógio; cancelado e anonimizado não mudam.
-- Comentário da 0123 (ordem): o BEFORE roda antes do WITH CHECK da RLS, então a ordem importa:
--   (1) contexto vazio ou `worker` → 42501 (no UPDATE, o worker só passa no ramo da anonimização, com o marcador local
--       app.fin_anonimizando = '1', ligado só por app_anonimizar_financeiro, e o paciente bloqueado com o prazo vencido);
--   (2) papel fora de (`nutri`, `recepcao`) → RETURN NEW SEM ler patients: paciente, publico e conta são recusados pela RLS
--       da própria tabela (paciente_sem_insert, publico_negado, tenant_isolation) — lendo o paciente antes, nesses contextos
--       ele viria vazio pela RLS e a recusa mudaria de mensagem (test/isolamento.test.ts, violaRlsDe);
--   (3) só nas sessões `nutri` e `recepcao` o gatilho lê `status, anonimizado_em` do paciente com FOR KEY SHARE (espera o FOR
--       UPDATE de um bloqueio em andamento e lê a versão nova), no INSERT e no UPDATE.
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
    IF r NOT IN ('nutri', 'recepcao') THEN
      RETURN NEW;
    END IF;
    IF r = 'recepcao' AND NEW.tenant_id IS DISTINCT FROM app_current_tenant() THEN
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
      IF NOT FOUND AND r = 'recepcao' THEN
        RAISE EXCEPTION 'paciente não encontrado' USING ERRCODE = '42501';
      END IF;
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

  IF r NOT IN ('nutri', 'recepcao') THEN
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
    IF NOT FOUND AND r = 'recepcao' THEN
      RAISE EXCEPTION 'paciente não encontrado' USING ERRCODE = '42501';
    END IF;
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
-- 3c. (T5b) Plano 23 (spec §4.3): locais_atendimento só para ler — filtro e seletor de local na agenda. Sem condição: o local
-- não é do paciente; o link da sala (link_sala) não sai do módulo (projeção da T10, teste das chaves). Continua staff_only.
SELECT app_allow_recepcao('locais_atendimento', 'select');
--> statement-breakpoint
-- 4. Gatilhos de colunas da recepção (RN-508, RN-509, RN-512; RE-D41: lista branca, não lista negra). Só agem na sessão
-- `recepcao`; os outros papéis passam intactos. Linha de outro consultório → RETURN NEW sem ler nada: a RLS recusa
-- (tenant_isolation, WITH CHECK), com a mensagem de RLS que o teste de isolamento espera (violaRlsDe). Lista branca por
-- `to_jsonb`: coluna nova de outro plano nasce fixa para a recepção (falha fechada) até alguém decidir liberá-la.
--
-- RN-508 / RE-D37 / RE-D41: no INSERT só valem nome, nascimento, sexo, e-mail e telefone (mais as colunas de sistema), com
-- status 'ativo', origem 'nutri' e todo o resto nulo — user_id (ligaria uma conta de paciente existente ao cadastro novo),
-- bloqueio, anonimização, IA, peso oculto, lembretes e WhatsApp. No UPDATE só mudam nome, nascimento, sexo, telefone e
-- updated_at: o e-mail é fixo (chave do portal, dos links de documento e da autorização de IA). O UPDATE que reenvia uma
-- coluna com o mesmo valor (WhatsApp lido do banco) passa: compara-se o valor, não a presença no SET. No INSERT, created_at é
-- o do banco (now(), o início da transação): o relatório de Pacientes conta os novos por ele.
CREATE OR REPLACE FUNCTION app_patients_da_recepcao() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF coalesce(public.app_current_role(), '') <> 'recepcao' OR NEW.tenant_id IS DISTINCT FROM public.app_current_tenant() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF jsonb_strip_nulls(to_jsonb(NEW) - ARRAY['id', 'tenant_id', 'nome', 'data_nascimento', 'sexo', 'email', 'telefone_e164', 'created_at', 'updated_at'])
       IS DISTINCT FROM '{"status": "ativo", "origem": "nutri"}'::jsonb THEN
      RAISE EXCEPTION 'a recepção cadastra só nome, nascimento, sexo, e-mail e telefone do paciente' USING ERRCODE = '42501';
    END IF;
    NEW.created_at := now(); -- os novos do relatório de Pacientes contam por created_at: a recepção não recua a data
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['nome', 'data_nascimento', 'sexo', 'telefone_e164', 'updated_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['nome', 'data_nascimento', 'sexo', 'telefone_e164', 'updated_at']) THEN
    RAISE EXCEPTION 'a recepção muda só o nome, o nascimento, o sexo e o telefone do paciente' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER patients_da_recepcao BEFORE INSERT OR UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION app_patients_da_recepcao();
--> statement-breakpoint
-- RN-508 / RE-D38 / RE-D41: lista branca, como as outras duas. A recepção grava só as colunas do cadastro que a tela dela tem:
-- CPF, nome social, estado civil, escolaridade, ocupação, nacionalidade, naturalidade, telefone fixo e endereço (mais as de
-- sistema). Fora da lista — a observação e a identidade de gênero (RE-D38) e toda coluna nova de outro plano —: nulas no INSERT
-- e fixas no UPDATE (nem apagar). id, tenant_id e patient_id também são fixos para todos (patient_cadastro_colunas_fixas, que
-- dispara antes).
CREATE OR REPLACE FUNCTION app_patient_cadastro_da_recepcao() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  livres text[] := ARRAY['id', 'tenant_id', 'patient_id', 'cpf', 'nome_social', 'estado_civil', 'escolaridade', 'ocupacao',
                         'nacionalidade', 'naturalidade', 'telefone_fixo_e164', 'cep', 'logradouro', 'numero', 'complemento',
                         'bairro', 'cidade', 'uf', 'created_at', 'updated_at'];
BEGIN
  IF coalesce(public.app_current_role(), '') <> 'recepcao' OR NEW.tenant_id IS DISTINCT FROM public.app_current_tenant() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF jsonb_strip_nulls(to_jsonb(NEW) - livres) IS DISTINCT FROM '{}'::jsonb THEN
      RAISE EXCEPTION 'a recepção não grava essa parte do cadastro (observação, identidade de gênero)' USING ERRCODE = '42501';
    END IF;
  ELSIF (to_jsonb(NEW) - livres) IS DISTINCT FROM (to_jsonb(OLD) - livres) THEN
    RAISE EXCEPTION 'a recepção não grava essa parte do cadastro (observação, identidade de gênero)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER patient_cadastro_da_recepcao BEFORE INSERT OR UPDATE ON patient_cadastro FOR EACH ROW EXECUTE FUNCTION app_patient_cadastro_da_recepcao();
--> statement-breakpoint
-- RN-509 / RE-D41 / RE-D59 / RE-D62. Dispara antes de appointments_link_da_sala e appointments_regras_pedido (ordem alfabética).
-- INSERT: só a consulta agendada pelo consultório — status 'agendada', origem 'nutri' e o resto nulo (presença, confirmação,
-- cancelamento, motivo, pedido de remarcação, remarcada_de); paciente, horário, modalidade, link e local livres.
-- UPDATE: mudam só horário, modalidade, link, local, situação, confirmação, cancelamento, pedido de remarcação, presença e
-- updated_at; paciente, origem, remarcada_de, motivo do cancelamento e created_at são fixos (o motivo nunca é dela, RE-D44).
-- Situação, só estas passagens: agendada ⇄ confirmada (confirmar; mover volta a agendada); agendada|confirmada → cancelada
-- pelo consultório ('nutri'); agendada|confirmada → faltou depois do início e sem atendimento ligado; solicitada → agendada
-- (aceite) ou → cancelada por 'pedido_recusado' (recusa) — os pedidos do Plano 23, cujo gatilho também confere o papel. Nunca
-- → realizada nem saindo de realizada, cancelada ou faltou. O cancelamento (quem e quando) só muda ao cancelar; a presença,
-- só ao registrar a falta, e o quando vem do relógio do banco (clock_timestamp()); a confirmação (confirmada_via, prova de que o
-- paciente confirmou) só fica como está ou vai a nulo. Consulta encerrada (cancelada, realizada, faltou) não muda em nada: o
-- horário, o local e a modalidade dela contam nos Relatórios, no local da receita (US-416) e no selo de Retorno. No INSERT,
-- created_at é o do banco (now()). "Tem atendimento" por app_consulta_tem_atendimento (bloco 5): consultations é negada à recepção, e
-- a busca pela RLS dela voltaria vazia (vazio calado não é recusa, RE-D62); nulo (consulta não achada) também recusa.
CREATE OR REPLACE FUNCTION app_appointments_da_recepcao() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  livres text[] := ARRAY['inicio', 'fim', 'modalidade', 'link_online', 'local_id', 'status', 'confirmada_via', 'cancelado_por',
                         'cancelada_em', 'pedido_remarcacao_em', 'presenca_em', 'updated_at'];
BEGIN
  IF coalesce(public.app_current_role(), '') <> 'recepcao' OR NEW.tenant_id IS DISTINCT FROM public.app_current_tenant() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF jsonb_strip_nulls(to_jsonb(NEW) - ARRAY['id', 'tenant_id', 'patient_id', 'inicio', 'fim', 'modalidade', 'link_online', 'local_id', 'created_at', 'updated_at'])
       IS DISTINCT FROM '{"status": "agendada", "origem": "nutri"}'::jsonb THEN
      RAISE EXCEPTION 'a recepção só marca consulta agendada pelo consultório' USING ERRCODE = '42501';
    END IF;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - livres) IS DISTINCT FROM (to_jsonb(OLD) - livres) THEN
    RAISE EXCEPTION 'a recepção não muda o paciente, a origem, a remarcação nem o motivo do cancelamento da consulta' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('cancelada', 'realizada', 'faltou') AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'a recepção não muda consulta encerrada' USING ERRCODE = '42501';
  END IF;
  IF NEW.confirmada_via IS NOT NULL AND NEW.confirmada_via IS DISTINCT FROM OLD.confirmada_via THEN
    RAISE EXCEPTION 'a confirmação do paciente não é gravada pela recepção' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('agendada', 'confirmada') AND NEW.status IN ('agendada', 'confirmada') THEN
      NULL;
    ELSIF OLD.status IN ('agendada', 'confirmada') AND NEW.status = 'cancelada' AND NEW.cancelado_por IS NOT DISTINCT FROM 'nutri' THEN
      NEW.cancelada_em := clock_timestamp();
    ELSIF OLD.status = 'solicitada' AND NEW.status = 'agendada' THEN
      NULL;
    ELSIF OLD.status = 'solicitada' AND NEW.status = 'cancelada' AND NEW.cancelado_por IS NOT DISTINCT FROM 'pedido_recusado' THEN
      NEW.cancelada_em := clock_timestamp();
    ELSIF OLD.status IN ('agendada', 'confirmada') AND NEW.status = 'faltou' THEN
      IF OLD.inicio > clock_timestamp() OR NEW.inicio IS DISTINCT FROM OLD.inicio THEN
        RAISE EXCEPTION 'a falta só depois do início da consulta' USING ERRCODE = '42501';
      END IF;
      IF public.app_consulta_tem_atendimento(OLD.id) IS NOT FALSE THEN
        RAISE EXCEPTION 'consulta com atendimento registrado não vira falta' USING ERRCODE = '42501';
      END IF;
      NEW.presenca_em := clock_timestamp();
    ELSE
      RAISE EXCEPTION 'a recepção não faz essa mudança na situação da consulta' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF (NEW.cancelado_por, NEW.cancelada_em) IS DISTINCT FROM (OLD.cancelado_por, OLD.cancelada_em)
     AND NOT (NEW.status = 'cancelada' AND OLD.status IS DISTINCT FROM 'cancelada') THEN
    RAISE EXCEPTION 'o cancelamento só muda ao cancelar a consulta' USING ERRCODE = '42501';
  END IF;
  IF NEW.presenca_em IS DISTINCT FROM OLD.presenca_em AND NOT (NEW.status = 'faltou' AND OLD.status IS DISTINCT FROM 'faltou') THEN
    RAISE EXCEPTION 'a presença só muda ao registrar a falta' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER appointments_da_recepcao BEFORE INSERT OR UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION app_appointments_da_recepcao();
--> statement-breakpoint
-- RN-512: tenants não tem RLS; a recepção lê (fuso, nome, regras da agenda) e não muda nada — qualquer UPDATE na sessão dela,
-- mesmo sem mudança, é 42501 (os gatilhos de tenants do Plano 23 e da IA Nutri deixariam passar o papel novo). INSERT e
-- DELETE já são recusados a toda sessão de consultório (tenants_por_sessao). Os outros papéis passam intactos.
CREATE OR REPLACE FUNCTION app_tenants_so_nutri() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF public.app_current_role() IS NOT DISTINCT FROM 'recepcao' THEN
    RAISE EXCEPTION 'a recepção não muda o consultório' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER tenants_so_nutri BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION app_tenants_so_nutri();
--> statement-breakpoint
-- RE-D59 (spec §4.4): app_appointments_regras_pedido com o corpo da 0131 (o último da main até aqui; no rebase, o da main do
-- momento — teste em recepcao-banco.test.ts) e a recepção nos dois pontos do papel: o aceite (solicitada → agendada) e a recusa
-- ('pedido_recusado'), como a nutricionista. Os outros ramos (paciente, publico, worker, 'sistema') não mudam; o INSERT de
-- pedido pela recepção é recusado antes, por appointments_da_recepcao (só 'agendada'). O comentário das regras está na 0131.
CREATE OR REPLACE FUNCTION app_appointments_regras_pedido() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(public.app_current_role(), '');
  marcador text := coalesce(current_setting('app.agenda_remarcavel', true), '');
  chave boolean;
  antecedencia integer;
  titular text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF r = '' THEN
      RETURN NEW;
    END IF;
    IF NEW.cancelado_por IN ('pedido_desistido', 'pedido_recusado', 'pedido_vencido') THEN
      RAISE EXCEPTION 'os motivos de pedido só valem saindo de um pedido' USING ERRCODE = '42501';
    END IF;
    IF r IN ('paciente', 'publico') THEN
      IF NEW.remarcada_de IS NOT NULL AND NEW.remarcada_de::text IS NOT DISTINCT FROM marcador AND EXISTS (
           SELECT 1 FROM public.appointments o
            WHERE o.id = NEW.remarcada_de AND o.tenant_id = NEW.tenant_id AND o.patient_id = NEW.patient_id) THEN
        PERFORM set_config('app.agenda_remarcavel', '', true);
        NEW.status := 'agendada';
        RETURN NEW;
      END IF;
      SELECT t.agenda_confirmar_pedidos INTO chave FROM public.tenants t WHERE t.id = NEW.tenant_id;
      NEW.status := CASE WHEN coalesce(chave, false) THEN 'solicitada' ELSE 'agendada' END;
      RETURN NEW;
    END IF;
    IF r IN ('nutri', 'worker') AND NEW.status IS NOT DISTINCT FROM 'solicitada' THEN
      RAISE EXCEPTION 'só nasce pedido na sessão do paciente ou na página pública' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM 'solicitada' AND OLD.status IS DISTINCT FROM 'solicitada' THEN
    RAISE EXCEPTION 'nenhuma alteração leva a consulta a pedido' USING ERRCODE = '42501';
  END IF;
  IF NEW.cancelado_por IN ('pedido_desistido', 'pedido_recusado', 'pedido_vencido')
     AND NEW.cancelado_por IS DISTINCT FROM OLD.cancelado_por AND OLD.status IS DISTINCT FROM 'solicitada' THEN
    RAISE EXCEPTION 'os motivos de pedido só valem saindo de um pedido' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IS NOT DISTINCT FROM 'solicitada' THEN
    IF (NEW.inicio, NEW.fim, NEW.local_id, NEW.modalidade, NEW.patient_id)
       IS DISTINCT FROM (OLD.inicio, OLD.fim, OLD.local_id, OLD.modalidade, OLD.patient_id) THEN
      RAISE EXCEPTION 'o horário, o local, a modalidade e o paciente do pedido não mudam' USING ERRCODE = '42501';
    END IF;
    IF NEW.status NOT IN ('solicitada', 'agendada', 'cancelada') THEN
      RAISE EXCEPTION 'o pedido só é aceito ou cancelado' USING ERRCODE = '42501';
    END IF;
    IF r <> '' AND NEW.status IS NOT DISTINCT FROM 'agendada' AND r NOT IN ('nutri', 'recepcao') THEN
      RAISE EXCEPTION 'só a nutricionista aceita o pedido' USING ERRCODE = '42501';
    END IF;
    IF r <> '' AND NEW.status IS NOT DISTINCT FROM 'cancelada' THEN
      IF (r, NEW.cancelado_por) IS NOT DISTINCT FROM ('paciente'::text, 'pedido_desistido'::text)
         OR (r, NEW.cancelado_por) IS NOT DISTINCT FROM ('nutri'::text, 'pedido_recusado'::text)
         OR (r, NEW.cancelado_por) IS NOT DISTINCT FROM ('recepcao'::text, 'pedido_recusado'::text) THEN
        NULL;
      ELSIF (r, NEW.cancelado_por) IS NOT DISTINCT FROM ('worker'::text, 'pedido_vencido'::text) THEN
        SELECT t.antecedencia_min_h INTO antecedencia FROM public.tenants t WHERE t.id = OLD.tenant_id;
        IF antecedencia IS NULL OR OLD.inicio - make_interval(hours => antecedencia) > now() THEN
          RAISE EXCEPTION 'o pedido ainda está no prazo de resposta' USING ERRCODE = '42501';
        END IF;
      ELSIF (r, NEW.cancelado_por) IS NOT DISTINCT FROM ('nutri'::text, 'sistema'::text) THEN
        SELECT pt.status INTO titular FROM public.patients pt WHERE pt.tenant_id = OLD.tenant_id AND pt.id = OLD.patient_id;
        IF titular IS DISTINCT FROM 'bloqueado' THEN
          RAISE EXCEPTION 'quem cancela o pedido e o motivo não combinam (sistema só com o titular bloqueado)' USING ERRCODE = '42501';
        END IF;
      ELSE
        RAISE EXCEPTION 'quem cancela o pedido e o motivo não combinam' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  -- RN-422 (rodada 1 da T1b): a sessão do paciente tem UPDATE de todas as colunas da própria consulta (0070); a chave dos
  -- pedidos só vale se ele não reabrir nem mover consulta. Ele só confirma, pede remarcação e cancela (cancelamento.ts).
  IF r = 'paciente' THEN
    -- patient_id fica com a RLS (patient_isolation, WITH CHECK): o paciente só grava a própria consulta
    IF (NEW.inicio, NEW.fim, NEW.local_id, NEW.modalidade, NEW.origem, NEW.remarcada_de, NEW.link_online, NEW.presenca_em,
        NEW.created_at)
       IS DISTINCT FROM (OLD.inicio, OLD.fim, OLD.local_id, OLD.modalidade, OLD.origem, OLD.remarcada_de, OLD.link_online,
        OLD.presenca_em, OLD.created_at) THEN
      RAISE EXCEPTION 'o paciente não muda o horário, o local, a modalidade, o link, a origem nem a presença da consulta' USING ERRCODE = '42501';
    END IF;
    IF OLD.status IN ('cancelada', 'realizada', 'faltou') THEN
      IF (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
        RAISE EXCEPTION 'consulta encerrada não muda na sessão do paciente' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.status IS DISTINCT FROM OLD.status AND NOT (
         (OLD.status = 'agendada' AND NEW.status = 'confirmada')
      OR (OLD.status IN ('agendada', 'confirmada') AND NEW.status = 'cancelada' AND NEW.cancelado_por IS NOT DISTINCT FROM 'paciente')
      OR (OLD.status = 'solicitada' AND NEW.status = 'cancelada' AND NEW.cancelado_por IS NOT DISTINCT FROM 'pedido_desistido')) THEN
      RAISE EXCEPTION 'o paciente só confirma ou cancela a consulta' USING ERRCODE = '42501';
    END IF;
    IF NEW.confirmada_via IS DISTINCT FROM OLD.confirmada_via AND NOT (OLD.status = 'agendada' AND NEW.status = 'confirmada') THEN
      RAISE EXCEPTION 'a via da confirmação só muda na confirmação' USING ERRCODE = '42501';
    END IF;
    IF NEW.motivo_cancelamento IS DISTINCT FROM OLD.motivo_cancelamento AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'o motivo só muda no cancelamento' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- o marcador só no cancelamento de consulta que ainda não começou (o prazo de cancelamento fica no módulo)
  IF r = 'paciente' AND OLD.status IN ('agendada', 'confirmada') AND NEW.status IS NOT DISTINCT FROM 'cancelada'
     AND NEW.cancelado_por IS NOT DISTINCT FROM 'paciente' AND OLD.inicio > now() THEN
    PERFORM set_config('app.agenda_remarcavel', OLD.id::text, true);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- 5. Peças SECURITY DEFINER da recepção (RN-510, RE-D27, RE-D62, RE-D71; molde app_conteudo_por_etiqueta, 0083, e as do
-- Plano 23, 0131). O dono é o migrator NOBYPASSRLS e a RLS é FORCE: sem a troca, a função rodaria com o app.role de quem chamou
-- (consultations negada à recepção; o paciente escondido some). Cada uma aceita só `nutri` e `recepcao` com tenant (outro papel
-- → vazio ou nulo, que quem chama trata como recusa); guarda app.role e app.patient_id, troca para `worker` sem paciente
-- (set_config local à transação), filtra à mão pelo tenant da sessão e pelo paciente visível (nem bloqueado nem anonimizado,
-- a mesma condição de recepcao_cond_paciente_visivel) e devolve o contexto do chamador antes de retornar. Devolvem só ids, o
-- selo, a previsão ou o booleano — nunca a primeira data da vida do paciente nem o cadastro de outro. search_path fixo, nomes
-- com public., EXECUTE só para o app.
--
-- RN-510 / RN-416 (Plano 23): o selo "Primeira consulta"/"Retorno" de cada consulta de paciente visível com início no período
-- (no fuso do consultório, no máximo 13 meses): retorno = o paciente tem consulta `realizada` antes deste início ou atendimento
-- (consultations.data) em dia anterior ao desta; numa consulta agregada por paciente (min), nunca por item.
CREATE OR REPLACE FUNCTION app_retorno_das_consultas(p_de date, p_ate date)
RETURNS TABLE (appointment_id uuid, retorno boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role text := current_setting('app.role', true);
  v_patient text := coalesce(current_setting('app.patient_id', true), '');
  v_tenant uuid := public.app_current_tenant();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('nutri', 'recepcao') OR v_tenant IS NULL OR p_de IS NULL OR p_ate IS NULL THEN
    RETURN;
  END IF;
  IF p_ate < p_de OR p_ate >= (p_de + interval '13 months')::date THEN
    RAISE EXCEPTION 'período inválido: no máximo 13 meses' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.role', 'worker', true);
  PERFORM set_config('app.patient_id', '', true);
  RETURN QUERY
    WITH base AS (
      SELECT a.id, a.patient_id, a.inicio, (a.inicio AT TIME ZONE t.fuso)::date AS dia
        FROM public.appointments a
        JOIN public.tenants t ON t.id = a.tenant_id
        JOIN public.patients p ON p.tenant_id = a.tenant_id AND p.id = a.patient_id
       WHERE a.tenant_id = v_tenant AND p.status <> 'bloqueado' AND p.anonimizado_em IS NULL
         AND (a.inicio AT TIME ZONE t.fuso)::date BETWEEN p_de AND p_ate
    ), realizadas AS (
      SELECT r.patient_id, min(r.inicio) AS primeira
        FROM public.appointments r
       WHERE r.tenant_id = v_tenant AND r.status = 'realizada' AND r.patient_id IN (SELECT b.patient_id FROM base b)
       GROUP BY r.patient_id
    ), atendimentos AS (
      SELECT c.patient_id, min(c.data) AS primeira
        FROM public.consultations c
       WHERE c.tenant_id = v_tenant AND c.patient_id IN (SELECT b.patient_id FROM base b)
       GROUP BY c.patient_id
    )
    SELECT b.id, coalesce(re.primeira < b.inicio, false) OR coalesce(aa.primeira < b.dia, false)
      FROM base b
      LEFT JOIN realizadas re ON re.patient_id = b.patient_id
      LEFT JOIN atendimentos aa ON aa.patient_id = b.patient_id
     ORDER BY b.inicio, b.id;
  PERFORM set_config('app.role', v_role, true);
  PERFORM set_config('app.patient_id', v_patient, true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_retorno_das_consultas(date, date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_retorno_das_consultas(date, date) TO nutri_app_role;
--> statement-breakpoint
-- RN-510 / RN-430 (Plano 23): a previsão de retorno de cada paciente visível — a do ÚLTIMO atendimento com previsão —, quando
-- cai no período (no máximo 13 meses). Só (patient_id, previsto_em). O resto do marcador da RN-430 (paciente ativo, sem
-- consulta futura) quem chama confere nas tabelas que a recepção lê (patients, appointments).
CREATE OR REPLACE FUNCTION app_previsoes_de_retorno(p_de date, p_ate date)
RETURNS TABLE (patient_id uuid, previsto_em date)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role text := current_setting('app.role', true);
  v_patient text := coalesce(current_setting('app.patient_id', true), '');
  v_tenant uuid := public.app_current_tenant();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('nutri', 'recepcao') OR v_tenant IS NULL OR p_de IS NULL OR p_ate IS NULL THEN
    RETURN;
  END IF;
  IF p_ate < p_de OR p_ate >= (p_de + interval '13 months')::date THEN
    RAISE EXCEPTION 'período inválido: no máximo 13 meses' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.role', 'worker', true);
  PERFORM set_config('app.patient_id', '', true);
  RETURN QUERY
    SELECT u.patient_id, u.retorno_previsto_em
      FROM (
        SELECT DISTINCT ON (c.patient_id) c.patient_id, c.retorno_previsto_em
          FROM public.consultations c
          JOIN public.patients p ON p.tenant_id = c.tenant_id AND p.id = c.patient_id
         WHERE c.tenant_id = v_tenant AND c.retorno_previsto_em IS NOT NULL
           AND p.status <> 'bloqueado' AND p.anonimizado_em IS NULL
         ORDER BY c.patient_id, c.data DESC, c.created_at DESC, c.id DESC
      ) u
     WHERE u.retorno_previsto_em BETWEEN p_de AND p_ate
     ORDER BY u.retorno_previsto_em, u.patient_id;
  PERFORM set_config('app.role', v_role, true);
  PERFORM set_config('app.patient_id', v_patient, true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_previsoes_de_retorno(date, date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_previsoes_de_retorno(date, date) TO nutri_app_role;
--> statement-breakpoint
-- RE-D62: a consulta tem atendimento ligado? Só o booleano, só de consulta do tenant com paciente visível; nulo quando a
-- consulta não é achada (outro tenant, paciente escondido, id inexistente) ou o papel não é da equipe. Chamada pelo gatilho
-- appointments_da_recepcao (que recusa o nulo) e por registrarPresenca na sessão da recepção (T10).
CREATE OR REPLACE FUNCTION app_consulta_tem_atendimento(p_appointment uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := current_setting('app.role', true);
  v_patient text := coalesce(current_setting('app.patient_id', true), '');
  v_tenant uuid := public.app_current_tenant();
  v_tem boolean;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('nutri', 'recepcao') OR v_tenant IS NULL OR p_appointment IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('app.role', 'worker', true);
  PERFORM set_config('app.patient_id', '', true);
  SELECT EXISTS (SELECT 1 FROM public.consultations c WHERE c.tenant_id = a.tenant_id AND c.appointment_id = a.id)
    INTO v_tem
    FROM public.appointments a
    JOIN public.patients p ON p.tenant_id = a.tenant_id AND p.id = a.patient_id
   WHERE a.tenant_id = v_tenant AND a.id = p_appointment AND p.status <> 'bloqueado' AND p.anonimizado_em IS NULL;
  PERFORM set_config('app.role', v_role, true);
  PERFORM set_config('app.patient_id', v_patient, true);
  RETURN v_tem;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_consulta_tem_atendimento(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_consulta_tem_atendimento(uuid) TO nutri_app_role;
--> statement-breakpoint
-- RE-D71 (portão do PR 2; regras 2 e 3 do CLAUDE.md): o CPF já está em OUTRO cadastro do consultório? Só sim/não, de qualquer
-- paciente — bloqueado também, que a recepção não vê pela RLS (recepcao_cond_paciente_visivel) — e nunca o de p_patient. Sem
-- ela, a conferência da recepção não acharia o cadastro do bloqueado e o INSERT cairia no índice patient_cadastro_cpf_unico
-- (o 23505 leva o CPF ao log do Postgres). Chamada por conferirCpf (src/modules/pacientes/cadastro.ts) na sessão da recepção,
-- sob a mesma trava consultiva por consultório e CPF. Nulo fora da equipe ou sem CPF (quem chama trata como recusa).
CREATE OR REPLACE FUNCTION app_cpf_em_uso(p_cpf text, p_patient uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := current_setting('app.role', true);
  v_patient text := coalesce(current_setting('app.patient_id', true), '');
  v_tenant uuid := public.app_current_tenant();
  v_em_uso boolean;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('nutri', 'recepcao') OR v_tenant IS NULL OR p_cpf IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('app.role', 'worker', true);
  PERFORM set_config('app.patient_id', '', true);
  v_em_uso := EXISTS (
    SELECT 1 FROM public.patient_cadastro c
     WHERE c.tenant_id = v_tenant AND c.cpf = p_cpf AND c.patient_id IS DISTINCT FROM p_patient);
  PERFORM set_config('app.role', v_role, true);
  PERFORM set_config('app.patient_id', v_patient, true);
  RETURN v_em_uso;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_cpf_em_uso(text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_cpf_em_uso(text, uuid) TO nutri_app_role;
