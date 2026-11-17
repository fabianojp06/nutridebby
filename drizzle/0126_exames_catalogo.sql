CREATE TABLE "exames_catalogo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"unidade" text,
	"sinonimos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"componentes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"faixas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"modelo_nota_abaixo" text,
	"modelo_nota_acima" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exames_catalogo_nome_tamanho" CHECK (char_length("exames_catalogo"."nome") between 1 and 80),
	CONSTRAINT "exames_catalogo_unidade_tamanho" CHECK ("exames_catalogo"."unidade" is null or char_length("exames_catalogo"."unidade") between 1 and 20),
	CONSTRAINT "exames_catalogo_sinonimos" CHECK (case when jsonb_typeof("exames_catalogo"."sinonimos") = 'array' then jsonb_array_length("exames_catalogo"."sinonimos") <= 10 else false end),
	CONSTRAINT "exames_catalogo_componentes" CHECK (case when jsonb_typeof("exames_catalogo"."componentes") = 'array' then jsonb_array_length("exames_catalogo"."componentes") <= 30 else false end),
	CONSTRAINT "exames_catalogo_faixas" CHECK (case when jsonb_typeof("exames_catalogo"."faixas") = 'array' then jsonb_array_length("exames_catalogo"."faixas") <= 20 else false end),
	CONSTRAINT "exames_catalogo_modelo_nota_abaixo_tamanho" CHECK ("exames_catalogo"."modelo_nota_abaixo" is null or char_length("exames_catalogo"."modelo_nota_abaixo") <= 1000),
	CONSTRAINT "exames_catalogo_modelo_nota_acima_tamanho" CHECK ("exames_catalogo"."modelo_nota_acima" is null or char_length("exames_catalogo"."modelo_nota_acima") <= 1000),
	CONSTRAINT "exames_catalogo_painel" CHECK ("exames_catalogo"."componentes" = '[]'::jsonb or ("exames_catalogo"."unidade" is null and "exames_catalogo"."faixas" = '[]'::jsonb and "exames_catalogo"."modelo_nota_abaixo" is null and "exames_catalogo"."modelo_nota_acima" is null)),
	CONSTRAINT "exames_catalogo_faixa_com_unidade" CHECK ("exames_catalogo"."unidade" is not null or "exames_catalogo"."faixas" = '[]'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "exames_modelos_solicitacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"exames" jsonb NOT NULL,
	"orientacoes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exames_modelos_solicitacao_nome_tamanho" CHECK (char_length("exames_modelos_solicitacao"."nome") between 1 and 80),
	CONSTRAINT "exames_modelos_solicitacao_exames" CHECK (case when jsonb_typeof("exames_modelos_solicitacao"."exames") = 'array' then jsonb_array_length("exames_modelos_solicitacao"."exames") between 1 and 40 else false end),
	CONSTRAINT "exames_modelos_solicitacao_orientacoes_tamanho" CHECK (char_length("exames_modelos_solicitacao"."orientacoes") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "exam_interpretacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"versao" smallint NOT NULL,
	"texto" text,
	"criado_por" uuid NOT NULL,
	"criado_em" timestamp with time zone NOT NULL,
	CONSTRAINT "exam_interpretacoes_versao_unique" UNIQUE("tenant_id","exam_id","versao"),
	CONSTRAINT "exam_interpretacoes_versao_valida" CHECK ("exam_interpretacoes"."versao" >= 1),
	CONSTRAINT "exam_interpretacoes_texto_tamanho" CHECK ("exam_interpretacoes"."texto" is null or char_length("exam_interpretacoes"."texto") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "exam_versoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"versao" smallint NOT NULL,
	"titulo" text NOT NULL,
	"data" date NOT NULL,
	"valores" jsonb NOT NULL,
	"justificativa" text,
	"alterado_por" uuid NOT NULL,
	"alterado_em" timestamp with time zone NOT NULL,
	CONSTRAINT "exam_versoes_versao_unique" UNIQUE("tenant_id","exam_id","versao"),
	CONSTRAINT "exam_versoes_versao_valida" CHECK ("exam_versoes"."versao" >= 1),
	CONSTRAINT "exam_versoes_justificativa_tamanho" CHECK ("exam_versoes"."justificativa" is null or char_length("exam_versoes"."justificativa") between 5 and 500)
);
--> statement-breakpoint
ALTER TABLE "document_verifications" DROP CONSTRAINT "document_verifications_tipo_valido";--> statement-breakpoint
ALTER TABLE "signed_documents" DROP CONSTRAINT "signed_documents_tipo_valido";--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "mostrar_no_app_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exames_catalogo" ADD CONSTRAINT "exames_catalogo_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exames_modelos_solicitacao" ADD CONSTRAINT "exames_modelos_solicitacao_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_interpretacoes" ADD CONSTRAINT "exam_interpretacoes_exame_fk" FOREIGN KEY ("tenant_id","patient_id","exam_id") REFERENCES "public"."exams"("tenant_id","patient_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_versoes" ADD CONSTRAINT "exam_versoes_exame_fk" FOREIGN KEY ("tenant_id","patient_id","exam_id") REFERENCES "public"."exams"("tenant_id","patient_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exames_catalogo_nome_unico" ON "exames_catalogo" USING btree ("tenant_id",lower("nome"));--> statement-breakpoint
CREATE UNIQUE INDEX "exames_modelos_solicitacao_nome_unico" ON "exames_modelos_solicitacao" USING btree ("tenant_id",lower("nome"));--> statement-breakpoint
ALTER TABLE "document_verifications" ADD CONSTRAINT "document_verifications_tipo_valido" CHECK ("document_verifications"."tipo" in ('receita','parecer','solicitacao_exames'));--> statement-breakpoint
ALTER TABLE "signed_documents" ADD CONSTRAINT "signed_documents_tipo_valido" CHECK ("signed_documents"."tipo" in ('receita','parecer','solicitacao_exames'));