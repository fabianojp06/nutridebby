-- Plano 25 (spec de mensagens e recados v0.3, §9.1–§9.6, §9.9). CLAUDE.md regras 2, 8 e 9. Ordem (plano, Task 1): RLS e
-- políticas, auditoria, REVOKE/GRANT e EXCLUDE (T1a); depois os gatilhos (T1b) e as funções SECURITY DEFINER (T1c), nos
-- marcadores do fim do arquivo.
SELECT app_enable_tenant_rls('chat_conversas');
--> statement-breakpoint
SELECT app_enable_patient_rls('chat_conversas');
--> statement-breakpoint
SELECT app_enable_tenant_rls('chat_mensagens');
--> statement-breakpoint
SELECT app_enable_patient_rls('chat_mensagens');
--> statement-breakpoint
SELECT app_enable_tenant_rls('chat_leituras');
--> statement-breakpoint
SELECT app_enable_patient_rls('chat_leituras');
--> statement-breakpoint
-- §9.4: sem patient_id; a sessão de paciente lê (o módulo projeta só horario_ativo e as faixas), a escrita é só da equipe
-- (paciente_sem_* do app_enable_tenant_rls)
SELECT app_enable_tenant_rls('chat_configuracoes');
--> statement-breakpoint
SELECT app_enable_tenant_rls('chat_horarios');
--> statement-breakpoint
-- CH-D70 (decisão da orquestradora, 23/11/2026): a preferência e a marca do aviso por e-mail à nutricionista (RN-458) ficam
-- numa tabela só da equipe — pela data da marca, o paciente saberia que outro paciente escreveu nas últimas 2 h. Sem
-- patient_id: sem patient_isolation e sem gatilho de auditoria. A sessão de paciente só chega à linha pela função
-- app_chat_aviso_nutri_devido (SECURITY DEFINER, troca de papel para o worker).
SELECT app_enable_tenant_rls('chat_avisos_nutri');
--> statement-breakpoint
SELECT app_enable_staff_only('chat_avisos_nutri');
--> statement-breakpoint
SELECT app_enable_tenant_rls('recados');
--> statement-breakpoint
-- §9.5 (RN-462): o recado e o filtro (etiquetas) são só da equipe; o paciente lê a cópia na própria conversa
SELECT app_enable_staff_only('recados');
--> statement-breakpoint
-- §9.1 / CH-D39: entidade neutra, fora da tela do Histórico de acessos — liberar, pausar e retomar aparecem pelo recordAudit
-- do módulo (chat_liberacao, chat_pausa, chat_retomada)
SELECT app_enable_audit('chat_conversas', 'chat_conversa');
--> statement-breakpoint
-- §9.3: chat_leituras fica sem gatilho de auditoria (marcador técnico, AUDIT_EXCEPTIONS); recados também (sem paciente; cada
-- cópia em chat_mensagens é auditada)
SELECT app_enable_audit('chat_mensagens', 'chat');
--> statement-breakpoint
-- §9.2 (US-443, RN-443, RN-445): o paciente só INSERE a própria mensagem de texto ou a foto em processamento, na própria
-- conversa liberada e não pausada, com o titular ativo e não anonimizado, em nome da própria conta, sem recado, sem dúvida,
-- sem anexo convertido nem nome de anexo; o original, se houver, é um chat_anexo_original DELE (sem isto a sessão de
-- paciente poderia apontar o arquivo de OUTRO paciente do tenant — a FK não passa pela RLS). Os EXISTS rodam sob a RLS da
-- própria sessão: conversa, titular e arquivo de outro paciente nem aparecem.
SELECT app_allow_paciente_escrita('chat_mensagens', 'insert');
--> statement-breakpoint
CREATE POLICY paciente_chat_envio ON chat_mensagens AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    app_current_role() IS DISTINCT FROM 'paciente'
    OR (autor = 'paciente' AND autor_user_id = app_current_user()
        AND recado_id IS NULL AND duvida_em IS NULL AND anexo_path IS NULL AND anexo_nome IS NULL
        AND anexo_status IN ('sem_anexo', 'processando')
        AND (anexo_original_path IS NULL
             OR EXISTS (SELECT 1 FROM stored_files f
                         WHERE f.tenant_id = chat_mensagens.tenant_id AND f.patient_id = chat_mensagens.patient_id
                           AND f.tipo = 'chat_anexo_original' AND f.caminho = chat_mensagens.anexo_original_path))
        AND EXISTS (SELECT 1 FROM chat_conversas c
                     WHERE c.tenant_id = chat_mensagens.tenant_id AND c.patient_id = chat_mensagens.patient_id
                       AND c.liberada_em IS NOT NULL AND c.pausada_em IS NULL)
        AND EXISTS (SELECT 1 FROM patients p
                     WHERE p.tenant_id = chat_mensagens.tenant_id AND p.id = chat_mensagens.patient_id
                       AND p.status = 'ativo' AND p.anonimizado_em IS NULL))
  );
