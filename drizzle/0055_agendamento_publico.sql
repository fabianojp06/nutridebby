CREATE TABLE "public_booking_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"codigo_hash" text NOT NULL,
	"email" "citext" NOT NULL,
	"nome" text NOT NULL,
	"telefone_e164" text,
	"whatsapp_optin" boolean DEFAULT false NOT NULL,
	"inicio" timestamp with time zone NOT NULL,
	"modalidade" text NOT NULL,
	"termo_versao" text NOT NULL,
	"ip" text,
	"tentativas" smallint DEFAULT 0 NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"verificado_em" timestamp with time zone,
	"concluido_em" timestamp with time zone,
	"appointment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_booking_requests_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "public_booking_requests_modalidade" CHECK ("public_booking_requests"."modalidade" in ('presencial', 'online')),
	CONSTRAINT "public_booking_requests_nome" CHECK (char_length("public_booking_requests"."nome") between 2 and 120)
);
--> statement-breakpoint
CREATE TABLE "public_rate_limits" (
	"chave" text PRIMARY KEY NOT NULL,
	"janela_inicio" timestamp with time zone NOT NULL,
	"contagem" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consents" DROP CONSTRAINT "consents_user_termo_tenant_unique";--> statement-breakpoint
ALTER TABLE "consents" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "patient_id" uuid;--> statement-breakpoint
ALTER TABLE "public_booking_requests" ADD CONSTRAINT "public_booking_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "public_booking_requests_email_idx" ON "public_booking_requests" USING btree ("tenant_id","email","created_at");--> statement-breakpoint
CREATE INDEX "public_booking_requests_criado_idx" ON "public_booking_requests" USING btree ("tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_titular_termo_unique" UNIQUE NULLS NOT DISTINCT("user_id","termo_versao","tenant_id","patient_id");--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_titular" CHECK ("consents"."user_id" is not null or ("consents"."patient_id" is not null and "consents"."tenant_id" is not null));