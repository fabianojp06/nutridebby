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
-- §9.5: o recado é só de inclusão
REVOKE UPDATE, DELETE, TRUNCATE ON recados FROM nutri_app_role;
--> statement-breakpoint
-- §9.5: o CHECK recados_filtro_valido (filtro->>'tipo' in (…), da gerada) deixa passar o filtro sem "tipo" (NULL no IN não
-- recusa); este fecha o buraco sem mexer na gerada
ALTER TABLE recados ADD CONSTRAINT recados_filtro_com_tipo CHECK (filtro ->> 'tipo' IS NOT NULL);
--> statement-breakpoint
-- §9.4: sem sobreposição de faixas no mesmo dia (o Drizzle não escreve EXCLUDE; btree_gist já existe pela 0051)
ALTER TABLE chat_horarios ADD CONSTRAINT chat_horarios_sem_sobreposicao
  EXCLUDE USING gist (tenant_id WITH =, dia_semana WITH =, int4range(inicio_min, fim_min) WITH &&);

-- ===== T1b (P25-01b): os quatro gatilhos — chat_conversas_regras, chat_mensagens_regras, chat_leituras_regras e
-- recados_regras — entram aqui (cada um com o próprio separador de comando do Drizzle), antes das funções. =====

-- ===== T1c (P25-01c): as três funções SECURITY DEFINER — app_chat_soltar_anexo, app_chat_aviso_nutri_devido e
-- app_chat_apagar_do_titular — entram aqui, no fim do arquivo. =====