--> statement-breakpoint
-- §9.3 (RN-448): o paciente grava e avança só o PRÓPRIO lado do marcador; o SELECT fica livre dentro do próprio paciente (o
-- portal lê o lida_ate do consultório para mostrar "Lida")
SELECT app_allow_paciente_escrita('chat_leituras', 'insert', 'update');
--> statement-breakpoint
CREATE POLICY paciente_leitura_propria_insert ON chat_leituras AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR lado = 'paciente');
--> statement-breakpoint
CREATE POLICY paciente_leitura_propria_update ON chat_leituras AS RESTRICTIVE FOR UPDATE
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR lado = 'paciente')
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR lado = 'paciente');
--> statement-breakpoint
-- RN-440 / CH-D47 (molde patient_cadastro_paciente_com_conta, 0125): o contexto de paciente sem login (link, WhatsApp,
-- convite, contexto da IA Nutri, "No app do paciente") não lê nem grava nada do chat — nem as próprias linhas
CREATE POLICY paciente_com_conta ON chat_conversas AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL)
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY paciente_com_conta ON chat_mensagens AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL)
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY paciente_com_conta ON chat_leituras AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL)
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY paciente_com_conta ON chat_configuracoes AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL)
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY paciente_com_conta ON chat_horarios AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL)
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL);
--> statement-breakpoint
-- 0102 + Plano 25 (§9.6): a sessão de paciente grava a foto original do diário, o original do exame enviado e, agora, o
-- original da foto do chat. O resto, igual à 0102 (última que recriou a política).
DROP POLICY paciente_arquivo_insert ON stored_files;
--> statement-breakpoint
CREATE POLICY paciente_arquivo_insert ON stored_files AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR tipo IN ('diario_foto_original', 'exame_original', 'chat_anexo_original'));
--> statement-breakpoint
-- §9.1 / §9.3: a conversa e o marcador não se apagam pelo app (só por app_chat_apagar_do_titular, T1c)
REVOKE DELETE, TRUNCATE ON chat_conversas, chat_leituras FROM nutri_app_role;
--> statement-breakpoint
-- §9.2: a mensagem não se edita nem se apaga; o UPDATE só das colunas do anexo (o job do worker; as transições são do
-- gatilho chat_mensagens_regras, T1b)
REVOKE UPDATE, DELETE, TRUNCATE ON chat_mensagens FROM nutri_app_role;
--> statement-breakpoint
GRANT UPDATE (anexo_status, anexo_path, anexo_original_path, updated_at) ON chat_mensagens TO nutri_app_role;
--> statement-breakpoint
-- CH-D70 (molde fin_configuracoes, 0123): a linha do consultório não se apaga — apagá-la religaria o e-mail e zeraria a
-- janela de 2 h do aviso; nada no app precisa apagá-la (sem paciente, a anonimização não a toca)
REVOKE DELETE, TRUNCATE ON chat_avisos_nutri FROM nutri_app_role;
--> statement-breakpoint
-- §9.5: o recado é só de inclusão
REVOKE UPDATE, DELETE, TRUNCATE ON recados FROM nutri_app_role;
--> statement-breakpoint
-- §9.4: sem sobreposição de faixas no mesmo dia (o Drizzle não escreve EXCLUDE; btree_gist já existe pela 0051)
ALTER TABLE chat_horarios ADD CONSTRAINT chat_horarios_sem_sobreposicao
  EXCLUDE USING gist (tenant_id WITH =, dia_semana WITH =, int4range(inicio_min, fim_min) WITH &&);

--> statement-breakpoint
-- ===== T1b (P25-01b): os quatro gatilhos (spec §9.1–§9.5 v0.3, CH-D38, CH-D57, CH-D60, CH-D67) =====
-- Todos BEFORE, SECURITY INVOKER, search_path fixo, 42501. Cada um devolve NEW, ANTES de ler qualquer tabela, sempre que a
-- RLS já recusa aquele papel naquele comando — para a recusa vir da política da própria tabela (testes de isolamento):
--   (i)   NEW.tenant_id diferente do tenant da sessão (tenant_isolation);
--   (ii)  sessão de paciente com NEW.patient_id diferente do paciente da sessão (patient_isolation);
--   (iii) os papéis que a RLS nega, numa lista fechada: `publico` (publico_negado) e `conta` (sem tenant);
--   (iv)  a sessão de paciente onde a RLS a recusa (chat_conversas: paciente_sem_*; recados: staff_only e paciente_sem_*;
--         chat_mensagens: paciente_chat_envio cobre todas as regras do paciente; chat_leituras: lado do consultório ou sem
--         conta — paciente_leitura_propria_* e paciente_com_conta).
-- Papel desconhecido (qualquer outro valor de app.role) recebe o 42501 do gatilho: falha fechada — app_current_role() não
-- valida o valor e a tenant_isolation não olha o papel. A `recepcao` (Plano 26) entra na lista (iii) só quando a RLS a negar
-- (RN-505 do 26); até lá, é papel desconhecido (CH-D71: quem entrar depois, o 26 ou o §5 do 25, faz o CREATE OR REPLACE
-- das quatro funções com 'recepcao' na lista e inverte a asserção do banco.test.ts). Sem papel (migration, semente sem withTenant): devolve NEW; as colunas de
-- relógio vêm do default e quem grava preenche o carimbo (o CHECK exige).

