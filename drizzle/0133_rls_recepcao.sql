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
