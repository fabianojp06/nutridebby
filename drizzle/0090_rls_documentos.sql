-- Plano 10A (spec de documentos assinados v0.3.1, §10). CLAUDE.md regras 2 e 8.
SELECT app_enable_tenant_rls('signed_documents');
--> statement-breakpoint
SELECT app_enable_patient_rls('signed_documents');
--> statement-breakpoint
SELECT app_enable_audit('signed_documents', 'documentos');
--> statement-breakpoint
-- RN-141 / §4: a sessão de paciente só vê documento emitido (como paciente_sem_rascunho, 0045) e nunca grava
CREATE POLICY paciente_so_emitidos ON signed_documents AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR status IN ('assinado', 'substituido', 'cancelado'))
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente');
--> statement-breakpoint
SELECT app_enable_tenant_rls('signed_document_notes');
--> statement-breakpoint
SELECT app_enable_patient_rls('signed_document_notes');
--> statement-breakpoint
SELECT app_enable_staff_only('signed_document_notes');
--> statement-breakpoint
SELECT app_enable_audit('signed_document_notes', 'documentos');
--> statement-breakpoint
SELECT app_enable_tenant_rls('signed_document_receipts');
--> statement-breakpoint
SELECT app_enable_patient_rls('signed_document_receipts');
--> statement-breakpoint
SELECT app_enable_audit('signed_document_receipts', 'documentos');
--> statement-breakpoint
-- D11: o paciente só INSERE o recibo do próprio documento ASSINADO (a subconsulta passa pela RLS dele:
-- patient_isolation + paciente_so_emitidos), nunca "pessoalmente" (isso é da nutricionista)
SELECT app_allow_paciente_escrita('signed_document_receipts', 'insert');
--> statement-breakpoint
CREATE POLICY paciente_recibo_proprio ON signed_document_receipts AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR (
    via <> 'pessoalmente' AND registrado_por IS NULL AND EXISTS (
      SELECT 1 FROM signed_documents d
       WHERE d.tenant_id = signed_document_receipts.tenant_id AND d.id = signed_document_receipts.documento_id AND d.status = 'assinado')));
--> statement-breakpoint
-- prova de entrega: append-only para a aplicação (como audit_log)
REVOKE UPDATE, DELETE ON signed_document_receipts FROM nutri_app_role;
--> statement-breakpoint
SELECT app_enable_tenant_rls('document_access_codes');
--> statement-breakpoint
SELECT app_enable_patient_rls('document_access_codes');
--> statement-breakpoint
-- RN-158 / D12: o paciente sem login (link-documento.ts, semConta) pede e confere o código do próprio documento
SELECT app_allow_paciente_escrita('document_access_codes', 'insert', 'update');

--> statement-breakpoint
-- RN-156: fora da RLS (RLS_EXCEPTIONS: lida antes de existir contexto de tenant); o app insere e só muda a situação
REVOKE UPDATE, DELETE ON document_verifications FROM nutri_app_role;
--> statement-breakpoint
GRANT UPDATE (situacao, situacao_em) ON document_verifications TO nutri_app_role;
--> statement-breakpoint
-- RNF-141: o paciente vê os próprios arquivos, MENOS o PDF preparado (antes da assinatura) e as fotos da digitalizada
DROP POLICY paciente_arquivos ON stored_files;
--> statement-breakpoint
CREATE POLICY paciente_arquivos ON stored_files AS RESTRICTIVE FOR ALL
  USING (
    app_current_role() IS DISTINCT FROM 'paciente'
    OR (patient_id = app_current_patient() AND tipo NOT IN ('documento_base', 'documento_digitalizado'))
    OR tipo = 'logo'
    OR (tipo = 'capa' AND EXISTS (SELECT 1 FROM contents c WHERE c.tenant_id = stored_files.tenant_id AND c.capa_path = stored_files.caminho))
  )
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR patient_id = app_current_patient());