-- §9.1 (RN-441, RN-442): chaves fixas; a conversa só nasce pela sessão `nutri` (liberação ou recado; o worker não cria);
-- liberar (liberada_em de nulo a valor) só na `nutri`, em nome de quem libera, com o titular ativo e não anonimizado e o
-- carimbo do consultório (RN-475); liberada_em/liberada_por/tcle_forma não mudam depois de gravados; pausar e retomar só na
-- `nutri`, pausar em nome de quem pausa. liberada_em e pausada_em com o relógio do banco.
CREATE OR REPLACE FUNCTION app_chat_conversas_regras() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(current_setting('app.role', true), '');
  libera boolean;
  pausa_antes timestamptz;
  pausa_por_antes uuid;
BEGIN
  IF r = '' THEN RETURN NEW; END IF;
  IF NEW.tenant_id IS DISTINCT FROM app_current_tenant() THEN RETURN NEW; END IF;
  IF r IN ('publico', 'conta') THEN RETURN NEW; END IF;
  IF r NOT IN ('nutri', 'paciente', 'worker') THEN
    RAISE EXCEPTION 'chat_conversas: papel desconhecido' USING ERRCODE = '42501';
  END IF;
  -- (ii) e (iv): a RLS recusa a sessão de paciente em todo comando (fora de PACIENTE_ESCREVE)
  IF r = 'paciente' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF r <> 'nutri' THEN
      RAISE EXCEPTION 'a conversa só é criada pela sessão da nutricionista' USING ERRCODE = '42501';
    END IF;
    libera := NEW.liberada_em IS NOT NULL;
    pausa_antes := NULL;
    pausa_por_antes := NULL;
  ELSE
    IF (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.created_at) THEN
      RAISE EXCEPTION 'coluna fixa da conversa' USING ERRCODE = '42501';
    END IF;
    IF OLD.liberada_em IS NOT NULL
       AND (NEW.liberada_em, NEW.liberada_por, NEW.tcle_forma) IS DISTINCT FROM (OLD.liberada_em, OLD.liberada_por, OLD.tcle_forma) THEN
      RAISE EXCEPTION 'a liberação da conversa não muda depois de gravada' USING ERRCODE = '42501';
    END IF;
    libera := OLD.liberada_em IS NULL AND NEW.liberada_em IS NOT NULL;
    pausa_antes := OLD.pausada_em;
    pausa_por_antes := OLD.pausada_por;
  END IF;
  IF libera THEN
    IF r <> 'nutri' THEN
      RAISE EXCEPTION 'só a sessão da nutricionista libera a conversa' USING ERRCODE = '42501';
    END IF;
    IF NEW.liberada_por IS DISTINCT FROM app_current_user() THEN
      RAISE EXCEPTION 'a liberação é gravada em nome de quem libera' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.patient_id
                     AND p.status = 'ativo' AND p.anonimizado_em IS NULL) THEN
      RAISE EXCEPTION 'só se libera a conversa de titular ativo' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = NEW.tenant_id AND t.nome_profissional IS NOT NULL AND t.crn IS NOT NULL) THEN
      RAISE EXCEPTION 'o consultório ainda não tem nome profissional e CRN' USING ERRCODE = '42501';
    END IF;
    NEW.liberada_em := clock_timestamp();
  END IF;
  IF (NEW.pausada_em, NEW.pausada_por) IS DISTINCT FROM (pausa_antes, pausa_por_antes) THEN
    IF r <> 'nutri' THEN
      RAISE EXCEPTION 'só a sessão da nutricionista pausa e retoma a conversa' USING ERRCODE = '42501';
    END IF;
    IF NEW.pausada_em IS NOT NULL THEN
      IF pausa_antes IS NOT NULL THEN
        RAISE EXCEPTION 'a conversa já está pausada' USING ERRCODE = '42501';
      END IF;
      IF NEW.pausada_por IS DISTINCT FROM app_current_user() THEN
        RAISE EXCEPTION 'a pausa é gravada em nome de quem pausa' USING ERRCODE = '42501';
      END IF;
      NEW.pausada_em := clock_timestamp();
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER chat_conversas_regras BEFORE INSERT OR UPDATE ON chat_conversas FOR EACH ROW EXECUTE FUNCTION app_chat_conversas_regras();
--> statement-breakpoint
-- §9.2 (RN-443, RN-445, RN-462, RN-475; v0.2 (b)–(d), v0.3 (f)–(h)). INSERT: criada_em com o relógio do banco; o paciente
-- fica com a política paciente_chat_envio (que confere autor, conta, conversa, titular, anexo e original); o worker não grava
-- mensagem; a `nutri` grava só `autor = 'nutri'`, em nome da própria usuária, com o carimbo de `tenants` (42501 sem ele), o
-- titular ativo e não anonimizado e — fora a cópia de recado — a conversa liberada e não pausada; os caminhos do anexo são
-- de um stored_files do mesmo tenant e paciente, do tipo certo. UPDATE: colunas fixas, menos as quatro do GRANT; o anexo só
-- muda pelo worker — processando → pronto | falhou, com o anexo_path entrando só em processando → pronto (mesma amarra);
-- pronto | falhou → removido e os caminhos a nulo só com o marcador local app.chat_soltando (app_chat_soltar_anexo, T1c) —
-- o anexo convertido (e o `removido`) também só com o titular bloqueado ou anonimizado; o original nunca entra num UPDATE e
-- nenhum caminho troca por outro. A cópia de recado repete o texto do recado.
CREATE OR REPLACE FUNCTION app_chat_mensagens_regras() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(current_setting('app.role', true), '');
  soltando boolean := coalesce(current_setting('app.chat_soltando', true), '') = 'on';
  livres text[] := ARRAY['anexo_status', 'anexo_path', 'anexo_original_path', 'updated_at'];
  titular_saindo boolean;
  nome text;
  crn text;
