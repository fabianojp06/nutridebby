CREATE TABLE "exam_submission_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"arquivo_path" text NOT NULL,
	"papel" text NOT NULL,
	"ordem" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_submission_files_arquivo_unique" UNIQUE("arquivo_path"),
	CONSTRAINT "exam_submission_files_papel_valido" CHECK (("exam_submission_files"."papel" = 'original' and "exam_submission_files"."arquivo_path" like "exam_submission_files"."tenant_id"::text || '/exame_original/%') or ("exam_submission_files"."papel" = 'pagina' and "exam_submission_files"."arquivo_path" like "exam_submission_files"."tenant_id"::text || '/exame_pagina/%')),
	CONSTRAINT "exam_submission_files_ordem_valida" CHECK ("exam_submission_files"."ordem" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "exam_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"enviado_por" uuid NOT NULL,
	"status" text DEFAULT 'processando' NOT NULL,
	"data_coleta" date NOT NULL,
	"nome" text,
	"observacao" text,
	"arquivo_path" text,
	"motivo_recusa" text,
	"motivo_recusa_texto" text,
	"motivo_falha" text,
	"exam_id" uuid,
	"revisado_por" uuid,
	"revisado_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_submissions_tenant_paciente_id_unique" UNIQUE("tenant_id","patient_id","id"),
	CONSTRAINT "exam_submissions_status_valido" CHECK ("exam_submissions"."status" in ('processando', 'recebido', 'aceito', 'recusado', 'cancelado', 'expirado', 'falhou')),
	CONSTRAINT "exam_submissions_nome_tamanho" CHECK ("exam_submissions"."nome" is null or char_length("exam_submissions"."nome") between 1 and 120),
	CONSTRAINT "exam_submissions_observacao_tamanho" CHECK ("exam_submissions"."observacao" is null or char_length("exam_submissions"."observacao") between 1 and 500),
	CONSTRAINT "exam_submissions_arquivo_valido" CHECK ("exam_submissions"."arquivo_path" is null or ("exam_submissions"."status" in ('recebido', 'cancelado') and "exam_submissions"."arquivo_path" like "exam_submissions"."tenant_id"::text || '/exame/%')),
	CONSTRAINT "exam_submissions_recusa" CHECK (("exam_submissions"."status" = 'recusado') = ("exam_submissions"."motivo_recusa" is not null) and ("exam_submissions"."motivo_recusa" is null or "exam_submissions"."motivo_recusa" in ('ilegivel', 'nao_e_exame', 'outra_pessoa', 'repetido', 'outro'))),
	CONSTRAINT "exam_submissions_recusa_texto" CHECK (("exam_submissions"."motivo_recusa_texto" is not null) = ("exam_submissions"."motivo_recusa" is not distinct from 'outro') and ("exam_submissions"."motivo_recusa_texto" is null or char_length("exam_submissions"."motivo_recusa_texto") between 1 and 300)),
	CONSTRAINT "exam_submissions_exame_so_aceito" CHECK ("exam_submissions"."exam_id" is null or "exam_submissions"."status" = 'aceito'),
	CONSTRAINT "exam_submissions_revisao" CHECK (("exam_submissions"."status" in ('aceito', 'recusado')) = ("exam_submissions"."revisado_em" is not null) and ("exam_submissions"."revisado_em" is null) = ("exam_submissions"."revisado_por" is null)),
	CONSTRAINT "exam_submissions_falha" CHECK (("exam_submissions"."status" = 'falhou') = ("exam_submissions"."motivo_falha" is not null) and ("exam_submissions"."motivo_falha" is null or "exam_submissions"."motivo_falha" in ('conversao', 'paginas', 'cota', 'interrompido')))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_tipo_valido";--> statement-breakpoint
ALTER TABLE "stored_files" DROP CONSTRAINT "stored_files_tipo_valido";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "exames_paciente_ativado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "exames_aviso_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exam_submission_files" ADD CONSTRAINT "exam_submission_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_submission_files" ADD CONSTRAINT "exam_submission_files_arquivo_path_stored_files_caminho_fk" FOREIGN KEY ("arquivo_path") REFERENCES "public"."stored_files"("caminho") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_submission_files" ADD CONSTRAINT "exam_submission_files_envio_fk" FOREIGN KEY ("tenant_id","patient_id","submission_id") REFERENCES "public"."exam_submissions"("tenant_id","patient_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_submissions" ADD CONSTRAINT "exam_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_submissions" ADD CONSTRAINT "exam_submissions_arquivo_path_stored_files_caminho_fk" FOREIGN KEY ("arquivo_path") REFERENCES "public"."stored_files"("caminho") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_submissions" ADD CONSTRAINT "exam_submissions_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exam_submission_files_ordem_idx" ON "exam_submission_files" USING btree ("submission_id","papel","ordem");--> statement-breakpoint
CREATE INDEX "exam_submission_files_envio_idx" ON "exam_submission_files" USING btree ("tenant_id","submission_id");--> statement-breakpoint
CREATE INDEX "exam_submissions_fila_idx" ON "exam_submissions" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "exam_submissions_paciente_idx" ON "exam_submissions" USING btree ("tenant_id","patient_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tipo_valido" CHECK ("notifications"."tipo" in ('lembrete_24h', 'lembrete_2h', 'consulta_marcada', 'consulta_cancelada', 'convite_paciente', 'resposta_confirmacao', 'resposta_remarcar', 'push_teste', 'comentario_diario', 'plano_novo', 'conteudo_novo', 'documento_novo', 'documento_atualizado', 'exame_revisado', 'exame_expirado'));--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_tipo_valido" CHECK ("stored_files"."tipo" in ('logo','capa','exame','plano_pdf','diario_foto','diario_foto_original','orientacao_pdf','exportacao','documento_base','documento_assinado','documento_digitalizado','exame_original','exame_pagina'));