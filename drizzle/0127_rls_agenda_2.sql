-- Plano 23 (spec Agenda 2 §9.1, §9.4, §9.7, §9.9; RN-425, RN-433; AG-D4, AG-D61, AG-D64). CLAUDE.md regras 1, 2 e 8.
-- Uma custom só, colada de novo a cada regeneração (sessoes-paralelas.md §5), nesta ordem: RLS das tabelas novas e
-- aguardando_fora_do_publico; funções SECURITY DEFINER (molde 0083); gatilhos; anonimização; locais iniciais e backfill
-- das regras (bloco P23-BACKFILL, molde 0042); CREATE OR REPLACE das métricas (0059, 0087).
--
-- Locais (AG-D4): staff_only — o link da sala nunca chega ao paciente nem ao público; sem app_allow_publico (fora de
-- PUBLICO_LIBERADO): o portal e a página pública leem só pelas projeções app_locais_para_agendamento/app_local_da_consulta.
SELECT app_enable_tenant_rls('locais_atendimento');
--> statement-breakpoint
SELECT app_enable_staff_only('locais_atendimento');
--> statement-breakpoint
-- Autorização de aniversário (RN-433): o paciente lê as próprias linhas (sem staff_only) e só INSERE a própria autorização
-- ou retirada — no app, com a própria conta; pelo link do e-mail (sem conta, N7), só a retirada, sem autor (o link de saída
-- nunca dá consentimento). Sempre o próprio patient_id (patient_isolation). Molde: paciente_autorizacao_propria (0108).
SELECT app_enable_tenant_rls('aniversario_autorizacoes');
--> statement-breakpoint
SELECT app_enable_patient_rls('aniversario_autorizacoes');
--> statement-breakpoint
SELECT app_allow_paciente_escrita('aniversario_autorizacoes', 'insert');
--> statement-breakpoint
CREATE POLICY paciente_aniversario_proprio ON aniversario_autorizacoes AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR (
    (origem = 'app' AND registrado_por IS NOT NULL AND registrado_por = app_current_user())
    OR (origem = 'link' AND evento = 'retirou' AND registrado_por IS NULL AND app_current_user() IS NULL)));
--> statement-breakpoint
-- Prova só de inclusão (como ia_autorizacoes e consents): nenhum papel do app altera nem apaga.
REVOKE UPDATE, DELETE, TRUNCATE ON aniversario_autorizacoes FROM nutri_app_role;
--> statement-breakpoint
-- RN-425 / RN-424a: o pedido aguardando da pessoa nova some para o publico e só app_pedido_aguardar o grava. FOR ALL, não
-- só FOR SELECT: a política de SELECT só confere a linha nova quando o comando precisa ler (UPDATE com WHERE, INSERT …
-- RETURNING); um INSERT sem RETURNING ou um UPDATE sem WHERE passariam. O USING esconde o aguardando no SELECT, no
-- SELECT … FOR UPDATE e no UPDATE; o WITH CHECK recusa a linha nova aguardando (ou resolvida) em todo INSERT e UPDATE do
-- publico. O local escolhido na página (local_id) continua livre. O nome NÃO começa com `publico` (AG-D64):
-- findPublicoViolations lê toda política `publico%` e, numa tabela de PUBLICO_LIBERADO, aceita só as publico_sem_<comando>.
CREATE POLICY aguardando_fora_do_publico ON public_booking_requests AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'publico' OR aguardando_desde IS NULL)
  WITH CHECK (app_current_role() IS DISTINCT FROM 'publico' OR (aguardando_desde IS NULL AND resolvido_em IS NULL AND resolucao IS NULL));
