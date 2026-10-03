CREATE TABLE "diary_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"data_hora" timestamp with time zone DEFAULT now() NOT NULL,
	"refeicao" text NOT NULL,
	"texto" text,
	"foto_path" text,
	"foto_original_path" text,
	"foto_status" text DEFAULT 'sem_foto' NOT NULL,
	"comentario_nutri" text,
	"comentado_em" timestamp with time zone,
	"visto_pela_nutri_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diary_entries_refeicao_valida" CHECK ("diary_entries"."refeicao" in ('Café da manhã', 'Lanche da manhã', 'Almoço', 'Lanche da tarde', 'Jantar', 'Ceia', 'Outro')),
	CONSTRAINT "diary_entries_texto_tamanho" CHECK ("diary_entries"."texto" is null or char_length("diary_entries"."texto") between 1 and 2000),
	CONSTRAINT "diary_entries_foto_status_valido" CHECK ("diary_entries"."foto_status" in ('sem_foto', 'processando', 'pronta', 'falhou', 'removida')),
	CONSTRAINT "diary_entries_tem_conteudo" CHECK ("diary_entries"."texto" is not null or "diary_entries"."foto_status" <> 'sem_foto'),
	CONSTRAINT "diary_entries_comentario_tamanho" CHECK ("diary_entries"."comentario_nutri" is null or char_length("diary_entries"."comentario_nutri") between 1 and 1000),
	CONSTRAINT "diary_entries_foto_do_tenant" CHECK ("diary_entries"."foto_path" is null or "diary_entries"."foto_path" like "diary_entries"."tenant_id"::text || '/diario_foto/%'),
	CONSTRAINT "diary_entries_original_do_tenant" CHECK ("diary_entries"."foto_original_path" is null or "diary_entries"."foto_original_path" like "diary_entries"."tenant_id"::text || '/diario_foto_original/%')
);
--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_foto_path_stored_files_caminho_fk" FOREIGN KEY ("foto_path") REFERENCES "public"."stored_files"("caminho") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_foto_original_path_stored_files_caminho_fk" FOREIGN KEY ("foto_original_path") REFERENCES "public"."stored_files"("caminho") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diary_entries_paciente_idx" ON "diary_entries" USING btree ("tenant_id","patient_id","data_hora" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "diary_entries_feed_idx" ON "diary_entries" USING btree ("tenant_id","visto_pela_nutri_em","data_hora" DESC NULLS LAST);