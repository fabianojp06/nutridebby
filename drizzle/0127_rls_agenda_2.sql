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
