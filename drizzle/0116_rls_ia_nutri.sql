-- Plano 15 (spec F3-02 v0.4 §13.1, §13.2, RNF-163, RNF-164). CLAUDE.md regras 2 e 8.
SELECT app_enable_tenant_rls('ia_nutri_participacoes');
--> statement-breakpoint
SELECT app_enable_patient_rls('ia_nutri_participacoes');
--> statement-breakpoint
-- RN-183: entidade própria (com `ia_nutri`, a liberação apareceria como conversa)
SELECT app_enable_audit('ia_nutri_participacoes', 'ia_nutri_liberacao');
--> statement-breakpoint
SELECT app_enable_tenant_rls('ia_nutri_mensagens');
--> statement-breakpoint
SELECT app_enable_patient_rls('ia_nutri_mensagens');
--> statement-breakpoint
SELECT app_enable_audit('ia_nutri_mensagens', 'ia_nutri');
--> statement-breakpoint
-- RNF-164: o paciente só ATUALIZA a própria mensagem (avaliacao, encaminhada_em — o gatilho abaixo confere as colunas);
-- INSERT só pela função app_ia_nutri_perguntar (0117), que troca o papel para worker (paciente_sem_insert continua)
SELECT app_allow_paciente_escrita('ia_nutri_mensagens', 'update');
--> statement-breakpoint
-- A resposta e a mensagem do sistema apontam para a pergunta do MESMO paciente; a retenção apaga a pergunta antes (SET NULL só da coluna)
ALTER TABLE ia_nutri_mensagens ADD CONSTRAINT ia_nutri_mensagens_responde_a_fk
  FOREIGN KEY (tenant_id, patient_id, responde_a) REFERENCES ia_nutri_mensagens (tenant_id, patient_id, id) ON DELETE SET NULL (responde_a);
