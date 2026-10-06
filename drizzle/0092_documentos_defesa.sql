-- Plano 10A, revisão final do branch (Minors de segurança da Etapa 1): defesa em profundidade no banco.
-- O Plano 10B renumera as migrations dele a partir da 0093.

-- 1. Res. CFN 656 (confirmação de recebimento): recibo "portal"/"link_email" só pela sessão do paciente (com ou sem conta,
-- paciente_recibo_proprio, 0090). Fora dela (nutricionista, worker), só "pessoalmente" registrado pela própria usuária.
CREATE POLICY recibo_fora_do_paciente ON signed_document_receipts AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_current_role() IS NOT DISTINCT FROM 'paciente' OR (via = 'pessoalmente' AND registrado_por = app_current_user()));
--> statement-breakpoint
-- 2. RN-156: a situação pública só anda para a frente. "valido" → substituido/cancelado/eliminado; substituido/cancelado →
-- eliminado (retenção, app_anonimizar_documentos, 0091); "eliminado" é final; nada volta a "valido". Mesma situação: a
-- data não muda. Vale para todo papel (a tabela está fora da RLS).
CREATE OR REPLACE FUNCTION app_verificacao_situacao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.situacao = OLD.situacao THEN
    IF NEW.situacao_em IS DISTINCT FROM OLD.situacao_em THEN
      RAISE EXCEPTION 'data da situação da verificação não muda sem mudar a situação (RN-156)' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.situacao = 'eliminado' OR NEW.situacao = 'valido' OR (OLD.situacao <> 'valido' AND NEW.situacao <> 'eliminado') THEN
    RAISE EXCEPTION 'situação da verificação fora da regra (RN-156): % → %', OLD.situacao, NEW.situacao USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER verificacao_situacao BEFORE UPDATE ON document_verifications FOR EACH ROW EXECUTE FUNCTION app_verificacao_situacao();
--> statement-breakpoint
-- 3. RN-156: a verificação aponta para um documento do MESMO tenant e com o MESMO código (o código do documento não muda
-- depois do preparo e o emitido nunca é apagado — app_documento_imutavel, 0091). NO ACTION, como os PDFs.
ALTER TABLE signed_documents ADD CONSTRAINT signed_documents_tenant_id_codigo_unique UNIQUE (tenant_id, id, codigo);
--> statement-breakpoint
ALTER TABLE document_verifications ADD CONSTRAINT document_verifications_documento_fk
  FOREIGN KEY (tenant_id, documento_id, codigo) REFERENCES signed_documents (tenant_id, id, codigo) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
-- 4. RN-158: a sessão de paciente (o link sem login) só cria código de acesso para documento ASSINADO; a subconsulta passa
-- pela RLS dele (patient_isolation + paciente_so_emitidos)
CREATE POLICY paciente_codigo_de_assinado ON document_access_codes AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR EXISTS (
    SELECT 1 FROM signed_documents d
     WHERE d.tenant_id = document_access_codes.tenant_id AND d.id = document_access_codes.documento_id AND d.status = 'assinado'));
