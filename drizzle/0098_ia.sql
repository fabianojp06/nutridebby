CREATE TABLE "ia_gasto_plataforma" (
	"mes" text PRIMARY KEY NOT NULL,
	"custo_micro_usd" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ia_gasto_plataforma_valido" CHECK ("ia_gasto_plataforma"."custo_micro_usd" >= 0 and "ia_gasto_plataforma"."mes" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "ia_tarefas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"status" text DEFAULT 'na_fila' NOT NULL,
	"exam_id" uuid,
	"pedido_por" uuid NOT NULL,
	"parametros" jsonb,
	"resultado" jsonb,
	"erro" text,
	"modelo" text NOT NULL,
	"prompt_versao" text NOT NULL,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"reserva_micro_usd" bigint NOT NULL,
	"custo_micro_usd" bigint,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"iniciado_em" timestamp with time zone,
	"enviado_em" timestamp with time zone,
	"saiu_em" timestamp with time zone,
	"concluido_em" timestamp with time zone,
	"expira_em" timestamp with time zone,
	"encerrado_em" timestamp with time zone,
	"encerrado_por" uuid,
	"linhas_aplicadas" integer,
	"exame_data_anterior" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ia_tarefas_tipo_valido" CHECK ("ia_tarefas"."tipo" in ('leitura_exame')),
	CONSTRAINT "ia_tarefas_status_valido" CHECK ("ia_tarefas"."status" in ('na_fila', 'processando', 'pronta', 'falhou', 'aplicada', 'descartada', 'expirada', 'cancelada')),
	CONSTRAINT "ia_tarefas_exame_so_na_leitura" CHECK ("ia_tarefas"."exam_id" is null or "ia_tarefas"."tipo" = 'leitura_exame'),
	CONSTRAINT "ia_tarefas_resultado_so_pronta" CHECK ("ia_tarefas"."resultado" is null or "ia_tarefas"."status" = 'pronta'),
	CONSTRAINT "ia_tarefas_conteudo_esvaziado" CHECK ("ia_tarefas"."status" in ('na_fila', 'processando', 'pronta') or ("ia_tarefas"."parametros" is null and "ia_tarefas"."resultado" is null)),
	CONSTRAINT "ia_tarefas_erro_so_falhou" CHECK (("ia_tarefas"."status" = 'falhou') = ("ia_tarefas"."erro" is not null)),
	CONSTRAINT "ia_tarefas_erro_tamanho" CHECK ("ia_tarefas"."erro" is null or char_length("ia_tarefas"."erro") <= 60),
	CONSTRAINT "ia_tarefas_linhas_so_aplicada" CHECK (("ia_tarefas"."status" = 'aplicada') = ("ia_tarefas"."linhas_aplicadas" is not null)),
	CONSTRAINT "ia_tarefas_reserva_valida" CHECK ("ia_tarefas"."reserva_micro_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ia_uso" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tarefa_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"modelo" text NOT NULL,
	"prompt_versao" text NOT NULL,
	"inference_geo" text,
	"tokens_entrada" integer DEFAULT 0 NOT NULL,
	"tokens_cache_leitura" integer DEFAULT 0 NOT NULL,
	"tokens_cache_gravacao" integer DEFAULT 0 NOT NULL,
	"tokens_saida" integer DEFAULT 0 NOT NULL,
	"custo_micro_usd" bigint NOT NULL,
	"situacao" text DEFAULT 'reservado' NOT NULL,
	"mes" text NOT NULL,
	"recusa_categoria" text,
	"request_id" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ia_uso_situacao_valida" CHECK ("ia_uso"."situacao" in ('reservado', 'confirmado', 'incerto', 'estornado')),
	CONSTRAINT "ia_uso_custo_valido" CHECK ("ia_uso"."custo_micro_usd" >= 0),
	CONSTRAINT "ia_uso_mes_formato" CHECK ("ia_uso"."mes" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "ia_uso_textos_tamanho" CHECK (("ia_uso"."recusa_categoria" is null or char_length("ia_uso"."recusa_categoria") <= 60) and ("ia_uso"."request_id" is null or char_length("ia_uso"."request_id") <= 200) and ("ia_uso"."inference_geo" is null or char_length("ia_uso"."inference_geo") <= 20))
);
--> statement-breakpoint
ALTER TABLE "admin_actions" DROP CONSTRAINT "admin_actions_acao_valida";--> statement-breakpoint
ALTER TABLE "admin_actions" DROP CONSTRAINT "admin_actions_alvo_coerente";--> statement-breakpoint
ALTER TABLE "admin_actions" ADD COLUMN "alvo_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ia_liberada" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ia_ativada_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ia_aditivo_versao" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ia_cota_mensal_usd" numeric(7, 2) DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ia_aviso_mes" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "ia_recusada_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "ia_aviso_versao" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "ia_aviso_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "ia_aviso_canal" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "ia_aviso_enviado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ia_tarefas" ADD CONSTRAINT "ia_tarefas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ia_tarefas" ADD CONSTRAINT "ia_tarefas_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ia_uso" ADD CONSTRAINT "ia_uso_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ia_tarefas_em_andamento_idx" ON "ia_tarefas" USING btree ("tenant_id","patient_id","tipo","exam_id") WHERE "ia_tarefas"."status" in ('na_fila', 'processando');--> statement-breakpoint
CREATE INDEX "ia_tarefas_pedidos_idx" ON "ia_tarefas" USING btree ("tenant_id","pedido_por","criado_em");--> statement-breakpoint
CREATE INDEX "ia_tarefas_status_idx" ON "ia_tarefas" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "ia_tarefas_exame_idx" ON "ia_tarefas" USING btree ("tenant_id","patient_id","exam_id","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "ia_uso_tarefa_idx" ON "ia_uso" USING btree ("tenant_id","tarefa_id");--> statement-breakpoint
CREATE INDEX "ia_uso_mes_idx" ON "ia_uso" USING btree ("tenant_id","mes");--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_alvo_tenant_id_tenants_id_fk" FOREIGN KEY ("alvo_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_tenant_paciente_id_unique" UNIQUE("tenant_id","patient_id","id");--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_acao_valida" CHECK ("admin_actions"."acao" in ('reiniciar_2fa', 'codigo_2fa_recusado', 'liberar_ia', 'bloquear_ia', 'ajustar_cota_ia'));--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_alvo_coerente" CHECK ((("admin_actions"."acao" = 'reiniciar_2fa') = ("admin_actions"."alvo_user_id" is not null and "admin_actions"."alvo_papel" is not null))
          and (("admin_actions"."acao" in ('liberar_ia', 'bloquear_ia', 'ajustar_cota_ia')) = ("admin_actions"."alvo_tenant_id" is not null))
          and (("admin_actions"."acao" in ('liberar_ia', 'bloquear_ia', 'ajustar_cota_ia')) <= ("admin_actions"."alvo_user_id" is null and "admin_actions"."alvo_papel" is null)));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_ia_cota_valida" CHECK ("tenants"."ia_cota_mensal_usd" between 0 and 1000);--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_ia_aviso_junto" CHECK (("patients"."ia_aviso_versao" is null) = ("patients"."ia_aviso_em" is null) and ("patients"."ia_aviso_versao" is null) = ("patients"."ia_aviso_canal" is null));--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_ia_aviso_canal_valido" CHECK ("patients"."ia_aviso_canal" is null or "patients"."ia_aviso_canal" in ('email', 'em_maos', 'portal'));--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_ia_aviso_versao_tamanho" CHECK ("patients"."ia_aviso_versao" is null or char_length("patients"."ia_aviso_versao") <= 40);