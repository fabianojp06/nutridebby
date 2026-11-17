CREATE TABLE "lembretes_rotina" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"config" jsonb NOT NULL,
	"texto" text,
	"ligado" boolean DEFAULT true NOT NULL,
	"desligado_pelo_paciente_em" timestamp with time zone,
	"criado_por" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lembretes_rotina_tenant_paciente_id_unique" UNIQUE("tenant_id","patient_id","id"),
	CONSTRAINT "lembretes_rotina_tipo_valido" CHECK ("lembretes_rotina"."tipo" in ('agua', 'refeicoes', 'suplemento', 'livre')),
	CONSTRAINT "lembretes_rotina_texto_por_tipo" CHECK (("lembretes_rotina"."tipo" in ('agua', 'refeicoes') and "lembretes_rotina"."texto" is null) or ("lembretes_rotina"."tipo" = 'suplemento' and "lembretes_rotina"."texto" is not null and char_length(btrim("lembretes_rotina"."texto")) between 1 and 60) or ("lembretes_rotina"."tipo" = 'livre' and "lembretes_rotina"."texto" is not null and char_length(btrim("lembretes_rotina"."texto")) between 1 and 120))
);
--> statement-breakpoint
CREATE TABLE "lembretes_rotina_envios" (
	"lembrete_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"ultimo_slot_em" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "lembretes_pausados_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lembretes_rotina" ADD CONSTRAINT "lembretes_rotina_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lembretes_rotina" ADD CONSTRAINT "lembretes_rotina_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lembretes_rotina_envios" ADD CONSTRAINT "lembretes_rotina_envios_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lembretes_rotina_envios" ADD CONSTRAINT "lembretes_rotina_envios_lembrete_fk" FOREIGN KEY ("tenant_id","patient_id","lembrete_id") REFERENCES "public"."lembretes_rotina"("tenant_id","patient_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lembretes_rotina_um_por_tipo" ON "lembretes_rotina" USING btree ("tenant_id","patient_id","tipo") WHERE "lembretes_rotina"."tipo" in ('agua', 'refeicoes');