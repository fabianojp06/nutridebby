CREATE TABLE "metas_modelos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"titulo" text NOT NULL,
	"como_fazer" text,
	"categoria" text NOT NULL,
	"lembrete_sugerido" text,
	"arquivado_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metas_modelos_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "metas_modelos_titulo_tamanho" CHECK (char_length("metas_modelos"."titulo") between 3 and 80),
	CONSTRAINT "metas_modelos_como_fazer_tamanho" CHECK ("metas_modelos"."como_fazer" is null or char_length("metas_modelos"."como_fazer") between 1 and 300),
	CONSTRAINT "metas_modelos_categoria_valida" CHECK ("metas_modelos"."categoria" in ('agua', 'alimentacao', 'atividade', 'sono', 'habitos', 'outra')),
	CONSTRAINT "metas_modelos_lembrete_valido" CHECK ("metas_modelos"."lembrete_sugerido" in ('agua', 'refeicoes', 'suplemento', 'livre'))
);
--> statement-breakpoint
CREATE TABLE "metas_paciente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"modelo_id" uuid,
	"titulo" text NOT NULL,
	"como_fazer" text,
	"categoria" text NOT NULL,
	"lembrete_sugerido" text,
	"inicio" date NOT NULL,
	"fim" date,
	"situacao" text DEFAULT 'ativa' NOT NULL,
	"encerrada_em" timestamp with time zone,
	"criado_por" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metas_paciente_tenant_paciente_id_unique" UNIQUE("tenant_id","patient_id","id"),
	CONSTRAINT "metas_paciente_titulo_tamanho" CHECK (char_length("metas_paciente"."titulo") between 3 and 80),
	CONSTRAINT "metas_paciente_como_fazer_tamanho" CHECK ("metas_paciente"."como_fazer" is null or char_length("metas_paciente"."como_fazer") between 1 and 300),
	CONSTRAINT "metas_paciente_categoria_valida" CHECK ("metas_paciente"."categoria" in ('agua', 'alimentacao', 'atividade', 'sono', 'habitos', 'outra')),
	CONSTRAINT "metas_paciente_lembrete_valido" CHECK ("metas_paciente"."lembrete_sugerido" in ('agua', 'refeicoes', 'suplemento', 'livre')),
	CONSTRAINT "metas_paciente_fim_faixa" CHECK ("metas_paciente"."fim" is null or ("metas_paciente"."fim" >= "metas_paciente"."inicio" and "metas_paciente"."fim" <= "metas_paciente"."inicio" + 365)),
	CONSTRAINT "metas_paciente_situacao_valida" CHECK ("metas_paciente"."situacao" in ('ativa', 'alcancada', 'encerrada')),
	CONSTRAINT "metas_paciente_encerramento_coerente" CHECK (("metas_paciente"."situacao" = 'ativa') = ("metas_paciente"."encerrada_em" is null))
);
--> statement-breakpoint
CREATE TABLE "metas_registros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"meta_id" uuid NOT NULL,
	"dia" date NOT NULL,
	"cumprida" boolean NOT NULL,
	"registrado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questionario_envios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"modelo_id" uuid,
	"modelo_snapshot" jsonb NOT NULL,
	"origem" text NOT NULL,
	"enviado_por" uuid,
	"enviado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"situacao" text DEFAULT 'enviado' NOT NULL,
	"respostas" jsonb,
	"respondido_em" timestamp with time zone,
	"respondido_via" text,
	"cancelado_em" timestamp with time zone,
	"cancelado_por" uuid,
	"cancelado_motivo" text,
	"anamnese_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questionario_envios_tenant_paciente_id_unique" UNIQUE("tenant_id","patient_id","id"),
	CONSTRAINT "questionario_envios_snapshot_objeto" CHECK (jsonb_typeof("questionario_envios"."modelo_snapshot") = 'object'),
	CONSTRAINT "questionario_envios_origem_valida" CHECK ("questionario_envios"."origem" in ('nutri', 'automatico')),
	CONSTRAINT "questionario_envios_origem_coerente" CHECK (("questionario_envios"."origem" = 'nutri') = ("questionario_envios"."enviado_por" is not null)),
	CONSTRAINT "questionario_envios_prazo" CHECK ("questionario_envios"."expira_em" > "questionario_envios"."enviado_em"),
	CONSTRAINT "questionario_envios_situacao_valida" CHECK ("questionario_envios"."situacao" in ('enviado', 'respondido', 'cancelado', 'expirado')),
	CONSTRAINT "questionario_envios_respostas_tamanho" CHECK ("questionario_envios"."respostas" is null or (jsonb_typeof("questionario_envios"."respostas") = 'object' and octet_length("questionario_envios"."respostas"::text) <= 2000000)),
	CONSTRAINT "questionario_envios_via_valida" CHECK ("questionario_envios"."respondido_via" in ('app', 'link')),
	CONSTRAINT "questionario_envios_resposta_coerente" CHECK (("questionario_envios"."situacao" = 'respondido') = ("questionario_envios"."respostas" is not null and "questionario_envios"."respondido_em" is not null and "questionario_envios"."respondido_via" is not null)),
	CONSTRAINT "questionario_envios_motivo_valido" CHECK ("questionario_envios"."cancelado_motivo" in ('nutri', 'consulta_cancelada', 'paciente_bloqueado')),
	CONSTRAINT "questionario_envios_cancelamento_coerente" CHECK (("questionario_envios"."situacao" = 'cancelado') = ("questionario_envios"."cancelado_em" is not null and "questionario_envios"."cancelado_motivo" is not null)),
	CONSTRAINT "questionario_envios_cancelado_pela_nutri" CHECK ("questionario_envios"."cancelado_motivo" is distinct from 'nutri' or "questionario_envios"."cancelado_por" is not null),
	CONSTRAINT "questionario_envios_anamnese_so_respondido" CHECK ("questionario_envios"."anamnese_id" is null or "questionario_envios"."situacao" = 'respondido')
);
--> statement-breakpoint
CREATE TABLE "recordatorio_itens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"recordatorio_id" uuid NOT NULL,
	"refeicao" text NOT NULL,
	"refeicao_nome" text,
	"horario" time,
	"local" text,
	"food_id" uuid,
	"alimento_nome" text,
	"quantidade_g" numeric(7, 2),
	"medida" jsonb,
	"medida_caseira_txt" text,
	"nutrientes" jsonb,
	"descricao" text,
	"ordem" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recordatorio_itens_refeicao_valida" CHECK ("recordatorio_itens"."refeicao" in ('Café da manhã', 'Lanche da manhã', 'Almoço', 'Lanche da tarde', 'Jantar', 'Ceia', 'Outro')),
	CONSTRAINT "recordatorio_itens_refeicao_nome" CHECK (("recordatorio_itens"."refeicao" = 'Outro') = ("recordatorio_itens"."refeicao_nome" is not null) and ("recordatorio_itens"."refeicao_nome" is null or char_length("recordatorio_itens"."refeicao_nome") between 2 and 40)),
	CONSTRAINT "recordatorio_itens_local_tamanho" CHECK ("recordatorio_itens"."local" is null or char_length("recordatorio_itens"."local") between 2 and 60),
	CONSTRAINT "recordatorio_itens_alimento_nome_tamanho" CHECK ("recordatorio_itens"."alimento_nome" is null or char_length("recordatorio_itens"."alimento_nome") between 2 and 200),
	CONSTRAINT "recordatorio_itens_quantidade_faixa" CHECK ("recordatorio_itens"."quantidade_g" is null or "recordatorio_itens"."quantidade_g" between 0.1 and 5000),
	CONSTRAINT "recordatorio_itens_descricao_tamanho" CHECK ("recordatorio_itens"."descricao" is null or (char_length("recordatorio_itens"."descricao") between 1 and 200 and ("recordatorio_itens"."alimento_nome" is not null or char_length("recordatorio_itens"."descricao") between 2 and 120))),
	CONSTRAINT "recordatorio_itens_tipo" CHECK (("recordatorio_itens"."alimento_nome" is not null and "recordatorio_itens"."quantidade_g" is not null) or ("recordatorio_itens"."food_id" is null and "recordatorio_itens"."alimento_nome" is null and "recordatorio_itens"."quantidade_g" is null and "recordatorio_itens"."nutrientes" is null and "recordatorio_itens"."descricao" is not null))
);
--> statement-breakpoint
CREATE TABLE "recordatorios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"dia_relatado" date NOT NULL,
	"dia_atipico" boolean DEFAULT false NOT NULL,
	"observacao" text,
	"criado_por" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recordatorios_tenant_paciente_id_unique" UNIQUE("tenant_id","patient_id","id"),
	CONSTRAINT "recordatorios_observacao_tamanho" CHECK ("recordatorios"."observacao" is null or char_length("recordatorios"."observacao") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_tipo_valido";--> statement-breakpoint
DROP INDEX "anamnesis_templates_padrao_idx";--> statement-breakpoint
ALTER TABLE "anamnesis_templates" ADD COLUMN "finalidade" text DEFAULT 'anamnese' NOT NULL;--> statement-breakpoint
ALTER TABLE "anamnesis_templates" ADD COLUMN "envio_auto" text;--> statement-breakpoint
ALTER TABLE "anamnesis_templates" ADD COLUMN "envio_auto_dias" smallint;--> statement-breakpoint
ALTER TABLE "metas_modelos" ADD CONSTRAINT "metas_modelos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metas_paciente" ADD CONSTRAINT "metas_paciente_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metas_paciente" ADD CONSTRAINT "metas_paciente_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metas_registros" ADD CONSTRAINT "metas_registros_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metas_registros" ADD CONSTRAINT "metas_registros_meta_fk" FOREIGN KEY ("tenant_id","patient_id","meta_id") REFERENCES "public"."metas_paciente"("tenant_id","patient_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionario_envios" ADD CONSTRAINT "questionario_envios_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionario_envios" ADD CONSTRAINT "questionario_envios_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionario_envios" ADD CONSTRAINT "questionario_envios_consulta_fk" FOREIGN KEY ("tenant_id","patient_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","patient_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionario_envios" ADD CONSTRAINT "questionario_envios_modelo_fk" FOREIGN KEY ("tenant_id","modelo_id") REFERENCES "public"."anamnesis_templates"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordatorio_itens" ADD CONSTRAINT "recordatorio_itens_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordatorio_itens" ADD CONSTRAINT "recordatorio_itens_recordatorio_fk" FOREIGN KEY ("tenant_id","patient_id","recordatorio_id") REFERENCES "public"."recordatorios"("tenant_id","patient_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordatorios" ADD CONSTRAINT "recordatorios_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordatorios" ADD CONSTRAINT "recordatorios_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "metas_modelos_titulo_unico" ON "metas_modelos" USING btree ("tenant_id",lower("titulo")) WHERE "metas_modelos"."arquivado_em" is null;--> statement-breakpoint
CREATE INDEX "metas_paciente_ativas_idx" ON "metas_paciente" USING btree ("tenant_id","patient_id") WHERE "metas_paciente"."situacao" = 'ativa';--> statement-breakpoint
CREATE UNIQUE INDEX "metas_registros_um_por_dia" ON "metas_registros" USING btree ("tenant_id","meta_id","dia");--> statement-breakpoint
CREATE INDEX "metas_registros_meta_idx" ON "metas_registros" USING btree ("tenant_id","meta_id","dia" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "questionario_envios_uma_anamnese" ON "questionario_envios" USING btree ("anamnese_id") WHERE "questionario_envios"."anamnese_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "questionario_envios_um_por_consulta" ON "questionario_envios" USING btree ("tenant_id","appointment_id") WHERE "questionario_envios"."appointment_id" is not null and "questionario_envios"."situacao" in ('enviado', 'respondido');--> statement-breakpoint
CREATE INDEX "questionario_envios_paciente_idx" ON "questionario_envios" USING btree ("tenant_id","patient_id","enviado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "questionario_envios_abertos_idx" ON "questionario_envios" USING btree ("tenant_id","expira_em") WHERE "questionario_envios"."situacao" = 'enviado';--> statement-breakpoint
CREATE INDEX "recordatorio_itens_recordatorio_idx" ON "recordatorio_itens" USING btree ("tenant_id","recordatorio_id","ordem");--> statement-breakpoint
CREATE INDEX "recordatorio_itens_alimento_idx" ON "recordatorio_itens" USING btree ("food_id");--> statement-breakpoint
CREATE INDEX "recordatorios_paciente_idx" ON "recordatorios" USING btree ("tenant_id","patient_id","dia_relatado" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "anamnesis_templates_envio_auto_idx" ON "anamnesis_templates" USING btree ("tenant_id") WHERE "anamnesis_templates"."envio_auto" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "anamnesis_templates_padrao_idx" ON "anamnesis_templates" USING btree ("tenant_id","finalidade") WHERE "anamnesis_templates"."padrao";--> statement-breakpoint
ALTER TABLE "anamneses" ADD CONSTRAINT "anamneses_tenant_paciente_id_unique" UNIQUE("tenant_id","patient_id","id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tipo_valido" CHECK ("notifications"."tipo" in ('lembrete_24h', 'lembrete_2h', 'consulta_marcada', 'consulta_cancelada', 'convite_paciente', 'resposta_confirmacao', 'resposta_remarcar', 'push_teste', 'comentario_diario', 'plano_novo', 'conteudo_novo', 'documento_novo', 'documento_atualizado', 'exame_revisado', 'exame_expirado', 'duvida_vista', 'questionario_novo'));--> statement-breakpoint
ALTER TABLE "anamnesis_templates" ADD CONSTRAINT "anamnesis_templates_finalidade_valida" CHECK ("anamnesis_templates"."finalidade" in ('anamnese', 'questionario'));--> statement-breakpoint
ALTER TABLE "anamnesis_templates" ADD CONSTRAINT "anamnesis_templates_envio_auto_valido" CHECK ("anamnesis_templates"."envio_auto" in ('primeira', 'todas'));--> statement-breakpoint
ALTER TABLE "anamnesis_templates" ADD CONSTRAINT "anamnesis_templates_envio_auto_dias_faixa" CHECK ("anamnesis_templates"."envio_auto_dias" between 1 and 7);--> statement-breakpoint
ALTER TABLE "anamnesis_templates" ADD CONSTRAINT "anamnesis_templates_envio_auto_coerente" CHECK (("anamnesis_templates"."envio_auto" is null) = ("anamnesis_templates"."envio_auto_dias" is null) and ("anamnesis_templates"."envio_auto" is null or ("anamnesis_templates"."finalidade" = 'questionario' and "anamnesis_templates"."arquivado_em" is null)));--> statement-breakpoint
ALTER TABLE "anamnesis_templates" ADD CONSTRAINT "anamnesis_templates_questionario_sem_ia" CHECK ("anamnesis_templates"."finalidade" = 'anamnese' or "anamnesis_templates"."ia_geracao_id" is null);