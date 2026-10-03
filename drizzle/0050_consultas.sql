CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"inicio" timestamp with time zone NOT NULL,
	"fim" timestamp with time zone NOT NULL,
	"modalidade" text NOT NULL,
	"link_online" text,
	"status" text DEFAULT 'agendada' NOT NULL,
	"origem" text NOT NULL,
	"confirmada_via" text,
	"cancelado_por" text,
	"cancelada_em" timestamp with time zone,
	"motivo_cancelamento" text,
	"pedido_remarcacao_em" timestamp with time zone,
	"remarcada_de" uuid,
	"presenca_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "appointments_tenant_paciente_id_unique" UNIQUE("tenant_id","patient_id","id"),
	CONSTRAINT "appointments_periodo_valido" CHECK ("appointments"."fim" > "appointments"."inicio" and "appointments"."fim" - "appointments"."inicio" <= interval '8 hours'),
	CONSTRAINT "appointments_modalidade_valida" CHECK ("appointments"."modalidade" in ('presencial', 'online')),
	CONSTRAINT "appointments_link_online" CHECK (("appointments"."modalidade" = 'presencial' and "appointments"."link_online" is null) or ("appointments"."modalidade" = 'online' and "appointments"."link_online" ~ '^https://' and char_length("appointments"."link_online") <= 500)),
	CONSTRAINT "appointments_status_valido" CHECK ("appointments"."status" in ('agendada', 'confirmada', 'cancelada', 'realizada', 'faltou')),
	CONSTRAINT "appointments_origem_valida" CHECK ("appointments"."origem" in ('nutri', 'paciente')),
	CONSTRAINT "appointments_confirmada_via_valida" CHECK ("appointments"."confirmada_via" is null or "appointments"."confirmada_via" in ('whatsapp', 'link')),
	CONSTRAINT "appointments_cancelado_por_valido" CHECK ("appointments"."cancelado_por" is null or "appointments"."cancelado_por" in ('nutri', 'paciente')),
	CONSTRAINT "appointments_cancelamento_completo" CHECK (("appointments"."status" = 'cancelada') = ("appointments"."cancelado_por" is not null and "appointments"."cancelada_em" is not null)),
	CONSTRAINT "appointments_motivo_tamanho" CHECK (char_length("appointments"."motivo_cancelamento") <= 300)
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_remarcada_de_fk" FOREIGN KEY ("tenant_id","remarcada_de") REFERENCES "public"."appointments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_inicio_idx" ON "appointments" USING btree ("tenant_id","inicio");--> statement-breakpoint
CREATE INDEX "appointments_paciente_idx" ON "appointments" USING btree ("tenant_id","patient_id","inicio");