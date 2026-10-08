ALTER TABLE "signed_document_notes" DROP CONSTRAINT "signed_document_notes_tamanhos";--> statement-breakpoint
ALTER TABLE "signed_documents" DROP CONSTRAINT "signed_documents_tipo_valido";--> statement-breakpoint
ALTER TABLE "signed_document_notes" ADD COLUMN "motivo_retificacao" text;--> statement-breakpoint
ALTER TABLE "document_verifications" ADD CONSTRAINT "document_verifications_tipo_valido" CHECK ("document_verifications"."tipo" in ('receita','parecer'));--> statement-breakpoint
ALTER TABLE "signed_document_notes" ADD CONSTRAINT "signed_document_notes_tamanhos" CHECK (coalesce(char_length("signed_document_notes"."justificativa_uso"), 0) <= 2000 and coalesce(char_length("signed_document_notes"."motivo_cancelamento"), 0) <= 500 and coalesce(char_length("signed_document_notes"."motivo_retificacao"), 0) <= 500);--> statement-breakpoint
ALTER TABLE "signed_documents" ADD CONSTRAINT "signed_documents_tipo_valido" CHECK ("signed_documents"."tipo" in ('receita','parecer'));