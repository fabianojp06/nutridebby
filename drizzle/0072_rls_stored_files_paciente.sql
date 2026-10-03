-- P-16 (d) / D4 (Plano 06): stored_files ganha dono (patient_id). FK composta: um arquivo do tenant A nunca aponta
-- para paciente do tenant B. Fica aqui, e não no schema, porque platform.ts não importa patients (ciclo).
ALTER TABLE stored_files ADD CONSTRAINT stored_files_paciente_fk
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id);
--> statement-breakpoint
-- Preenche o dono dos arquivos que já existem. RLS forçada também para o dono da tabela: um tenant por vez.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    PERFORM set_config('app.role', 'worker', true);
    UPDATE stored_files sf SET patient_id = e.patient_id FROM exams e
     WHERE sf.tenant_id = t.id AND e.tenant_id = t.id AND e.arquivo_path = sf.caminho AND sf.patient_id IS NULL;
    UPDATE stored_files sf SET patient_id = m.patient_id FROM meal_plans m
     WHERE sf.tenant_id = t.id AND m.tenant_id = t.id AND m.pdf_path = sf.caminho AND m.patient_id IS NOT NULL AND sf.patient_id IS NULL;
    UPDATE stored_files sf SET patient_id = d.patient_id FROM data_exports d
     WHERE sf.tenant_id = t.id AND d.tenant_id = t.id AND d.arquivo_path = sf.caminho AND sf.patient_id IS NULL;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.role', '', true);
END $$;
--> statement-breakpoint
-- Arquivo de paciente que ficou sem dono (registro apagado antes desta migration) é órfão de verdade: o CHECK
-- abaixo recusaria. Nenhum é esperado; se houver, a migration falha e o dono decide (não apagamos arquivo aqui).
ALTER TABLE stored_files VALIDATE CONSTRAINT stored_files_dono;
--> statement-breakpoint
-- D4: a sessão de paciente vê e grava só os próprios arquivos; lê os do consultório (logo, capa)
CREATE POLICY paciente_arquivos ON stored_files AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR patient_id = app_current_patient() OR tipo IN ('logo', 'capa'))
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR patient_id = app_current_patient());
--> statement-breakpoint
-- Tarefa 7: a foto do diário é gravada pela sessão de paciente (salvarArquivo)
SELECT app_allow_paciente_escrita('stored_files', 'insert');