BEGIN
  IF r = '' THEN RETURN NEW; END IF;
  IF NEW.tenant_id IS DISTINCT FROM app_current_tenant() THEN RETURN NEW; END IF;
  IF r IN ('publico', 'conta') THEN RETURN NEW; END IF;
  IF r NOT IN ('nutri', 'paciente', 'worker') THEN
    RAISE EXCEPTION 'chat_mensagens: papel desconhecido' USING ERRCODE = '42501';
  END IF;
  IF r = 'paciente' AND NEW.patient_id IS DISTINCT FROM app_current_patient() THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.criada_em := clock_timestamp();
    -- (iv): a política paciente_chat_envio confere todas as regras do envio do paciente
    IF r = 'paciente' THEN RETURN NEW; END IF;
    IF r = 'worker' THEN
      RAISE EXCEPTION 'o worker não grava mensagem' USING ERRCODE = '42501';
    END IF;
    IF NEW.autor IS DISTINCT FROM 'nutri' THEN
      RAISE EXCEPTION 'a sessão da nutricionista só grava mensagem da nutricionista' USING ERRCODE = '42501';
    END IF;
    IF NEW.autor_user_id IS DISTINCT FROM app_current_user() THEN
      RAISE EXCEPTION 'a mensagem é gravada em nome de quem envia' USING ERRCODE = '42501';
    END IF;
    SELECT t.nome_profissional, t.crn INTO nome, crn FROM public.tenants t WHERE t.id = NEW.tenant_id;
    IF nome IS NULL OR crn IS NULL THEN
      RAISE EXCEPTION 'o consultório ainda não tem nome profissional e CRN' USING ERRCODE = '42501';
    END IF;
    NEW.autor_nome := nome;
    NEW.autor_crn := crn;
    IF NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.patient_id
                     AND p.status = 'ativo' AND p.anonimizado_em IS NULL) THEN
      RAISE EXCEPTION 'mensagem só para titular ativo' USING ERRCODE = '42501';
    END IF;
    IF NEW.recado_id IS NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.chat_conversas c WHERE c.tenant_id = NEW.tenant_id AND c.patient_id = NEW.patient_id
                       AND c.liberada_em IS NOT NULL AND c.pausada_em IS NULL) THEN
        RAISE EXCEPTION 'a conversa não está liberada ou está pausada' USING ERRCODE = '42501';
      END IF;
    -- revisão, M2: a cópia de recado dispensa a conversa liberada (RN-462), então tem de ser o texto do próprio recado — sem
    -- isto, um recado_id qualquer abriria a conversa não liberada para qualquer texto
    ELSIF NOT EXISTS (SELECT 1 FROM public.recados r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.recado_id AND r.texto = NEW.texto) THEN
      RAISE EXCEPTION 'a cópia do recado repete o texto do recado' USING ERRCODE = '42501';
    END IF;
    IF NEW.anexo_path IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.stored_files f WHERE f.tenant_id = NEW.tenant_id AND f.patient_id = NEW.patient_id
            AND f.tipo = 'chat_anexo' AND f.caminho = NEW.anexo_path) THEN
      RAISE EXCEPTION 'o anexo não é um chat_anexo deste paciente' USING ERRCODE = '42501';
    END IF;
    IF NEW.anexo_original_path IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.stored_files f WHERE f.tenant_id = NEW.tenant_id AND f.patient_id = NEW.patient_id
            AND f.tipo = 'chat_anexo_original' AND f.caminho = NEW.anexo_original_path) THEN
      RAISE EXCEPTION 'o original não é um chat_anexo_original deste paciente' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE. (iv): a sessão de paciente não tem UPDATE (paciente_sem_update esconde as linhas)
  IF r = 'paciente' THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - livres) IS DISTINCT FROM (to_jsonb(OLD) - livres) THEN
    RAISE EXCEPTION 'coluna fixa da mensagem' USING ERRCODE = '42501';
  END IF;
  -- revisão, M3 (molde 0123): o anexo convertido só sai (a nulo ou `removido`) com o titular bloqueado ou anonimizado — o
  -- marcador não basta, porque qualquer sessão o liga; o original continua saindo só com o marcador (fim da conversão)
  titular_saindo := (NEW.anexo_path IS DISTINCT FROM OLD.anexo_path OR NEW.anexo_status IS DISTINCT FROM OLD.anexo_status)
    AND EXISTS (SELECT 1 FROM public.patients p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.patient_id
                  AND (p.status = 'bloqueado' OR p.anonimizado_em IS NOT NULL));
  IF NEW.anexo_status IS DISTINCT FROM OLD.anexo_status THEN
    IF OLD.anexo_status = 'processando' AND NEW.anexo_status IN ('pronto', 'falhou') THEN
      IF r <> 'worker' THEN
        RAISE EXCEPTION 'só o worker conclui o anexo' USING ERRCODE = '42501';
      END IF;
    ELSIF OLD.anexo_status IN ('pronto', 'falhou') AND NEW.anexo_status = 'removido' THEN
      IF r <> 'worker' OR NOT soltando THEN
        RAISE EXCEPTION 'o anexo só é removido por app_chat_soltar_anexo' USING ERRCODE = '42501';
      END IF;
      IF NOT titular_saindo THEN
        RAISE EXCEPTION 'o anexo só sai com o titular bloqueado ou anonimizado' USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'transição do anexo inválida' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.anexo_path IS DISTINCT FROM OLD.anexo_path THEN
    IF OLD.anexo_path IS NULL THEN
      IF NOT (OLD.anexo_status = 'processando' AND NEW.anexo_status = 'pronto') THEN
        RAISE EXCEPTION 'o anexo convertido só entra na conclusão (processando → pronto)' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.stored_files f WHERE f.tenant_id = NEW.tenant_id AND f.patient_id = NEW.patient_id
                       AND f.tipo = 'chat_anexo' AND f.caminho = NEW.anexo_path) THEN
        RAISE EXCEPTION 'o anexo não é um chat_anexo deste paciente' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.anexo_path IS NOT NULL THEN
      RAISE EXCEPTION 'o caminho do anexo não troca por outro' USING ERRCODE = '42501';
    ELSIF r <> 'worker' OR NOT soltando THEN
      RAISE EXCEPTION 'o caminho do anexo só sai por app_chat_soltar_anexo' USING ERRCODE = '42501';
    ELSIF NOT titular_saindo THEN
      RAISE EXCEPTION 'o anexo só sai com o titular bloqueado ou anonimizado' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.anexo_original_path IS DISTINCT FROM OLD.anexo_original_path THEN
    IF NEW.anexo_original_path IS NOT NULL THEN
      RAISE EXCEPTION 'o original não entra nem troca depois do envio' USING ERRCODE = '42501';
    ELSIF r <> 'worker' OR NOT soltando THEN
      RAISE EXCEPTION 'o original só sai por app_chat_soltar_anexo' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER chat_mensagens_regras BEFORE INSERT OR UPDATE ON chat_mensagens FOR EACH ROW EXECUTE FUNCTION app_chat_mensagens_regras();
