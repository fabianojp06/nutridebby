CREATE TABLE "aniversario_autorizacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"evento" text NOT NULL,
	"origem" text NOT NULL,
	"registrado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"registrado_por" uuid,
	"forma" text,
	CONSTRAINT "aniversario_autorizacoes_evento_valido" CHECK ("aniversario_autorizacoes"."evento" in ('autorizou', 'retirou')),
	CONSTRAINT "aniversario_autorizacoes_origem_valida" CHECK ("aniversario_autorizacoes"."origem" in ('nutri', 'app', 'link')),
	CONSTRAINT "aniversario_autorizacoes_forma_valida" CHECK ("aniversario_autorizacoes"."forma" is null or "aniversario_autorizacoes"."forma" in ('escrito', 'mensagem', 'verbal')),
	CONSTRAINT "aniversario_autorizacoes_forma" CHECK (("aniversario_autorizacoes"."origem" = 'nutri' and ("aniversario_autorizacoes"."evento" = 'retirou' or "aniversario_autorizacoes"."forma" is not null)) or ("aniversario_autorizacoes"."origem" <> 'nutri' and "aniversario_autorizacoes"."forma" is null)),
	CONSTRAINT "aniversario_autorizacoes_link" CHECK ("aniversario_autorizacoes"."origem" <> 'link' or ("aniversario_autorizacoes"."evento" = 'retirou' and "aniversario_autorizacoes"."registrado_por" is null))
);
--> statement-breakpoint
CREATE TABLE "locais_atendimento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"tipo" text NOT NULL,
	"endereco" text,
	"cidade" text,
	"mostrar_endereco" boolean DEFAULT false NOT NULL,
	"link_sala" text,
	"agendamento_online" boolean DEFAULT false NOT NULL,
	"principal" boolean DEFAULT false NOT NULL,
	"arquivado_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locais_atendimento_tenant_id_tipo_unique" UNIQUE("tenant_id","id","tipo"),
	CONSTRAINT "locais_atendimento_nome_tamanho" CHECK (char_length("locais_atendimento"."nome") between 2 and 60),
	CONSTRAINT "locais_atendimento_tipo_valido" CHECK ("locais_atendimento"."tipo" in ('presencial', 'online')),
	CONSTRAINT "locais_atendimento_endereco" CHECK ("locais_atendimento"."endereco" is null or ("locais_atendimento"."tipo" = 'presencial' and char_length("locais_atendimento"."endereco") <= 300)),
	CONSTRAINT "locais_atendimento_cidade_tamanho" CHECK ("locais_atendimento"."cidade" is null or char_length("locais_atendimento"."cidade") <= 80),
	CONSTRAINT "locais_atendimento_link_sala" CHECK ("locais_atendimento"."link_sala" is null or ("locais_atendimento"."tipo" = 'online' and "locais_atendimento"."link_sala" ~ '^https://\S+$' and char_length("locais_atendimento"."link_sala") <= 500)),
	CONSTRAINT "locais_atendimento_agendamento" CHECK (not "locais_atendimento"."agendamento_online" or ("locais_atendimento"."arquivado_em" is null and ("locais_atendimento"."tipo" = 'presencial' or "locais_atendimento"."link_sala" is not null))),
	CONSTRAINT "locais_atendimento_principal_ativo" CHECK (not "locais_atendimento"."principal" or "locais_atendimento"."arquivado_em" is null)
);
--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_status_valido";--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_cancelado_por_valido";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_tipo_valido";--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "local_id" uuid;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD COLUMN "local_id" uuid;--> statement-breakpoint
ALTER TABLE "public_booking_requests" ADD COLUMN "fim" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "public_booking_requests" ADD COLUMN "local_id" uuid;--> statement-breakpoint
ALTER TABLE "public_booking_requests" ADD COLUMN "aguardando_desde" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "public_booking_requests" ADD COLUMN "resolvido_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "public_booking_requests" ADD COLUMN "resolucao" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "agenda_confirmar_pedidos" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "consultations" ADD COLUMN "retorno_previsto_em" date;--> statement-breakpoint
ALTER TABLE "aniversario_autorizacoes" ADD CONSTRAINT "aniversario_autorizacoes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aniversario_autorizacoes" ADD CONSTRAINT "aniversario_autorizacoes_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locais_atendimento" ADD CONSTRAINT "locais_atendimento_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aniversario_autorizacoes_paciente_idx" ON "aniversario_autorizacoes" USING btree ("tenant_id","patient_id","registrado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "locais_atendimento_principal_unique" ON "locais_atendimento" USING btree ("tenant_id") WHERE "locais_atendimento"."principal" and "locais_atendimento"."arquivado_em" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "locais_atendimento_nome_unique" ON "locais_atendimento" USING btree ("tenant_id",lower("nome")) WHERE "locais_atendimento"."arquivado_em" is null;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_local_fk" FOREIGN KEY ("tenant_id","local_id","modalidade") REFERENCES "public"."locais_atendimento"("tenant_id","id","tipo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_local_fk" FOREIGN KEY ("tenant_id","local_id","modalidade") REFERENCES "public"."locais_atendimento"("tenant_id","id","tipo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_booking_requests" ADD CONSTRAINT "public_booking_requests_local_fk" FOREIGN KEY ("tenant_id","local_id","modalidade") REFERENCES "public"."locais_atendimento"("tenant_id","id","tipo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_local_idx" ON "appointments" USING btree ("tenant_id","local_id","inicio");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_aniversario_unique" ON "notifications" USING btree ("tenant_id","patient_id",(date_part('year', timezone('UTC', "agendada_para")))) WHERE "notifications"."tipo" = 'aniversario';--> statement-breakpoint
CREATE INDEX "public_booking_requests_aguardando_idx" ON "public_booking_requests" USING btree ("tenant_id","inicio") WHERE "public_booking_requests"."aguardando_desde" is not null and "public_booking_requests"."resolvido_em" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "public_booking_requests_aguardando_email_unique" ON "public_booking_requests" USING btree ("tenant_id",lower("email")) WHERE "public_booking_requests"."aguardando_desde" is not null and "public_booking_requests"."resolvido_em" is null;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_solicitada_do_paciente" CHECK ("appointments"."status" <> 'solicitada' or "appointments"."origem" = 'paciente');--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_status_valido" CHECK ("appointments"."status" in ('agendada', 'confirmada', 'cancelada', 'realizada', 'faltou', 'solicitada'));--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelado_por_valido" CHECK ("appointments"."cancelado_por" is null or "appointments"."cancelado_por" in ('nutri', 'paciente', 'sistema', 'pedido_desistido', 'pedido_recusado', 'pedido_vencido'));--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_local_sem_ambas" CHECK ("availability_rules"."local_id" is null or "availability_rules"."modalidade" <> 'ambas');--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tipo_valido" CHECK ("notifications"."tipo" in ('lembrete_24h', 'lembrete_2h', 'consulta_marcada', 'consulta_cancelada', 'convite_paciente', 'resposta_confirmacao', 'resposta_remarcar', 'push_teste', 'comentario_diario', 'plano_novo', 'conteudo_novo', 'documento_novo', 'documento_atualizado', 'exame_revisado', 'exame_expirado', 'duvida_vista', 'aniversario', 'pedido_nao_confirmado'));--> statement-breakpoint
ALTER TABLE "public_booking_requests" ADD CONSTRAINT "public_booking_requests_aguardando_completo" CHECK ("public_booking_requests"."aguardando_desde" is null or ("public_booking_requests"."verificado_em" is not null and "public_booking_requests"."fim" is not null and "public_booking_requests"."local_id" is not null));--> statement-breakpoint
ALTER TABLE "public_booking_requests" ADD CONSTRAINT "public_booking_requests_resolvido_so_aguardando" CHECK ("public_booking_requests"."resolvido_em" is null or "public_booking_requests"."aguardando_desde" is not null);--> statement-breakpoint
ALTER TABLE "public_booking_requests" ADD CONSTRAINT "public_booking_requests_resolucao" CHECK (("public_booking_requests"."resolucao" is null) = ("public_booking_requests"."resolvido_em" is null));--> statement-breakpoint
ALTER TABLE "public_booking_requests" ADD CONSTRAINT "public_booking_requests_resolucao_valida" CHECK ("public_booking_requests"."resolucao" is null or "public_booking_requests"."resolucao" in ('aceito', 'recusado', 'vencido', 'desistido'));--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_retorno_previsto_faixa" CHECK ("consultations"."retorno_previsto_em" is null or "consultations"."retorno_previsto_em" between "consultations"."data" and "consultations"."data" + 730);