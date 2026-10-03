CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"canal" text NOT NULL,
	"tipo" text NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"motivo_ignorada" text,
	"erro" text,
	"provider_msg_id" text,
	"provider_jid" text,
	"conteudo_selado" text,
	"tentativas" smallint DEFAULT 0 NOT NULL,
	"inicio_consulta" timestamp with time zone,
	"agendada_para" timestamp with time zone NOT NULL,
	"enviada_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_provider_msg_id_unique" UNIQUE("provider_msg_id"),
	CONSTRAINT "notifications_consulta_versao_unique" UNIQUE("appointment_id","canal","tipo","inicio_consulta"),
	CONSTRAINT "notifications_canal_valido" CHECK ("notifications"."canal" in ('email', 'whatsapp', 'push')),
	CONSTRAINT "notifications_tipo_valido" CHECK ("notifications"."tipo" in ('lembrete_24h', 'lembrete_2h', 'consulta_marcada', 'consulta_cancelada', 'convite_paciente', 'resposta_confirmacao', 'resposta_remarcar')),
	CONSTRAINT "notifications_status_valido" CHECK ("notifications"."status" in ('pendente', 'enviando', 'enviada', 'entregue', 'lida', 'falhou', 'ignorada')),
	CONSTRAINT "notifications_motivo_so_ignorada" CHECK (("notifications"."status" = 'ignorada') = ("notifications"."motivo_ignorada" is not null)),
	CONSTRAINT "notifications_erro_tamanho" CHECK (char_length("notifications"."erro") <= 60),
	CONSTRAINT "notifications_versao_da_consulta" CHECK (("notifications"."appointment_id" is null) = ("notifications"."inicio_consulta" is null))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_consulta_fk" FOREIGN KEY ("tenant_id","patient_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","patient_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_devidas_idx" ON "notifications" USING btree ("tenant_id","status","agendada_para");--> statement-breakpoint
CREATE INDEX "notifications_envios_idx" ON "notifications" USING btree ("tenant_id","canal","enviada_em");