--> statement-breakpoint
-- Peças SECURITY DEFINER (spec §9.1, molde app_conteudo_por_etiqueta, 0083). O dono das tabelas é o migrator NOBYPASSRLS e a
-- RLS é FORCE: sem a troca, a função rodaria com o app.role de quem chamou e não veria nenhuma linha (locais_atendimento é
-- staff_only e publico_negado; o aguardando some do publico). Cada função guarda app.role e app.patient_id; fora do papel
-- esperado ou sem tenant devolve vazio; troca para `worker` sem paciente (set_config local à transação); filtra à mão pelo
-- tenant da sessão (e pelo paciente guardado, em app_local_da_consulta); devolve o contexto do chamador antes de retornar.
-- search_path fixo, nomes com public., EXECUTE só para o app.
--
-- AG-D4, AG-D62 (RN-406, RN-410a): todos os locais ativos do tenant, para o portal e a página pública escolherem; nunca a
-- sala (link_sala). Nome e cidade só dos que aceitam agendamento; endereço só com mostrar_endereco e agendamento. O local sem
-- agendamento vem só com o tipo, principal, agendamento_online e criado_em: a regra sem local é atribuída antes (RN-410a) e o
-- recorte por agendamento_online é do código, depois.
CREATE OR REPLACE FUNCTION app_locais_para_agendamento()
RETURNS TABLE (id uuid, nome text, tipo text, cidade text, endereco text, principal boolean, agendamento_online boolean, criado_em timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role text := current_setting('app.role', true);
  v_patient text := coalesce(current_setting('app.patient_id', true), '');
  v_tenant uuid := public.app_current_tenant();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('publico', 'paciente') OR v_tenant IS NULL THEN
    RETURN;
  END IF;
  PERFORM set_config('app.role', 'worker', true);
  PERFORM set_config('app.patient_id', '', true);
  RETURN QUERY
    SELECT l.id,
           CASE WHEN l.agendamento_online THEN l.nome END,
           l.tipo,
           CASE WHEN l.agendamento_online THEN l.cidade END,
           CASE WHEN l.agendamento_online AND l.mostrar_endereco THEN l.endereco END,
           l.principal, l.agendamento_online, l.created_at
      FROM public.locais_atendimento l
     WHERE l.tenant_id = v_tenant AND l.arquivado_em IS NULL
     ORDER BY l.principal DESC, l.created_at, l.id;
  PERFORM set_config('app.role', v_role, true);
  PERFORM set_config('app.patient_id', v_patient, true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_locais_para_agendamento() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_locais_para_agendamento() TO nutri_app_role;
--> statement-breakpoint
-- RN-406: o local de uma consulta do próprio paciente (sessão de paciente, com ou sem conta), para "Sua consulta" e o link
-- da consulta. Nunca a sala (o link da própria consulta online já está em appointments.link_online). O endereço vem mesmo sem
-- mostrar_endereco: é onde a consulta dele acontece (o e-mail da consulta já leva o endereço).
CREATE OR REPLACE FUNCTION app_local_da_consulta(p_consulta uuid)
RETURNS TABLE (nome text, tipo text, cidade text, endereco text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role text := current_setting('app.role', true);
  v_patient text := coalesce(current_setting('app.patient_id', true), '');
  v_tenant uuid := public.app_current_tenant();
BEGIN
  IF v_role IS DISTINCT FROM 'paciente' OR v_patient = '' OR v_tenant IS NULL OR p_consulta IS NULL THEN
    RETURN;
  END IF;
  PERFORM set_config('app.role', 'worker', true);
  PERFORM set_config('app.patient_id', '', true);
  RETURN QUERY
    SELECT l.nome, l.tipo, l.cidade, l.endereco
      FROM public.appointments a
      JOIN public.locais_atendimento l ON l.tenant_id = a.tenant_id AND l.id = a.local_id
     WHERE a.tenant_id = v_tenant AND a.id = p_consulta AND a.patient_id = v_patient::uuid;
  PERFORM set_config('app.role', v_role, true);
  PERFORM set_config('app.patient_id', v_patient, true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_local_da_consulta(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_local_da_consulta(uuid) TO nutri_app_role;
--> statement-breakpoint
-- RN-409 / RN-425 / AG-D58: os intervalos dos pedidos da pessoa nova aguardando a nutricionista, para os horários livres do
-- portal e da página pública (o publico não lê a linha aguardando; o paciente nem lê a tabela). Só tstzrange, sem dado pessoal.
-- Papéis publico e paciente; nutri e worker leem a tabela direto.
CREATE OR REPLACE FUNCTION app_pedidos_aguardando(p_de timestamptz, p_ate timestamptz)
RETURNS SETOF tstzrange
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := current_setting('app.role', true);
  v_patient text := coalesce(current_setting('app.patient_id', true), '');
  v_tenant uuid := public.app_current_tenant();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('publico', 'paciente') OR v_tenant IS NULL OR p_de IS NULL OR p_ate IS NULL THEN
    RETURN;
  END IF;
  PERFORM set_config('app.role', 'worker', true);
  PERFORM set_config('app.patient_id', '', true);
  RETURN QUERY
    SELECT tstzrange(b.inicio, b.fim, '[)')
      FROM public.public_booking_requests b
     WHERE b.tenant_id = v_tenant AND b.aguardando_desde IS NOT NULL AND b.resolvido_em IS NULL
       AND b.inicio < p_ate AND b.fim > p_de
     ORDER BY b.inicio;
  PERFORM set_config('app.role', v_role, true);
  PERFORM set_config('app.patient_id', v_patient, true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_pedidos_aguardando(timestamptz, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_pedidos_aguardando(timestamptz, timestamptz) TO nutri_app_role;
--> statement-breakpoint
-- RN-424 / RN-425: o pedido da pessoa nova passa a aguardar a nutricionista — gravado só aqui (aguardando_fora_do_publico
-- recusa o INSERT e o UPDATE diretos do publico). Só no papel publico, sob a trava do tenant (classe própria, ordem e-mail →
-- tenant → pedido), antes de ler. `invalido`: pedido de outro tenant ou inexistente, sem código válido (verificado_em há
-- mais de 30 min; exatamente 30 min ainda vale — a mesma regra de verificadoValido em agendamento-publico.ts,
-- `agora - verificadoEm <= VERIFICADO_VALIDADE_MS`: mudou lá, muda aqui), já aguardando ou concluído, ou local que não é ativo
-- com agendamento pelo paciente neste tenant. Depois, nesta ordem: `teto_tenant` (20 aguardando no consultório), `email` (1 por
-- e-mail) e `ocupado` (o mesmo que horariosLivres tira: sobreposição com toda consulta não cancelada — o recorte do EXCLUDE
-- appointments_sem_sobreposicao, inclusive realizada, faltou e solicitada —, com um bloqueio de availability_blocks e com
-- outro aguardando). Grava local, modalidade = tipo do local (a FK composta recusaria outra), início, fim e aguardando_desde.
CREATE OR REPLACE FUNCTION app_pedido_aguardar(p_pedido uuid, p_local uuid, p_inicio timestamptz, p_fim timestamptz)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := current_setting('app.role', true);
  v_patient text := coalesce(current_setting('app.patient_id', true), '');
  v_tenant uuid := public.app_current_tenant();
  v_pedido record;
  v_tipo text;
  v_res text;
BEGIN
  IF v_role IS DISTINCT FROM 'publico' OR v_tenant IS NULL OR p_pedido IS NULL OR p_local IS NULL
     OR p_inicio IS NULL OR p_fim IS NULL OR p_fim <= p_inicio THEN
    RETURN 'invalido';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('agenda-pedidos-tenant'), hashtext(v_tenant::text));
  PERFORM set_config('app.role', 'worker', true);
  PERFORM set_config('app.patient_id', '', true);
  <<corpo>>
  BEGIN
    SELECT b.email, b.verificado_em, b.concluido_em, b.aguardando_desde INTO v_pedido
      FROM public.public_booking_requests b
     WHERE b.tenant_id = v_tenant AND b.id = p_pedido
       FOR UPDATE;
    IF NOT FOUND OR v_pedido.verificado_em IS NULL OR now() - v_pedido.verificado_em > interval '30 minutes'
       OR v_pedido.concluido_em IS NOT NULL OR v_pedido.aguardando_desde IS NOT NULL THEN
      v_res := 'invalido';
      EXIT corpo;
    END IF;
    SELECT l.tipo INTO v_tipo
      FROM public.locais_atendimento l
     WHERE l.tenant_id = v_tenant AND l.id = p_local AND l.arquivado_em IS NULL AND l.agendamento_online;
    IF NOT FOUND THEN
      v_res := 'invalido';
      EXIT corpo;
    END IF;
    IF (SELECT count(*) FROM public.public_booking_requests b
         WHERE b.tenant_id = v_tenant AND b.aguardando_desde IS NOT NULL AND b.resolvido_em IS NULL) >= 20 THEN
      v_res := 'teto_tenant';
      EXIT corpo;
    END IF;
    IF EXISTS (SELECT 1 FROM public.public_booking_requests b
                WHERE b.tenant_id = v_tenant AND b.aguardando_desde IS NOT NULL AND b.resolvido_em IS NULL
                  AND lower(b.email) = lower(v_pedido.email)) THEN
      v_res := 'email';
      EXIT corpo;
    END IF;
    IF EXISTS (SELECT 1 FROM public.appointments a
                WHERE a.tenant_id = v_tenant AND a.status <> 'cancelada'
                  AND a.inicio < p_fim AND a.fim > p_inicio)
       OR EXISTS (SELECT 1 FROM public.availability_blocks k
                   WHERE k.tenant_id = v_tenant AND k.inicio < p_fim AND k.fim > p_inicio)
       OR EXISTS (SELECT 1 FROM public.public_booking_requests b
                   WHERE b.tenant_id = v_tenant AND b.aguardando_desde IS NOT NULL AND b.resolvido_em IS NULL
                     AND b.inicio < p_fim AND b.fim > p_inicio) THEN
      v_res := 'ocupado';
      EXIT corpo;
    END IF;
    UPDATE public.public_booking_requests b
       SET local_id = p_local, modalidade = v_tipo, inicio = p_inicio, fim = p_fim, aguardando_desde = now()
     WHERE b.tenant_id = v_tenant AND b.id = p_pedido;
    v_res := 'ok';
  END corpo;
  PERFORM set_config('app.role', v_role, true);
  PERFORM set_config('app.patient_id', v_patient, true);
  RETURN v_res;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_pedido_aguardar(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_pedido_aguardar(uuid, uuid, timestamptz, timestamptz) TO nutri_app_role;
--> statement-breakpoint
-- AG-D42 / AG-D48 / AG-D63: a pessoa nova desiste do pedido aguardando pelo link do e-mail (papel publico, que não lê a
-- linha), com o hash do token do próprio pedido, sob a trava do tenant e da linha (RN-427a). Com p_confirmar falso só mostra
-- (GET: leitores de link não gravam); com verdadeiro grava resolvido_em + resolucao = 'desistido'. `estado`: `aguardando`,
-- `cancelado` (gravou agora, ou já tinha desistido) ou `invalido` (não existe, sem aguardar, aceito, recusado, vencido — também
-- o vencido ainda não processado: começa antes da antecedência, RN-427). `gravou` e o primeiro nome (para o aviso à
-- nutricionista) só na chamada que gravou: F5, duplo clique e o provedor que reabre o link não repetem o aviso.
CREATE OR REPLACE FUNCTION app_pedido_publico_desistir(p_token_hash text, p_confirmar boolean)
RETURNS TABLE (estado text, inicio timestamptz, gravou boolean, primeiro_nome text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role text := current_setting('app.role', true);
  v_patient text := coalesce(current_setting('app.patient_id', true), '');
  v_tenant uuid := public.app_current_tenant();
  v_b record;
  v_achou boolean;
  v_antecedencia integer;
BEGIN
  IF v_role IS DISTINCT FROM 'publico' OR v_tenant IS NULL OR p_token_hash IS NULL THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('agenda-pedidos-tenant'), hashtext(v_tenant::text));
  PERFORM set_config('app.role', 'worker', true);
  PERFORM set_config('app.patient_id', '', true);
  estado := 'invalido';
  inicio := NULL;
  gravou := false;
  primeiro_nome := NULL;
  SELECT b.id, b.nome, b.inicio, b.aguardando_desde, b.resolucao INTO v_b
    FROM public.public_booking_requests b
   WHERE b.tenant_id = v_tenant AND b.token_hash = p_token_hash
     FOR UPDATE;
  v_achou := FOUND;
  SELECT t.antecedencia_min_h INTO v_antecedencia FROM public.tenants t WHERE t.id = v_tenant;
  IF v_achou AND v_b.aguardando_desde IS NOT NULL THEN
    IF v_b.resolucao IS NOT DISTINCT FROM 'desistido' THEN
      estado := 'cancelado';
      inicio := v_b.inicio;
    ELSIF v_b.resolucao IS NULL AND v_b.inicio - make_interval(hours => coalesce(v_antecedencia, 0)) > now() THEN
      inicio := v_b.inicio;
      IF coalesce(p_confirmar, false) THEN
        UPDATE public.public_booking_requests b SET resolvido_em = now(), resolucao = 'desistido'
         WHERE b.tenant_id = v_tenant AND b.id = v_b.id;
        estado := 'cancelado';
        gravou := true;
        primeiro_nome := split_part(btrim(v_b.nome), ' ', 1);
      ELSE
        estado := 'aguardando';
      END IF;
    END IF;
  END IF;
  PERFORM set_config('app.role', v_role, true);
  PERFORM set_config('app.patient_id', v_patient, true);
  RETURN NEXT;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_pedido_publico_desistir(text, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_pedido_publico_desistir(text, boolean) TO nutri_app_role;
--> statement-breakpoint
-- RN-421 / RN-422 (spec §9.2; AG-D17, AG-D24, AG-D44): o pedido do paciente é a consulta `solicitada`, decidida aqui.
-- INSERT: na sessão `paciente` ou `publico` o status é do banco — `solicitada` com a chave ligada, `agendada` com ela
-- desligada ou na remarcação (o marcador local app.agenda_remarcavel aponta para a consulta de origem, do mesmo paciente e
-- consultório; limpo no uso: uma remarcação por cancelamento). Nas sessões `nutri` e `worker` nunca nasce `solicitada`.
-- UPDATE: nenhum leva a `solicitada`; de `solicitada`, só o aceite (nutri) ou o cancelamento com o par papel × motivo da
-- RN-422 (pedido_vencido só com o prazo vencido: o processo web também usa o papel worker; sistema só com o titular já
-- bloqueado, exclusão LGPD); horário, local, modalidade e paciente do pedido não mudam; os motivos de pedido só saindo de
-- `solicitada`. O marcador é gravado aqui, só no cancelamento de agendada/confirmada pelo próprio paciente na sessão dele
-- (pedido_desistido nunca o liga) de consulta que ainda não começou; set_config local: some com o ROLLBACK TO SAVEPOINT e
-- vale depois do RELEASE. Na sessão `paciente` (UPDATE de todas as colunas da própria consulta, 0070): horário, local,
-- modalidade, link, origem, remarcada_de e presença fixos; encerrada (cancelada, realizada, faltou) não muda; só agendada →
-- confirmada, agendada|confirmada → cancelada (paciente) e solicitada → cancelada (pedido_desistido).
-- No contexto vazio (migration, seed) só valem as regras de dado do UPDATE. Recusa com 42501, como a RLS.
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
    IF r <> '' AND NEW.status IS NOT DISTINCT FROM 'agendada' AND r IS DISTINCT FROM 'nutri' THEN
      RAISE EXCEPTION 'só a nutricionista aceita o pedido' USING ERRCODE = '42501';
    END IF;
    IF r <> '' AND NEW.status IS NOT DISTINCT FROM 'cancelada' THEN
      IF (r, NEW.cancelado_por) IS NOT DISTINCT FROM ('paciente'::text, 'pedido_desistido'::text)
         OR (r, NEW.cancelado_por) IS NOT DISTINCT FROM ('nutri'::text, 'pedido_recusado'::text) THEN
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
CREATE TRIGGER appointments_regras_pedido BEFORE INSERT OR UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION app_appointments_regras_pedido();
--> statement-breakpoint
-- RN-406 / AG-D4 (spec §9.1): a sala do local entra na consulta pelo banco, não pelo código. BEFORE INSERT e BEFORE UPDATE
-- OF local_id, SECURITY DEFINER (molde 0083: o paciente e o publico não leem locais_atendimento). No UPDATE só age quando o
-- local muda (consulta movida para outro local: a sala do local novo vale como no INSERT); a troca da sala no próprio local
-- não mexe nas consultas (tela de locais, T2). Consulta sem local (imagem anterior ao PR 2: o código manda o link_online)
-- passa intacta, antes da troca de papel. Com local: em QUALQUER papel, na consulta de origem `paciente` num local online,
-- link_online := link_sala (o que o código mandou é ignorado; o aceite da pessoa nova roda na sessão nutri com origem
-- paciente) — só quando o local tem sala: num local online sem sala fica o link que o código mandou, e o CHECK
-- appointments_link_online decide. Só nas sessões paciente e publico, recusa (42501) local arquivado ou sem agendamento pelo
-- paciente (o módulo traduz para "Esse horário não está mais disponível"). O local é procurado no tenant da linha (e no da sessão, quando há
-- sessão): a FK composta recusa local de outro consultório. O contexto volta antes do RETURN e do RAISE. Dispara antes de
-- appointments_regras_pedido (ordem alfabética); o CHECK appointments_link_online vem depois dos BEFORE.
CREATE OR REPLACE FUNCTION app_appointments_link_da_sala() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_patient text;
  v_tenant uuid;
  v_local record;
  v_achou boolean;
BEGIN
  IF NEW.local_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.local_id IS NOT DISTINCT FROM OLD.local_id) THEN
    RETURN NEW;
  END IF;
  v_role := coalesce(current_setting('app.role', true), '');
  v_patient := coalesce(current_setting('app.patient_id', true), '');
  v_tenant := public.app_current_tenant();
  PERFORM set_config('app.role', 'worker', true);
  PERFORM set_config('app.patient_id', '', true);
  SELECT l.tipo, l.link_sala, l.agendamento_online, l.arquivado_em INTO v_local
    FROM public.locais_atendimento l
   WHERE l.tenant_id = NEW.tenant_id AND (v_tenant IS NULL OR l.tenant_id = v_tenant) AND l.id = NEW.local_id;
  v_achou := FOUND;
  PERFORM set_config('app.role', v_role, true);
  PERFORM set_config('app.patient_id', v_patient, true);
  IF NOT v_achou THEN
    RETURN NEW; -- a FK composta recusa
  END IF;
  IF NEW.origem IS NOT DISTINCT FROM 'paciente' AND v_local.tipo = 'online' THEN
    NEW.link_online := coalesce(v_local.link_sala, NEW.link_online);
  END IF;
  IF v_role IN ('paciente', 'publico') AND (v_local.arquivado_em IS NOT NULL OR NOT v_local.agendamento_online) THEN
    RAISE EXCEPTION 'o local não aceita agendamento pelo paciente' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- função de gatilho: ninguém a chama direto (o gatilho dispara sem EXECUTE de quem grava)
REVOKE ALL ON FUNCTION app_appointments_link_da_sala() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER appointments_link_da_sala BEFORE INSERT OR UPDATE OF local_id ON appointments FOR EACH ROW EXECUTE FUNCTION app_appointments_link_da_sala();
--> statement-breakpoint
-- RN-420: a chave dos pedidos só muda na sessão `nutri` (molde tenants_ia_nutri_da_equipe, 0116): paciente, público, conta e
-- worker (o processo web também usa o papel worker: página pública, limpeza) recebem 42501. O contexto vazio (migration, semente,
-- admin fora de withTenant) passa.
CREATE OR REPLACE FUNCTION app_tenants_agenda_da_equipe() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF coalesce(public.app_current_role(), '') NOT IN ('', 'nutri')
     AND NEW.agenda_confirmar_pedidos IS DISTINCT FROM OLD.agenda_confirmar_pedidos THEN
    RAISE EXCEPTION 'só a nutricionista muda a confirmação dos pedidos' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER tenants_agenda_da_equipe BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION app_tenants_agenda_da_equipe();
--> statement-breakpoint
-- RN-433 / AG-D61 (spec §9.7; molde ia_autorizacoes_regras, 0108): registrado_em pelo relógio do banco, depois da trava do
-- paciente que o módulo faz; a sessão nutri só registra pela origem nutri, em nome da própria usuária; o worker não registra;
-- `autorizou` só de titular ativo e não anonimizado — procurado com a RLS de quem grava: o titular invisível (outro
-- consultório, outro paciente) passa e a RLS recusa. Nos papéis publico, conta e paciente o gatilho não recusa por origem nem
-- por autoria: a RLS recusa (publico_negado, tenant_isolation, paciente_aniversario_proprio), com a mensagem de RLS que os
-- testes de isolamento esperam. No contexto vazio (migration, seed) só valem as regras de dado. Recusa com 42501.
CREATE OR REPLACE FUNCTION app_aniversario_autorizacoes_regras() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(public.app_current_role(), '');
  pt record;
BEGIN
  NEW.registrado_em := clock_timestamp();
  IF r = 'worker' THEN
    RAISE EXCEPTION 'o worker não registra autorização de aniversário' USING ERRCODE = '42501';
  END IF;
  IF r = 'nutri' THEN
    IF NEW.origem IS DISTINCT FROM 'nutri' THEN
      RAISE EXCEPTION 'a equipe registra só pela origem nutri' USING ERRCODE = '42501';
    END IF;
    IF NEW.registrado_por IS NULL OR NEW.registrado_por IS DISTINCT FROM public.app_current_user() THEN
      RAISE EXCEPTION 'a equipe registra só em nome da própria usuária' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.evento IS NOT DISTINCT FROM 'autorizou' THEN
    SELECT p.status, p.anonimizado_em INTO pt FROM public.patients p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.patient_id;
    IF FOUND AND (pt.status IS DISTINCT FROM 'ativo' OR pt.anonimizado_em IS NOT NULL) THEN
      RAISE EXCEPTION 'só o titular ativo autoriza a mensagem de aniversário' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aniversario_autorizacoes_regras BEFORE INSERT ON aniversario_autorizacoes FOR EACH ROW EXECUTE FUNCTION app_aniversario_autorizacoes_regras();
--> statement-breakpoint
-- RN-438 (spec §9.7; molde app_anonimizar_autorizacoes_ia, 0108, e app_anonimizar_aceites, 0065): na anonimização do titular,
-- anula só o registrado_por de origem `app` (a conta do paciente); o da nutricionista é autoria (ECF.17.01) e o do link já é
-- nulo. Só no contexto worker de um tenant, com o titular bloqueado à espera da anonimização (travado). UPDATE revogado do
-- app: só esta função altera a tabela.
CREATE OR REPLACE FUNCTION app_anonimizar_autorizacoes_aniversario(p_patient uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.app_current_tenant();
BEGIN
  IF v_tenant IS NULL OR public.app_current_role() IS DISTINCT FROM 'worker' THEN
    RAISE EXCEPTION 'app_anonimizar_autorizacoes_aniversario() só roda no contexto worker de um tenant' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.patients p
    WHERE p.id = p_patient AND p.tenant_id = v_tenant AND p.status = 'bloqueado' AND p.anonimizado_em IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'app_anonimizar_autorizacoes_aniversario(): o paciente não está bloqueado à espera da anonimização neste tenant' USING ERRCODE = '42501';
  END IF;
  UPDATE public.aniversario_autorizacoes
     SET registrado_por = NULL
   WHERE tenant_id = v_tenant AND patient_id = p_patient AND origem = 'app' AND registrado_por IS NOT NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_anonimizar_autorizacoes_aniversario(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_anonimizar_autorizacoes_aniversario(uuid) TO nutri_app_role;
--> statement-breakpoint
-- P23-BACKFILL início
-- Locais iniciais e regras com local (spec §9.1 e §9.3; AG-D6, AG-D40, AG-D47; molde NO FORCE … FORCE da 0042, sem auditoria:
-- locais e regras não têm patient_id). Idempotente — só tenant sem nenhum local e só regra com local_id nulo —, para o teste
-- (migrate-owner.test.ts) rodar o bloco de novo; garantirLocaisIniciais (locais.ts) aplica o mesmo depois do deploy.
-- Por tenant sem local: "Consultório" (presencial, endereço do perfil) quando há endereço, regra presencial ou "ambas", ou
-- nenhuma regra online; "Videoconferência" (online, sala = link padrão no formato do CHECK) quando há regra online ou "ambas",
-- ou link padrão; principal = o Consultório, se existir. agendamento_online = presencial ou com sala, sem olhar
-- agendamento_publico_ativo (AG-D40: o portal nunca dependeu da página pública). Regras (RN-410a): cada uma vai para o local
-- ativo do tipo (o principal primeiro, depois o mais antigo); "ambas" vira presencial e ganha a cópia online (AG-D47).
ALTER TABLE locais_atendimento NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE availability_rules NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
WITH alvo AS (
  SELECT t.id AS tenant_id,
         left(nullif(btrim(t.endereco_consultorio), ''), 300) AS endereco,
         CASE WHEN btrim(t.link_online_padrao) ~ '^https://\S+$' AND char_length(btrim(t.link_online_padrao)) <= 500
              THEN btrim(t.link_online_padrao) END AS sala,
         nullif(btrim(t.link_online_padrao), '') IS NOT NULL AS tem_link,
         EXISTS (SELECT 1 FROM availability_rules r WHERE r.tenant_id = t.id AND r.modalidade IN ('presencial', 'ambas')) AS regra_presencial,
         EXISTS (SELECT 1 FROM availability_rules r WHERE r.tenant_id = t.id AND r.modalidade IN ('online', 'ambas')) AS regra_online,
         EXISTS (SELECT 1 FROM availability_rules r WHERE r.tenant_id = t.id AND r.modalidade = 'online') AS so_online
    FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM locais_atendimento l WHERE l.tenant_id = t.id)
), decisao AS (
  SELECT a.*, (a.endereco IS NOT NULL OR a.regra_presencial OR NOT a.so_online) AS consultorio,
         (a.regra_online OR a.tem_link) AS videoconferencia
    FROM alvo a
)
INSERT INTO locais_atendimento (tenant_id, nome, tipo, endereco, link_sala, agendamento_online, principal)
SELECT d.tenant_id, 'Consultório', 'presencial', d.endereco, NULL, true, true FROM decisao d WHERE d.consultorio
UNION ALL
SELECT d.tenant_id, 'Videoconferência', 'online', NULL, d.sala, d.sala IS NOT NULL, NOT d.consultorio FROM decisao d WHERE d.videoconferencia;
--> statement-breakpoint
-- "ambas" com os dois tipos de local: a cópia online (a original vira presencial logo abaixo)
WITH presencial AS (
  SELECT DISTINCT ON (l.tenant_id) l.tenant_id, l.id FROM locais_atendimento l
   WHERE l.tipo = 'presencial' AND l.arquivado_em IS NULL ORDER BY l.tenant_id, l.principal DESC, l.created_at, l.id
), online AS (
  SELECT DISTINCT ON (l.tenant_id) l.tenant_id, l.id FROM locais_atendimento l
   WHERE l.tipo = 'online' AND l.arquivado_em IS NULL ORDER BY l.tenant_id, l.principal DESC, l.created_at, l.id
)
INSERT INTO availability_rules (tenant_id, dia_semana, inicio, fim, duracao_min, modalidade, local_id, created_at, updated_at)
SELECT r.tenant_id, r.dia_semana, r.inicio, r.fim, r.duracao_min, 'online', o.id, r.created_at, now()
  FROM availability_rules r
  JOIN presencial p ON p.tenant_id = r.tenant_id
  JOIN online o ON o.tenant_id = r.tenant_id
 WHERE r.local_id IS NULL AND r.modalidade = 'ambas';
--> statement-breakpoint
WITH presencial AS (
  SELECT DISTINCT ON (l.tenant_id) l.tenant_id, l.id FROM locais_atendimento l
   WHERE l.tipo = 'presencial' AND l.arquivado_em IS NULL ORDER BY l.tenant_id, l.principal DESC, l.created_at, l.id
)
UPDATE availability_rules r SET modalidade = 'presencial', local_id = p.id, updated_at = now()
  FROM presencial p
 WHERE p.tenant_id = r.tenant_id AND r.local_id IS NULL AND r.modalidade IN ('presencial', 'ambas');
--> statement-breakpoint
-- o que sobrou: online, e "ambas" de consultório sem local presencial (vira online)
WITH online AS (
  SELECT DISTINCT ON (l.tenant_id) l.tenant_id, l.id FROM locais_atendimento l
   WHERE l.tipo = 'online' AND l.arquivado_em IS NULL ORDER BY l.tenant_id, l.principal DESC, l.created_at, l.id
)
UPDATE availability_rules r SET modalidade = 'online', local_id = o.id, updated_at = now()
  FROM online o
 WHERE o.tenant_id = r.tenant_id AND r.local_id IS NULL AND r.modalidade IN ('online', 'ambas');
--> statement-breakpoint
ALTER TABLE availability_rules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE locais_atendimento FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- P23-BACKFILL fim
-- R-410 (RN-423): a consulta `solicitada` (pedido ainda sem resposta) não conta nas métricas do admin. Corpo copiado da `main`
-- (0059 e 0087) na regeneração — se a main mudou alguma das duas, copiar de novo antes de gerar (§5 de sessoes-paralelas.md);
-- só muda `<> 'cancelada'` para `NOT IN ('cancelada', 'solicitada')`. CREATE OR REPLACE mantém dono e privilégios.
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
      WHERE a.tenant_id = t.id AND a.status NOT IN ('cancelada', 'solicitada') AND a.inicio >= v_inicio_mes AND a.inicio < v_fim_mes;
    SELECT count(*) INTO mensagens_whatsapp_mes FROM public.notifications n
      WHERE n.tenant_id = t.id AND n.canal = 'whatsapp' AND n.tipo IN ('lembrete_24h', 'lembrete_2h', 'convite_paciente')
        AND n.enviada_em >= v_inicio_mes AND n.enviada_em < v_fim_mes;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.role', '', true);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION admin_metricas_sucesso()
RETURNS TABLE (tenant_id uuid, pacientes_com_conta bigint, abriram_7_dias bigint, faltas_mes bigint, iniciadas_mes bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  t record;
  v_hoje date;
  v_inicio_mes timestamptz;
BEGIN
  IF coalesce(current_setting('app.tenant_id', true), '') <> '' THEN
    RAISE EXCEPTION 'admin_metricas_sucesso() não pode rodar dentro de withTenant' USING ERRCODE = '55000';
  END IF;
  FOR t IN SELECT tn.id, tn.fuso FROM public.tenants tn ORDER BY tn.created_at LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    PERFORM set_config('app.role', 'worker', true);
    PERFORM set_config('app.patient_id', '', true);
    v_hoje := (now() AT TIME ZONE t.fuso)::date;
    v_inicio_mes := date_trunc('month', now() AT TIME ZONE t.fuso) AT TIME ZONE t.fuso;
    tenant_id := t.id;
    SELECT count(*),
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.access_events e WHERE e.tenant_id = p.tenant_id AND e.patient_id = p.id AND e.dia >= v_hoje - 6))
      INTO pacientes_com_conta, abriram_7_dias
      FROM public.patients p
     WHERE p.tenant_id = t.id AND p.status = 'ativo' AND p.user_id IS NOT NULL AND p.anonimizado_em IS NULL;
    SELECT count(*) FILTER (WHERE a.status = 'faltou'), count(*) FILTER (WHERE a.status NOT IN ('cancelada', 'solicitada'))
      INTO faltas_mes, iniciadas_mes
      FROM public.appointments a
     WHERE a.tenant_id = t.id AND a.inicio >= v_inicio_mes AND a.inicio <= now();
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.role', '', true);
END $$;