--> statement-breakpoint
SELECT app_enable_tenant_rls('ia_nutri_consentimentos');
--> statement-breakpoint
SELECT app_enable_patient_rls('ia_nutri_consentimentos');
--> statement-breakpoint
-- RN-171: o paciente só INSERE o próprio aceite, no app, com a própria conta; a revogação é da função app_ia_nutri_revogar
SELECT app_allow_paciente_escrita('ia_nutri_consentimentos', 'insert');
--> statement-breakpoint
CREATE POLICY paciente_consentimento_proprio ON ia_nutri_consentimentos AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR (
    evento = 'aceite' AND canal = 'app' AND registrado_por IS NOT NULL AND registrado_por = app_current_user()));
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON ia_nutri_consentimentos FROM nutri_app_role;
--> statement-breakpoint
-- RN-171 / RN-182: registrado_em pelo relógio do banco; o aceite só da sessão de paciente (a política acima decide; a recusa
-- é erro de RLS); a revogação só com o marcador local app.ia_nutri_revogando = '1', ligado por app_ia_nutri_revogar — o papel
-- `worker` também roda no processo web (links, webhook), então "papel worker" não basta (diverge da 0108, que recusa o worker).
-- No contexto vazio (migration, seed) só valem as regras de dado.
CREATE OR REPLACE FUNCTION app_ia_nutri_consentimentos_regras() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
BEGIN
  NEW.registrado_em := clock_timestamp();
  IF r = 'paciente' THEN
    RETURN NEW;
  END IF;
  IF r <> '' AND NEW.evento = 'aceite' THEN
    RAISE EXCEPTION 'só o próprio paciente dá o consentimento da IA Nutri' USING ERRCODE = '42501';
  END IF;
  IF r <> '' AND NEW.evento = 'revogacao' AND current_setting('app.ia_nutri_revogando', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'a revogação da IA Nutri só pela função app_ia_nutri_revogar' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ia_nutri_consentimentos_regras BEFORE INSERT ON ia_nutri_consentimentos FOR EACH ROW EXECUTE FUNCTION app_ia_nutri_consentimentos_regras();
--> statement-breakpoint
-- RNF-164 / RN-109 (molde 0085, 0102 e app_ia_tarefas_imutavel): colunas fixas para todos; a sessão de paciente só muda
-- `avaliacao` (resposta `ia` com conteúdo, de nulo para um valor) e `encaminhada_em` (pergunta respondida ou que falhou,
-- sem risco, não revogada, com texto, de nulo para agora); a sessão `nutri` só abre e resolve a dúvida, em nome da própria
-- usuária — e aceita `responde_a` indo a nulo SÓ dentro da ação referencial: é o ON DELETE SET NULL (responde_a) da FK,
-- disparado quando a equipe apaga a pergunta com risco de quem revogou (D22) e a mensagem `sistema`/`ia` aponta para ela.
-- O UPDATE da ação referencial roda a partir do gatilho de RI (pg_trigger_depth() = 2 aqui); o `update … set responde_a =
-- null` direto da sessão `nutri` roda com profundidade 1 e é recusado (a equipe não desliga a resposta da pergunta, que o
-- histórico, a fila e a exportação leem por `responde_a`). Público e conta nada. O worker (e as funções da 0117, que trocam
-- o papel para worker) muda o resto.
CREATE OR REPLACE FUNCTION app_ia_nutri_mensagens_regras() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.autor, NEW.created_at, NEW.sessao_inicio)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.autor, OLD.created_at, OLD.sessao_inicio) THEN
    RAISE EXCEPTION 'coluna fixa da mensagem da IA Nutri' USING ERRCODE = '42501';
  END IF;
  IF OLD.saiu_em IS NOT NULL AND NEW.saiu_em IS DISTINCT FROM OLD.saiu_em THEN
    RAISE EXCEPTION 'a saída da pergunta ao provedor não é apagada nem reescrita' USING ERRCODE = '42501';
  END IF;
  IF OLD.destino IS NOT NULL AND NEW.destino IS DISTINCT FROM OLD.destino THEN
    RAISE EXCEPTION 'o destino da saída ao provedor não muda' USING ERRCODE = '42501';
  END IF;
  IF OLD.contou_no_limite AND NOT NEW.contou_no_limite THEN
    RAISE EXCEPTION 'o marcador do limite não volta' USING ERRCODE = '42501';
  END IF;
  IF r = 'paciente' THEN
    IF (to_jsonb(NEW) - 'avaliacao' - 'encaminhada_em' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'avaliacao' - 'encaminhada_em' - 'updated_at') THEN
      RAISE EXCEPTION 'o paciente só avalia a resposta e encaminha a pergunta' USING ERRCODE = '42501';
    END IF;
    IF NEW.avaliacao IS DISTINCT FROM OLD.avaliacao
       AND (OLD.autor <> 'ia' OR OLD.avaliacao IS NOT NULL OR NEW.avaliacao IS NULL OR (OLD.texto IS NULL AND OLD.texto_fixo IS NULL)) THEN
      RAISE EXCEPTION 'avaliação só uma vez, numa resposta da IA' USING ERRCODE = '42501';
    END IF;
    IF NEW.encaminhada_em IS DISTINCT FROM OLD.encaminhada_em
       AND (OLD.autor <> 'paciente' OR OLD.status NOT IN ('respondida', 'falhou') OR OLD.encaminhada_em IS NOT NULL
            OR OLD.risco IS NOT NULL OR OLD.revogada_em IS NOT NULL OR OLD.texto IS NULL OR NEW.encaminhada_em IS NULL
            OR abs(extract(epoch FROM NEW.encaminhada_em - clock_timestamp())) > 60) THEN
      RAISE EXCEPTION 'encaminhamento só da própria pergunta, uma vez' USING ERRCODE = '42501';
    END IF;
  ELSIF r = 'nutri' THEN
    -- D22: `responde_a` só vai a nulo, e só pelo SET NULL da FK (a pergunta apontada apagada pela equipe): profundidade > 1
    IF NEW.responde_a IS DISTINCT FROM OLD.responde_a AND (NEW.responde_a IS NOT NULL OR pg_trigger_depth() < 2) THEN
      RAISE EXCEPTION 'a equipe só abre e resolve a dúvida' USING ERRCODE = '42501';
    END IF;
    IF (to_jsonb(NEW) - 'aberta_pela_nutri_em' - 'resolvida_em' - 'resolvida_por' - 'resolucao' - 'responde_a' - 'updated_at')
       IS DISTINCT FROM (to_jsonb(OLD) - 'aberta_pela_nutri_em' - 'resolvida_em' - 'resolvida_por' - 'resolucao' - 'responde_a' - 'updated_at') THEN
      RAISE EXCEPTION 'a equipe só abre e resolve a dúvida' USING ERRCODE = '42501';
    END IF;
    IF (OLD.aberta_pela_nutri_em IS NOT NULL AND NEW.aberta_pela_nutri_em IS DISTINCT FROM OLD.aberta_pela_nutri_em)
       OR (OLD.resolvida_em IS NOT NULL AND (NEW.resolvida_em, NEW.resolvida_por, NEW.resolucao) IS DISTINCT FROM (OLD.resolvida_em, OLD.resolvida_por, OLD.resolucao))
       OR (OLD.resolvida_em IS NULL AND NEW.resolvida_em IS NOT NULL AND NEW.resolvida_por IS DISTINCT FROM app_current_user()) THEN
      RAISE EXCEPTION 'abrir e resolver só uma vez, em nome da usuária da sessão' USING ERRCODE = '42501';
    END IF;
  ELSIF r IN ('publico', 'conta') THEN
    RAISE EXCEPTION 'contexto sem escrita na IA Nutri' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ia_nutri_mensagens_regras BEFORE UPDATE ON ia_nutri_mensagens FOR EACH ROW EXECUTE FUNCTION app_ia_nutri_mensagens_regras();