--> statement-breakpoint
-- §9.3 (RN-448; v0.2, v0.3): chaves fixas; lado × papel só no INSERT e no UPDATE em que lida_ate muda (CH-D58: o `set
-- tenant_id = tenant_id` da equipe numa linha do paciente não é escrita do lado do paciente) — `consultorio` só na `nutri`,
-- `paciente` só na sessão de paciente com conta (o worker e a equipe não gravam o lado do paciente: seria um "Lida" falso);
-- lida_ate só avança e nunca passa do relógio do banco (o excesso é cortado, não recusado: o upsert do módulo não falha).
CREATE OR REPLACE FUNCTION app_chat_leituras_regras() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(current_setting('app.role', true), '');
BEGIN
  IF r = '' THEN RETURN NEW; END IF;
  IF NEW.tenant_id IS DISTINCT FROM app_current_tenant() THEN RETURN NEW; END IF;
  IF r IN ('publico', 'conta') THEN RETURN NEW; END IF;
  IF r NOT IN ('nutri', 'paciente', 'worker') THEN
    RAISE EXCEPTION 'chat_leituras: papel desconhecido' USING ERRCODE = '42501';
  END IF;
  -- (ii) e (iv): outro paciente, o lado do consultório ou a sessão sem conta — a RLS recusa
  IF r = 'paciente' AND (NEW.patient_id IS DISTINCT FROM app_current_patient() OR NEW.lado IS DISTINCT FROM 'paciente'
                         OR app_current_user() IS NULL) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id, NEW.patient_id, NEW.lado) IS DISTINCT FROM (OLD.tenant_id, OLD.patient_id, OLD.lado) THEN
    RAISE EXCEPTION 'coluna fixa do marcador de leitura' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.lida_ate IS DISTINCT FROM OLD.lida_ate THEN
    IF NOT ((NEW.lado = 'consultorio' AND r = 'nutri') OR (NEW.lado = 'paciente' AND r = 'paciente')) THEN
      RAISE EXCEPTION 'cada lado só grava o próprio marcador de leitura' USING ERRCODE = '42501';
    END IF;
    -- comparações explícitas (revisão, M1): least/greatest ignoram NULL e trocariam um lida_ate nulo pelo relógio, escondendo
    -- o NOT NULL; com IF, o nulo segue e o 23502 aparece
    IF NEW.lida_ate > clock_timestamp() THEN
      NEW.lida_ate := clock_timestamp();
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.lida_ate < OLD.lida_ate THEN
      NEW.lida_ate := OLD.lida_ate;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER chat_leituras_regras BEFORE INSERT OR UPDATE ON chat_leituras FOR EACH ROW EXECUTE FUNCTION app_chat_leituras_regras();
