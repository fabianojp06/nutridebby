-- Defesa em profundidade da D1 (Plano 06, code-review do PR #8): o que a sessão de paciente grava, o banco também
-- confere — hoje só o código impedia. RESTRICTIVE e só para o papel `paciente` (soma-se, AND, às políticas de
-- tenant/paciente e às paciente_sem_*); a equipe, o worker e o `conta` não mudam.
--
-- (a) diary_entries, INSERT (US-042 / D11): o paciente cria o registro com texto e, no máximo, a foto ORIGINAL dele
-- mesmo em "processando". Foto convertida, comentário e "visto" são da equipe e do worker. Sem isto a sessão de paciente
-- poderia apontar foto_path/foto_original_path para a foto de OUTRO paciente do tenant (a FK não passa pela RLS e o
-- CHECK só confere o prefixo do tenant) e o job da foto converteria a foto alheia para o diário dela.
CREATE POLICY paciente_diario_insert ON diary_entries AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    app_current_role() IS DISTINCT FROM 'paciente'
    OR (
      foto_path IS NULL AND comentario_nutri IS NULL AND comentado_em IS NULL AND visto_pela_nutri_em IS NULL
      AND foto_status IN ('sem_foto', 'processando')
      AND (foto_original_path IS NULL OR EXISTS (
        SELECT 1 FROM stored_files sf
         WHERE sf.tenant_id = diary_entries.tenant_id AND sf.caminho = diary_entries.foto_original_path
           AND sf.patient_id = diary_entries.patient_id AND sf.tipo = 'diario_foto_original'))
    )
  );
--> statement-breakpoint
-- (b) data_exports (US-046 / P-16 b): o paciente só vê, pede e marca as exportações do TITULAR. As da equipe
-- (prontuário completo, que pode ter rascunho) ficam invisíveis e intocáveis para ele.
CREATE POLICY paciente_exportacao_titular ON data_exports AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR escopo = 'titular')
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR escopo = 'titular');
--> statement-breakpoint
-- (c) stored_files, INSERT (D4): o único arquivo que a sessão de paciente grava é a foto original do diário
-- (salvarArquivo em registrarNoDiario). Laudo, PDF, ZIP, logo… só a equipe e o worker.
CREATE POLICY paciente_arquivo_insert ON stored_files AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR tipo = 'diario_foto_original');
