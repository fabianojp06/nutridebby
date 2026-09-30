CREATE TABLE "exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"data" date NOT NULL,
	"titulo" text NOT NULL,
	"arquivo_path" text,
	"valores" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exams_titulo_tamanho" CHECK (char_length("exams"."titulo") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_arquivo_path_stored_files_caminho_fk" FOREIGN KEY ("arquivo_path") REFERENCES "public"."stored_files"("caminho") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exams_paciente_data_idx" ON "exams" USING btree ("tenant_id","patient_id","data");