--> statement-breakpoint
-- §9.5 (RN-462, RN-475; v0.2, v0.3): só a sessão `nutri` grava recado, em nome da própria usuária, com o relógio do banco e o
-- carimbo de `tenants` (42501 sem ele); o worker → 42501. A sessão de paciente (staff_only, paciente_sem_insert) devolve NEW.
CREATE OR REPLACE FUNCTION app_recados_regras() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(current_setting('app.role', true), '');
  nome text;
  crn text;
BEGIN
  IF r = '' THEN RETURN NEW; END IF;
  IF NEW.tenant_id IS DISTINCT FROM app_current_tenant() THEN RETURN NEW; END IF;
  IF r IN ('publico', 'conta') THEN RETURN NEW; END IF;
  IF r NOT IN ('nutri', 'paciente', 'worker') THEN
    RAISE EXCEPTION 'recados: papel desconhecido' USING ERRCODE = '42501';
  END IF;
  IF r = 'paciente' THEN RETURN NEW; END IF;
  IF r <> 'nutri' THEN
    RAISE EXCEPTION 'só a sessão da nutricionista grava recado' USING ERRCODE = '42501';
  END IF;
  SELECT t.nome_profissional, t.crn INTO nome, crn FROM public.tenants t WHERE t.id = NEW.tenant_id;
  IF nome IS NULL OR crn IS NULL THEN
    RAISE EXCEPTION 'o consultório ainda não tem nome profissional e CRN' USING ERRCODE = '42501';
  END IF;
  NEW.autor_nome := nome;
  NEW.autor_crn := crn;
  NEW.criado_por := app_current_user();
  NEW.criado_em := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER recados_regras BEFORE INSERT ON recados FOR EACH ROW EXECUTE FUNCTION app_recados_regras();

--> statement-breakpoint
-- ===== T1c (P25-01c): as três funções SECURITY DEFINER (spec §9.7 v0.3, CH-D59, CH-D70) =====
-- Dona = role de migration (em produção, sem superusuário e NOBYPASSRLS: a RLS FORCE vale também aqui dentro). Molde
-- 0083/0117: search_path fixo, nomes com `public.`, troca de papel com set_config(..., true) e o contexto do chamador
-- restaurado antes de cada RETURN e no ramo de erro; REVOKE ALL do PUBLIC e EXECUTE só para nutri_app_role.

