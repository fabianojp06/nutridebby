CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"nome" text NOT NULL,
	"data_nascimento" date,
	"sexo" text,
	"telefone_e164" text,
	"email" "citext" NOT NULL,
	"origem" text DEFAULT 'nutri' NOT NULL,
	"whatsapp_optin_em" timestamp with time zone,
	"whatsapp_optin_origem" text,
	"whatsapp_optout_em" timestamp with time zone,
	"status" text DEFAULT 'ativo' NOT NULL,
	"bloqueado_em" timestamp with time zone,
	"anonimizar_apos" date,
	"anonimizado_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_tenant_email_unique" UNIQUE("tenant_id","email"),
	CONSTRAINT "patients_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "patients_sexo_valido" CHECK ("patients"."sexo" is null or "patients"."sexo" in ('F', 'M')),
	CONSTRAINT "patients_origem_valida" CHECK ("patients"."origem" in ('nutri', 'agendamento_publico')),
	CONSTRAINT "patients_status_valido" CHECK ("patients"."status" in ('ativo', 'arquivado', 'bloqueado')),
	CONSTRAINT "patients_optin_origem_valida" CHECK ("patients"."whatsapp_optin_origem" is null or "patients"."whatsapp_optin_origem" in ('nutri', 'paciente')),
	CONSTRAINT "patients_telefone_e164" CHECK ("patients"."telefone_e164" is null or "patients"."telefone_e164" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "patients_nascimento_e_sexo" CHECK ("patients"."origem" = 'agendamento_publico' or "patients"."anonimizado_em" is not null or ("patients"."data_nascimento" is not null and "patients"."sexo" is not null))
);
--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "patients_tenant_user_idx" ON "patients" USING btree ("tenant_id","user_id") WHERE "patients"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "patients_tenant_status_idx" ON "patients" USING btree ("tenant_id","status");