--> statement-breakpoint
-- RN-182 / D22: DELETE só pelo worker (retenção, exclusão atendida, anonimização) e, na sessão `nutri`, só da pergunta com
-- risco de quem revogou, depois de aberta (D22: apagada ao abrir). O paciente nunca apaga (a revogação esvazia pela função).
CREATE OR REPLACE FUNCTION app_ia_nutri_mensagens_sem_apagar() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
BEGIN
  IF r IN ('', 'worker') THEN
    RETURN OLD;
  END IF;
  IF r = 'nutri' AND OLD.autor = 'paciente' AND OLD.risco IS NOT NULL AND OLD.revogada_em IS NOT NULL AND OLD.aberta_pela_nutri_em IS NOT NULL THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'mensagem da IA Nutri não é apagada por este caminho' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE TRIGGER ia_nutri_mensagens_sem_apagar BEFORE DELETE ON ia_nutri_mensagens FOR EACH ROW EXECUTE FUNCTION app_ia_nutri_mensagens_sem_apagar();
--> statement-breakpoint
-- RN-185 / DP-1: a pausa da plataforma (desligamento de emergência) só fora de withTenant (o painel do admin);
-- nasce NÃO pausada: a IA Nutri liga pela nutricionista (★ DO-1 = não, 14/10/2026)
REVOKE INSERT, DELETE, TRUNCATE ON ia_nutri_pausa FROM nutri_app_role;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_ia_nutri_pausa_da_admin() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF app_current_role() IS NOT NULL THEN
    RAISE EXCEPTION 'só a admin pausa ou retoma a IA Nutri' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ia_nutri_pausa_da_admin BEFORE UPDATE ON ia_nutri_pausa FOR EACH ROW EXECUTE FUNCTION app_ia_nutri_pausa_da_admin();
--> statement-breakpoint
INSERT INTO ia_nutri_pausa (id, pausada_em, pausada_por) VALUES (true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- 0100 + a cota da IA Nutri (D3: a sessão da nutricionista não aumenta a própria cota). O resto é o da 0100, linha a linha.
CREATE OR REPLACE FUNCTION app_tenants_interruptores_da_admin() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_current_role() IS NOT NULL
     AND (NEW.ia_liberada, NEW.ia_cota_mensal_usd, NEW.documentos_liberados, NEW.ia_nutri_cota_mensal_usd)
         IS DISTINCT FROM (OLD.ia_liberada, OLD.ia_cota_mensal_usd, OLD.documentos_liberados, OLD.ia_nutri_cota_mensal_usd) THEN
    RAISE EXCEPTION 'só a admin muda a liberação da IA, o limite de IA e a liberação dos documentos' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- §13.2: a ativação e as marcas de aviso da IA Nutri não mudam nas sessões de paciente, público e conta
CREATE OR REPLACE FUNCTION app_tenants_ia_nutri_da_equipe() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF app_current_role() IN ('paciente', 'publico', 'conta')
     AND (NEW.ia_nutri_ativada_em, NEW.ia_nutri_aviso_mes, NEW.ia_nutri_risco_aviso_em)
         IS DISTINCT FROM (OLD.ia_nutri_ativada_em, OLD.ia_nutri_aviso_mes, OLD.ia_nutri_risco_aviso_em) THEN
    RAISE EXCEPTION 'só a equipe e o worker mudam a IA Nutri do consultório' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER tenants_ia_nutri_da_equipe BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION app_tenants_ia_nutri_da_equipe();
