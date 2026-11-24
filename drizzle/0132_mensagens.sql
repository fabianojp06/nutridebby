CREATE TABLE "chat_avisos_nutri" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"aviso_email" boolean DEFAULT true NOT NULL,
	"aviso_nutri_em" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_configuracoes" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"horario_ativo" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_conversas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"liberada_em" timestamp with time zone,
	"liberada_por" uuid,
	"tcle_forma" text,
	"liberada_nome" text,
	"liberada_crn" text,
	"pausada_em" timestamp with time zone,
	"pausada_por" uuid,
	"pausada_nome" text,
	"pausada_crn" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_conversas_paciente_unique" UNIQUE("tenant_id","patient_id"),
	CONSTRAINT "chat_conversas_liberacao" CHECK (("chat_conversas"."liberada_em" is null) = ("chat_conversas"."liberada_por" is null) and ("chat_conversas"."liberada_em" is null) = ("chat_conversas"."tcle_forma" is null) and ("chat_conversas"."liberada_em" is null) = ("chat_conversas"."liberada_nome" is null) and ("chat_conversas"."liberada_em" is null) = ("chat_conversas"."liberada_crn" is null)),
	CONSTRAINT "chat_conversas_tcle_forma_valida" CHECK ("chat_conversas"."tcle_forma" is null or "chat_conversas"."tcle_forma" in ('termo_assinado', 'aceite_escrito')),
	CONSTRAINT "chat_conversas_pausa" CHECK (("chat_conversas"."pausada_em" is null) = ("chat_conversas"."pausada_por" is null) and ("chat_conversas"."pausada_em" is null) = ("chat_conversas"."pausada_nome" is null) and ("chat_conversas"."pausada_em" is null) = ("chat_conversas"."pausada_crn" is null)),
	CONSTRAINT "chat_conversas_pausa_so_liberada" CHECK ("chat_conversas"."pausada_em" is null or "chat_conversas"."liberada_em" is not null)
);
--> statement-breakpoint
CREATE TABLE "chat_horarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dia_semana" smallint NOT NULL,
	"inicio_min" smallint NOT NULL,
	"fim_min" smallint NOT NULL,
	CONSTRAINT "chat_horarios_dia_valido" CHECK ("chat_horarios"."dia_semana" between 0 and 6),
	CONSTRAINT "chat_horarios_faixa_valida" CHECK ("chat_horarios"."inicio_min" between 0 and 1440 and "chat_horarios"."fim_min" between 0 and 1440 and "chat_horarios"."inicio_min" < "chat_horarios"."fim_min" and "chat_horarios"."inicio_min" % 15 = 0 and "chat_horarios"."fim_min" % 15 = 0)
);
--> statement-breakpoint
CREATE TABLE "chat_leituras" (
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"lado" text NOT NULL,
	"lida_ate" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_leituras_pk" PRIMARY KEY("tenant_id","patient_id","lado"),
	CONSTRAINT "chat_leituras_lado_valido" CHECK ("chat_leituras"."lado" in ('consultorio', 'paciente'))
);
--> statement-breakpoint
CREATE TABLE "chat_mensagens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"autor" text NOT NULL,
	"autor_user_id" uuid NOT NULL,
	"autor_nome" text,
	"autor_crn" text,
	"texto" text,
	"recado_id" uuid,
	"duvida_em" timestamp with time zone,
	"risco" text,
	"anexo_status" text DEFAULT 'sem_anexo' NOT NULL,
	"anexo_path" text,
	"anexo_original_path" text,
	"anexo_tipo" text,
	"anexo_nome" text,
	"anexo_bytes" integer,
	"criada_em" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_mensagens_anexo_path_unique" UNIQUE("anexo_path"),
	CONSTRAINT "chat_mensagens_anexo_original_path_unique" UNIQUE("anexo_original_path"),
	CONSTRAINT "chat_mensagens_autor_valido" CHECK ("chat_mensagens"."autor" in ('nutri', 'paciente')),
	CONSTRAINT "chat_mensagens_texto_tamanho" CHECK ("chat_mensagens"."texto" is null or char_length(btrim("chat_mensagens"."texto")) between 1 and 2000),
	CONSTRAINT "chat_mensagens_tem_conteudo" CHECK ("chat_mensagens"."texto" is not null or "chat_mensagens"."anexo_status" <> 'sem_anexo'),
	CONSTRAINT "chat_mensagens_anexo_status_valido" CHECK ("chat_mensagens"."anexo_status" in ('sem_anexo', 'processando', 'pronto', 'falhou', 'removido')),
	CONSTRAINT "chat_mensagens_anexo_tipo_valido" CHECK ("chat_mensagens"."anexo_tipo" is null or "chat_mensagens"."anexo_tipo" in ('imagem', 'pdf')),
	CONSTRAINT "chat_mensagens_anexo_tipo_com_anexo" CHECK (("chat_mensagens"."anexo_status" = 'sem_anexo') = ("chat_mensagens"."anexo_tipo" is null)),
	CONSTRAINT "chat_mensagens_pronto_com_caminho" CHECK ("chat_mensagens"."anexo_status" <> 'pronto' or "chat_mensagens"."anexo_path" is not null),
	CONSTRAINT "chat_mensagens_processando_com_original" CHECK ("chat_mensagens"."anexo_status" <> 'processando' or "chat_mensagens"."anexo_original_path" is not null or "chat_mensagens"."anexo_tipo" = 'pdf'),
	CONSTRAINT "chat_mensagens_pdf_so_da_nutri" CHECK ("chat_mensagens"."anexo_tipo" <> 'pdf' or "chat_mensagens"."autor" = 'nutri'),
	CONSTRAINT "chat_mensagens_recado_so_texto" CHECK ("chat_mensagens"."recado_id" is null or ("chat_mensagens"."autor" = 'nutri' and "chat_mensagens"."anexo_status" = 'sem_anexo')),
	CONSTRAINT "chat_mensagens_removido_sem_caminho" CHECK ("chat_mensagens"."anexo_status" <> 'removido' or ("chat_mensagens"."anexo_path" is null and "chat_mensagens"."anexo_original_path" is null)),
	CONSTRAINT "chat_mensagens_sem_anexo_sem_caminho" CHECK ("chat_mensagens"."anexo_status" <> 'sem_anexo' or ("chat_mensagens"."anexo_path" is null and "chat_mensagens"."anexo_original_path" is null)),
	CONSTRAINT "chat_mensagens_carimbo" CHECK (("chat_mensagens"."autor" = 'nutri' and "chat_mensagens"."autor_nome" is not null and "chat_mensagens"."autor_crn" is not null) or ("chat_mensagens"."autor" = 'paciente' and "chat_mensagens"."autor_nome" is null and "chat_mensagens"."autor_crn" is null)),
	CONSTRAINT "chat_mensagens_duvida_so_da_nutri" CHECK ("chat_mensagens"."duvida_em" is null or ("chat_mensagens"."autor" = 'nutri' and "chat_mensagens"."recado_id" is null)),
	CONSTRAINT "chat_mensagens_risco_valido" CHECK ("chat_mensagens"."risco" is null or ("chat_mensagens"."autor" = 'paciente' and "chat_mensagens"."risco" in ('emergencia', 'sintoma_agudo', 'transtorno_alimentar'))),
	CONSTRAINT "chat_mensagens_anexo_nome" CHECK ("chat_mensagens"."anexo_nome" is null or ("chat_mensagens"."autor" = 'nutri' and char_length("chat_mensagens"."anexo_nome") between 1 and 120)),
	CONSTRAINT "chat_mensagens_anexo_bytes_positivo" CHECK ("chat_mensagens"."anexo_bytes" is null or "chat_mensagens"."anexo_bytes" > 0),
	CONSTRAINT "chat_mensagens_anexo_path_prefixo" CHECK ("chat_mensagens"."anexo_path" is null or "chat_mensagens"."anexo_path" like "chat_mensagens"."tenant_id"::text || '/chat_anexo/%'),
	CONSTRAINT "chat_mensagens_anexo_original_prefixo" CHECK ("chat_mensagens"."anexo_original_path" is null or "chat_mensagens"."anexo_original_path" like "chat_mensagens"."tenant_id"::text || '/chat_anexo_original/%')
);
--> statement-breakpoint
CREATE TABLE "recados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"texto" text NOT NULL,
	"filtro" jsonb NOT NULL,
	"filtro_rotulo" text,
	"destinatarios" integer NOT NULL,
	"autor_nome" text NOT NULL,
	"autor_crn" text NOT NULL,
	"criado_por" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "recados_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "recados_texto_tamanho" CHECK (char_length(btrim("recados"."texto")) between 1 and 1000),
	CONSTRAINT "recados_filtro_valido" CHECK (coalesce("recados"."filtro" ->> 'tipo', '') in ('todos', 'etiquetas', 'local')),
	CONSTRAINT "recados_filtro_rotulo_tamanho" CHECK ("recados"."filtro_rotulo" is null or char_length("recados"."filtro_rotulo") between 1 and 300),
	CONSTRAINT "recados_destinatarios_positivo" CHECK ("recados"."destinatarios" > 0)
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_tipo_valido";--> statement-breakpoint
ALTER TABLE "ia_nutri_mensagens" DROP CONSTRAINT "ia_nutri_mensagens_resolucao";--> statement-breakpoint
ALTER TABLE "stored_files" DROP CONSTRAINT "stored_files_tipo_valido";--> statement-breakpoint
ALTER TABLE "chat_avisos_nutri" ADD CONSTRAINT "chat_avisos_nutri_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_configuracoes" ADD CONSTRAINT "chat_configuracoes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversas" ADD CONSTRAINT "chat_conversas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversas" ADD CONSTRAINT "chat_conversas_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_horarios" ADD CONSTRAINT "chat_horarios_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_leituras" ADD CONSTRAINT "chat_leituras_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_leituras" ADD CONSTRAINT "chat_leituras_conversa_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."chat_conversas"("tenant_id","patient_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_mensagens" ADD CONSTRAINT "chat_mensagens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_mensagens" ADD CONSTRAINT "chat_mensagens_anexo_path_stored_files_caminho_fk" FOREIGN KEY ("anexo_path") REFERENCES "public"."stored_files"("caminho") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_mensagens" ADD CONSTRAINT "chat_mensagens_anexo_original_path_stored_files_caminho_fk" FOREIGN KEY ("anexo_original_path") REFERENCES "public"."stored_files"("caminho") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_mensagens" ADD CONSTRAINT "chat_mensagens_conversa_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."chat_conversas"("tenant_id","patient_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_mensagens" ADD CONSTRAINT "chat_mensagens_recado_fk" FOREIGN KEY ("tenant_id","recado_id") REFERENCES "public"."recados"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recados" ADD CONSTRAINT "recados_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_mensagens_conversa_idx" ON "chat_mensagens" USING btree ("tenant_id","patient_id","criada_em","id");--> statement-breakpoint
CREATE INDEX "chat_mensagens_do_paciente_idx" ON "chat_mensagens" USING btree ("tenant_id","criada_em") WHERE "chat_mensagens"."autor" = 'paciente';--> statement-breakpoint
CREATE INDEX "chat_mensagens_recado_idx" ON "chat_mensagens" USING btree ("tenant_id","recado_id") WHERE "chat_mensagens"."recado_id" is not null;--> statement-breakpoint
CREATE INDEX "chat_mensagens_processando_idx" ON "chat_mensagens" USING btree ("tenant_id","anexo_status") WHERE "chat_mensagens"."anexo_status" = 'processando';--> statement-breakpoint
CREATE INDEX "recados_tenant_criado_idx" ON "recados" USING btree ("tenant_id","criado_em");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tipo_valido" CHECK ("notifications"."tipo" in ('lembrete_24h', 'lembrete_2h', 'consulta_marcada', 'consulta_cancelada', 'convite_paciente', 'resposta_confirmacao', 'resposta_remarcar', 'push_teste', 'comentario_diario', 'plano_novo', 'conteudo_novo', 'documento_novo', 'documento_atualizado', 'exame_revisado', 'exame_expirado', 'duvida_vista', 'aniversario', 'pedido_nao_confirmado', 'chat_mensagem', 'recado'));--> statement-breakpoint
ALTER TABLE "ia_nutri_mensagens" ADD CONSTRAINT "ia_nutri_mensagens_resolucao" CHECK (("ia_nutri_mensagens"."resolucao" is null) = ("ia_nutri_mensagens"."resolvida_em" is null) and ("ia_nutri_mensagens"."resolucao" is null or "ia_nutri_mensagens"."resolucao" in ('vista', 'encerrada', 'respondida')));--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_tipo_valido" CHECK ("stored_files"."tipo" in ('logo','capa','exame','plano_pdf','diario_foto','diario_foto_original','orientacao_pdf','exportacao','documento_base','documento_assinado','documento_digitalizado','exame_original','exame_pagina','ia_autorizacao_termo','chat_anexo','chat_anexo_original'));