-- §9.7: solta UM ponteiro de arquivo da mensagem, no naMesmaTransacao do apagarArquivo do worker (conversão concluída,
-- falha, varredura ou anonimização). O original sai só fora de `processando`; o anexo convertido só depois do original
-- (CH-D59: o CHECK `removido ⇒ sem caminhos` daria 23514 no meio da anonimização) e só com o titular na condição de
-- app_chat_apagar_do_titular — e aí a mensagem fica `removido`. O marcador local app.chat_soltando (que o gatilho
-- chat_mensagens_regras exige para levar um caminho a nulo) vale só durante o UPDATE e é zerado antes de cada RETURN e no erro.
CREATE OR REPLACE FUNCTION app_chat_soltar_anexo(p_mensagem uuid, p_caminho text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.app_current_tenant();
  v_status text;
  v_path text;
  v_original text;
  v_patient uuid;
BEGIN
  IF v_tenant IS NULL OR public.app_current_role() IS DISTINCT FROM 'worker' THEN
    RAISE EXCEPTION 'app_chat_soltar_anexo() só roda no contexto worker de um tenant' USING ERRCODE = '42501';
  END IF;
  SELECT m.anexo_status, m.anexo_path, m.anexo_original_path, m.patient_id INTO v_status, v_path, v_original, v_patient
    FROM public.chat_mensagens m WHERE m.tenant_id = v_tenant AND m.id = p_mensagem FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'app_chat_soltar_anexo(): mensagem fora deste tenant' USING ERRCODE = '42501';
  END IF;
  IF p_caminho IS NULL OR p_caminho IS DISTINCT FROM v_original AND p_caminho IS DISTINCT FROM v_path THEN
    RAISE EXCEPTION 'app_chat_soltar_anexo(): o caminho não é o ponteiro atual da mensagem' USING ERRCODE = '42501';
  END IF;
  IF p_caminho = v_original THEN
    IF v_status = 'processando' THEN
      RAISE EXCEPTION 'app_chat_soltar_anexo(): o original só sai depois do processamento' USING ERRCODE = '42501';
    END IF;
    BEGIN
      PERFORM set_config('app.chat_soltando', 'on', true);
      UPDATE public.chat_mensagens SET anexo_original_path = NULL, updated_at = clock_timestamp()
       WHERE tenant_id = v_tenant AND id = p_mensagem;
      PERFORM set_config('app.chat_soltando', '', true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('app.chat_soltando', '', true);
      RAISE;
    END;
    RETURN;
  END IF;
  -- p_caminho = anexo_path
  IF v_original IS NOT NULL THEN
    RAISE EXCEPTION 'app_chat_soltar_anexo: solte antes o original' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.patients p JOIN public.tenants t ON t.id = p.tenant_id
        WHERE p.tenant_id = v_tenant AND p.id = v_patient
          AND (p.anonimizado_em IS NOT NULL
               OR (p.status = 'bloqueado' AND p.anonimizar_apos < (now() AT TIME ZONE t.fuso)::date))) THEN
    RAISE EXCEPTION 'app_chat_soltar_anexo(): o anexo só sai com o titular na anonimização' USING ERRCODE = '42501';
  END IF;
  BEGIN
    PERFORM set_config('app.chat_soltando', 'on', true);
    UPDATE public.chat_mensagens SET anexo_path = NULL, anexo_status = 'removido', updated_at = clock_timestamp()
     WHERE tenant_id = v_tenant AND id = p_mensagem;
    PERFORM set_config('app.chat_soltando', '', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.chat_soltando', '', true);
    RAISE;
  END;
  RETURN;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_chat_soltar_anexo(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_chat_soltar_anexo(uuid, text) TO nutri_app_role;
--> statement-breakpoint
-- RN-458 / §9.7 (v0.3; CH-D70): no envio do paciente, decide se o e-mail "Mensagens novas de pacientes" é devido e marca a
-- janela. Só na sessão de paciente com conta (conferido ANTES de trocar o papel); a sessão de paciente não lê nem grava
-- chat_avisos_nutri (staff_only), então a função troca o papel para o worker, cria a linha do consultório quando falta (com o
-- padrão aviso_email ligado), trava a linha (depois das travas do paciente, que o módulo já tem) e devolve false com o aviso
-- desligado, fora do horário (p_no_horario, calculado no módulo; nulo conta como fora) ou com a marca a menos de 2 h; senão
-- grava a marca e devolve true. Devolve só o booleano, nunca uma coluna.
CREATE OR REPLACE FUNCTION app_chat_aviso_nutri_devido(p_no_horario boolean) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := current_setting('app.role', true);
  v_patient_txt text := current_setting('app.patient_id', true);
  v_tenant uuid := public.app_current_tenant();
  v_user uuid := public.app_current_user();
  v_ligado boolean;
  v_marca timestamptz;
  v_devido boolean;
BEGIN
  IF v_tenant IS NULL OR v_user IS NULL OR v_role IS DISTINCT FROM 'paciente' OR nullif(v_patient_txt, '') IS NULL THEN
    RAISE EXCEPTION 'app_chat_aviso_nutri_devido() só roda na sessão de paciente com conta' USING ERRCODE = '42501';
  END IF;
  BEGIN
    PERFORM set_config('app.role', 'worker', true);
    PERFORM set_config('app.patient_id', '', true);
    INSERT INTO public.chat_avisos_nutri (tenant_id) VALUES (v_tenant) ON CONFLICT (tenant_id) DO NOTHING;
    SELECT a.aviso_email, a.aviso_nutri_em INTO v_ligado, v_marca FROM public.chat_avisos_nutri a WHERE a.tenant_id = v_tenant FOR UPDATE;
    v_devido := v_ligado AND coalesce(p_no_horario, false) AND (v_marca IS NULL OR v_marca <= now() - interval '2 hours');
    IF v_devido THEN
      UPDATE public.chat_avisos_nutri SET aviso_nutri_em = now(), updated_at = now() WHERE tenant_id = v_tenant;
    END IF;
    PERFORM set_config('app.role', v_role, true);
    PERFORM set_config('app.patient_id', v_patient_txt, true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.role', v_role, true);
    PERFORM set_config('app.patient_id', v_patient_txt, true);
    RAISE;
  END;
  RETURN v_devido;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_chat_aviso_nutri_devido(boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_chat_aviso_nutri_devido(boolean) TO nutri_app_role;
--> statement-breakpoint
-- §9.7 (RN-465, RN-466): apaga a conversa do titular — marcadores, mensagens e a conversa, nessa ordem (FKs NO ACTION) —, no
-- contexto worker do tenant da sessão (DELETE revogado de nutri_app_role: só por aqui). Trava o paciente FOR UPDATE (passo
-- (1) da anonimização) e aceita (a) o titular bloqueado, ainda não anonimizado, com anonimizar_apos ANTES de hoje no fuso do
-- consultório (a regra de anonimizarVencidos; nunca current_date) ou (b) o titular já anonimizado (rede de limpeza depois de
-- uma volta atrás). Trava as mensagens do titular e recusa se alguma ainda aponta arquivo ou está em processamento (os
-- arquivos saem antes, por apagarArquivo + app_chat_soltar_anexo). As exclusões passam pelo gatilho de auditoria.
CREATE OR REPLACE FUNCTION app_chat_apagar_do_titular(p_patient uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.app_current_tenant();
  v_status text;
  v_apos date;
  v_anonimizado timestamptz;
  v_fuso text;
BEGIN
  IF v_tenant IS NULL OR public.app_current_role() IS DISTINCT FROM 'worker' THEN
    RAISE EXCEPTION 'app_chat_apagar_do_titular() só roda no contexto worker de um tenant' USING ERRCODE = '42501';
  END IF;
  SELECT p.status, p.anonimizar_apos, p.anonimizado_em INTO v_status, v_apos, v_anonimizado
    FROM public.patients p WHERE p.tenant_id = v_tenant AND p.id = p_patient FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'app_chat_apagar_do_titular(): paciente fora deste tenant' USING ERRCODE = '42501';
  END IF;
  SELECT t.fuso INTO v_fuso FROM public.tenants t WHERE t.id = v_tenant;
  IF NOT (v_anonimizado IS NOT NULL
          OR (v_status = 'bloqueado' AND v_apos IS NOT NULL AND v_apos < (now() AT TIME ZONE v_fuso)::date)) THEN
    RAISE EXCEPTION 'app_chat_apagar_do_titular(): o titular não está na anonimização' USING ERRCODE = '42501';
  END IF;
  -- revisão (M1): as mensagens do titular travadas antes da conferência — um job que concluísse processando → pronto entre o
  -- EXISTS e o DELETE deixaria o chat_anexo órfão. Anexo em processamento também recusa, mesmo sem caminho (falha fechada)
  -- ordem global de travas (RN-447): paciente → conversa → mensagem
  PERFORM 1 FROM public.chat_conversas c WHERE c.tenant_id = v_tenant AND c.patient_id = p_patient FOR UPDATE;
  PERFORM 1 FROM public.chat_mensagens m WHERE m.tenant_id = v_tenant AND m.patient_id = p_patient FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.chat_mensagens m WHERE m.tenant_id = v_tenant AND m.patient_id = p_patient
               AND (m.anexo_path IS NOT NULL OR m.anexo_original_path IS NOT NULL OR m.anexo_status = 'processando')) THEN
    RAISE EXCEPTION 'app_chat_apagar_do_titular(): ainda há anexo apontado ou em processamento' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.chat_leituras WHERE tenant_id = v_tenant AND patient_id = p_patient;
  DELETE FROM public.chat_mensagens WHERE tenant_id = v_tenant AND patient_id = p_patient;
  DELETE FROM public.chat_conversas WHERE tenant_id = v_tenant AND patient_id = p_patient;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_chat_apagar_do_titular(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_chat_apagar_do_titular(uuid) TO nutri_app_role;
