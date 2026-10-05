CREATE TABLE "document_access_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"documento_id" uuid NOT NULL,
	"codigo_hash" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"tentativas" smallint DEFAULT 0 NOT NULL,
	"usado_em" timestamp with time zone,
	"sessao_hash" text,
	"sessao_expira_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_access_codes_tentativas" CHECK ("document_access_codes"."tentativas" between 0 and 5),
	CONSTRAINT "document_access_codes_sessao" CHECK (("document_access_codes"."sessao_hash" is null) = ("document_access_codes"."sessao_expira_em" is null) and ("document_access_codes"."sessao_hash" is null or "document_access_codes"."usado_em" is not null))
);
--> statement-breakpoint
CREATE TABLE "document_verifications" (
	"codigo" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"documento_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"situacao" text DEFAULT 'valido' NOT NULL,
	"situacao_em" timestamp with time zone DEFAULT now() NOT NULL,
	"assinado_em" timestamp with time zone NOT NULL,
	"emissor_nome" text NOT NULL,
	"emissor_crn" text NOT NULL,
	"assinante_nome" text,
	"assinatura_tipo" text NOT NULL,
	"pdf_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_verifications_documento_unique" UNIQUE("documento_id"),
	CONSTRAINT "document_verifications_situacao_valida" CHECK ("document_verifications"."situacao" in ('valido','substituido','cancelado','eliminado')),
	CONSTRAINT "document_verifications_codigo_formato" CHECK ("document_verifications"."codigo" ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),
	CONSTRAINT "document_verifications_assinante" CHECK (("document_verifications"."assinatura_tipo" = 'digitalizada') = ("document_verifications"."assinante_nome" is null)),
	CONSTRAINT "document_verifications_assinatura_tipo_valida" CHECK ("document_verifications"."assinatura_tipo" in ('digitalizada'))
);
--> statement-breakpoint
CREATE TABLE "signed_document_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"documento_id" uuid NOT NULL,
	"justificativa_uso" text,
	"motivo_cancelamento" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signed_document_notes_documento_unique" UNIQUE("documento_id"),
	CONSTRAINT "signed_document_notes_tamanhos" CHECK (coalesce(char_length("signed_document_notes"."justificativa_uso"), 0) <= 2000 and coalesce(char_length("signed_document_notes"."motivo_cancelamento"), 0) <= 500)
);
--> statement-breakpoint
CREATE TABLE "signed_document_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"documento_id" uuid NOT NULL,
	"evento" text NOT NULL,
	"via" text NOT NULL,
	"em" timestamp with time zone DEFAULT now() NOT NULL,
	"registrado_por" uuid,
	CONSTRAINT "signed_document_receipts_um_por_evento" UNIQUE("documento_id","evento"),
	CONSTRAINT "signed_document_receipts_evento_valido" CHECK ("signed_document_receipts"."evento" in ('aberto','recebido')),
	CONSTRAINT "signed_document_receipts_via_valida" CHECK ("signed_document_receipts"."via" in ('portal','link_email','pessoalmente')),
	CONSTRAINT "signed_document_receipts_pessoalmente" CHECK (("signed_document_receipts"."via" = 'pessoalmente') = ("signed_document_receipts"."registrado_por" is not null) and ("signed_document_receipts"."via" <> 'pessoalmente' or "signed_document_receipts"."evento" = 'recebido'))
);
--> statement-breakpoint
CREATE TABLE "signed_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"tipo" text DEFAULT 'receita' NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"versao" smallint DEFAULT 1 NOT NULL,
	"retifica_id" uuid,
	"conteudo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"declaracao_em" timestamp with time zone,
	"codigo" text,
	"base_pdf_path" text,
	"base_pdf_sha256" text,
	"base_pdf_bytes" integer,
	"area_assinatura" jsonb,
	"pdf_status" text,
	"pdf_pedido_em" timestamp with time zone,
	"pdf_path" text,
	"pdf_sha256" text,
	"assinatura_tipo" text,
	"assinatura_emissor" text,
	"assinante_nome" text,
	"assinado_em" timestamp with time zone,
	"assinado_por" uuid,
	"entregue_em" timestamp with time zone,
	"cancelado_em" timestamp with time zone,
	"substituido_em" timestamp with time zone,
	"anonimizado_em" timestamp with time zone,
	"digitalizacao" jsonb,
	"digitalizacao_status" text,
	"digitalizacao_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signed_documents_codigo_unique" UNIQUE("codigo"),
	CONSTRAINT "signed_documents_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "signed_documents_tenant_paciente_id_unique" UNIQUE("tenant_id","patient_id","id"),
	CONSTRAINT "signed_documents_tipo_valido" CHECK ("signed_documents"."tipo" in ('receita')),
	CONSTRAINT "signed_documents_status_valido" CHECK ("signed_documents"."status" in ('rascunho','preparando','aguardando_assinatura','assinado','substituido','cancelado')),
	CONSTRAINT "signed_documents_codigo_so_fora_do_rascunho" CHECK (("signed_documents"."codigo" is null) = ("signed_documents"."status" = 'rascunho')),
	CONSTRAINT "signed_documents_codigo_formato" CHECK ("signed_documents"."codigo" is null or "signed_documents"."codigo" ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),
	CONSTRAINT "signed_documents_emitido_com_pdf" CHECK ("signed_documents"."anonimizado_em" is not null or (("signed_documents"."pdf_path" is not null and "signed_documents"."pdf_sha256" is not null and "signed_documents"."assinado_em" is not null and "signed_documents"."assinatura_tipo" is not null) = ("signed_documents"."status" in ('assinado','substituido','cancelado')))),
	CONSTRAINT "signed_documents_assinatura_tipo_valida" CHECK ("signed_documents"."assinatura_tipo" is null or "signed_documents"."assinatura_tipo" in ('digitalizada')),
	CONSTRAINT "signed_documents_pdf_status_valido" CHECK ("signed_documents"."pdf_status" is null or "signed_documents"."pdf_status" in ('pendente','pronto','falhou','sem_cota')),
	CONSTRAINT "signed_documents_digitalizacao_status_valido" CHECK ("signed_documents"."digitalizacao_status" is null or "signed_documents"."digitalizacao_status" in ('recebendo','pendente','falhou')),
	CONSTRAINT "signed_documents_sha256_formato" CHECK (("signed_documents"."pdf_sha256" is null or "signed_documents"."pdf_sha256" ~ '^[0-9a-f]{64}$') and ("signed_documents"."base_pdf_sha256" is null or "signed_documents"."base_pdf_sha256" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "signed_documents_textos_tamanho" CHECK (coalesce(char_length("signed_documents"."assinante_nome"), 0) <= 200 and coalesce(char_length("signed_documents"."assinatura_emissor"), 0) <= 200),
	CONSTRAINT "signed_documents_arquivos_do_tenant" CHECK (("signed_documents"."base_pdf_path" is null or "signed_documents"."base_pdf_path" like "signed_documents"."tenant_id"::text || '/documento_base/%') and ("signed_documents"."pdf_path" is null or "signed_documents"."pdf_path" like "signed_documents"."tenant_id"::text || '/documento_%')),
	CONSTRAINT "signed_documents_versao_positiva" CHECK ("signed_documents"."versao" >= 1)
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_tipo_valido";--> statement-breakpoint
ALTER TABLE "stored_files" DROP CONSTRAINT "stored_files_tipo_valido";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "nome_profissional" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "contato_email" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "contato_telefone_e164" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "fitoterapia_registro" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "fitoterapia_declarada_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "fitoterapia_termo_versao" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "documentos_liberados" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "document_access_codes" ADD CONSTRAINT "document_access_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_codes" ADD CONSTRAINT "document_access_codes_documento_fk" FOREIGN KEY ("tenant_id","patient_id","documento_id") REFERENCES "public"."signed_documents"("tenant_id","patient_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_verifications" ADD CONSTRAINT "document_verifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signed_document_notes" ADD CONSTRAINT "signed_document_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signed_document_notes" ADD CONSTRAINT "signed_document_notes_documento_fk" FOREIGN KEY ("tenant_id","patient_id","documento_id") REFERENCES "public"."signed_documents"("tenant_id","patient_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signed_document_receipts" ADD CONSTRAINT "signed_document_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signed_document_receipts" ADD CONSTRAINT "signed_document_receipts_documento_fk" FOREIGN KEY ("tenant_id","patient_id","documento_id") REFERENCES "public"."signed_documents"("tenant_id","patient_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signed_documents" ADD CONSTRAINT "signed_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signed_documents" ADD CONSTRAINT "signed_documents_base_pdf_path_stored_files_caminho_fk" FOREIGN KEY ("base_pdf_path") REFERENCES "public"."stored_files"("caminho") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signed_documents" ADD CONSTRAINT "signed_documents_pdf_path_stored_files_caminho_fk" FOREIGN KEY ("pdf_path") REFERENCES "public"."stored_files"("caminho") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signed_documents" ADD CONSTRAINT "signed_documents_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signed_documents" ADD CONSTRAINT "signed_documents_retifica_fk" FOREIGN KEY ("tenant_id","patient_id","retifica_id") REFERENCES "public"."signed_documents"("tenant_id","patient_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_access_codes_documento_idx" ON "document_access_codes" USING btree ("tenant_id","documento_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "signed_documents_retificacao_aberta" ON "signed_documents" USING btree ("retifica_id") WHERE "signed_documents"."status" in ('rascunho','preparando','aguardando_assinatura');--> statement-breakpoint
CREATE INDEX "signed_documents_paciente_idx" ON "signed_documents" USING btree ("tenant_id","patient_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "signed_documents_status_idx" ON "signed_documents" USING btree ("tenant_id","status");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tipo_valido" CHECK ("notifications"."tipo" in ('lembrete_24h', 'lembrete_2h', 'consulta_marcada', 'consulta_cancelada', 'convite_paciente', 'resposta_confirmacao', 'resposta_remarcar', 'push_teste', 'comentario_diario', 'plano_novo', 'conteudo_novo', 'documento_novo', 'documento_atualizado'));--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_tipo_valido" CHECK ("stored_files"."tipo" in ('logo','capa','exame','plano_pdf','diario_foto','diario_foto_original','orientacao_pdf','exportacao','documento_base','documento_assinado','documento_digitalizado'));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_nome_profissional_tamanho" CHECK ("tenants"."nome_profissional" is null or char_length("tenants"."nome_profissional") between 5 and 120);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_fitoterapia_junta" CHECK (("tenants"."fitoterapia_registro" is null) = ("tenants"."fitoterapia_declarada_em" is null) and ("tenants"."fitoterapia_registro" is null) = ("tenants"."fitoterapia_termo_versao" is null));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_fitoterapia_tamanho" CHECK ("tenants"."fitoterapia_registro" is null or char_length("tenants"."fitoterapia_registro") between 1 and 60);