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
  r text := coalesce(app_current_role(), '');
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
           SELECT 1 FROM appointments o
            WHERE o.id = NEW.remarcada_de AND o.tenant_id = NEW.tenant_id AND o.patient_id = NEW.patient_id) THEN
        PERFORM set_config('app.agenda_remarcavel', '', true);
        NEW.status := 'agendada';
        RETURN NEW;
      END IF;
      SELECT t.agenda_confirmar_pedidos INTO chave FROM tenants t WHERE t.id = NEW.tenant_id;
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
        SELECT t.antecedencia_min_h INTO antecedencia FROM tenants t WHERE t.id = OLD.tenant_id;
        IF antecedencia IS NULL OR OLD.inicio - make_interval(hours => antecedencia) > now() THEN
          RAISE EXCEPTION 'o pedido ainda está no prazo de resposta' USING ERRCODE = '42501';
        END IF;
      ELSIF (r, NEW.cancelado_por) IS NOT DISTINCT FROM ('nutri'::text, 'sistema'::text) THEN
        SELECT pt.status INTO titular FROM patients pt WHERE pt.tenant_id = OLD.tenant_id AND pt.id = OLD.patient_id;
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
-- RN-420: a chave dos pedidos não muda nas sessões de paciente, público e conta (molde tenants_ia_nutri_da_equipe, 0116).
CREATE OR REPLACE FUNCTION app_tenants_agenda_da_equipe() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF app_current_role() IN ('paciente', 'publico', 'conta')
     AND NEW.agenda_confirmar_pedidos IS DISTINCT FROM OLD.agenda_confirmar_pedidos THEN
    RAISE EXCEPTION 'só a equipe muda a confirmação dos pedidos' USING ERRCODE = '42501';
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
  r text := coalesce(app_current_role(), '');
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
    IF NEW.registrado_por IS NULL OR NEW.registrado_por IS DISTINCT FROM app_current_user() THEN
      RAISE EXCEPTION 'a equipe registra só em nome da própria usuária' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.evento IS NOT DISTINCT FROM 'autorizou' THEN
    SELECT p.status, p.anonimizado_em INTO pt FROM patients p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.patient_id;
    IF FOUND AND (pt.status IS DISTINCT FROM 'ativo' OR pt.anonimizado_em IS NOT NULL) THEN
      RAISE EXCEPTION 'só o titular ativo autoriza a mensagem de aniversário' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aniversario_autorizacoes_regras BEFORE INSERT ON aniversario_autorizacoes FOR EACH ROW EXECUTE FUNCTION app_aniversario_autorizacoes_regras();
