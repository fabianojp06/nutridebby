CREATE TABLE "ia_nutri_consentimentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"evento" text NOT NULL,
	"versao" text,
	"destino" text,
	"canal" text DEFAULT 'app' NOT NULL,
	"registrado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"registrado_por" uuid,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "ia_nutri_consentimentos_evento_valido" CHECK ("ia_nutri_consentimentos"."evento" in ('aceite', 'revogacao')),
	CONSTRAINT "ia_nutri_consentimentos_versao" CHECK (("ia_nutri_consentimentos"."evento" = 'aceite') = ("ia_nutri_consentimentos"."versao" is not null) and ("ia_nutri_consentimentos"."versao" is null or char_length("ia_nutri_consentimentos"."versao") between 1 and 40)),
	CONSTRAINT "ia_nutri_consentimentos_destino" CHECK (("ia_nutri_consentimentos"."evento" = 'aceite') = ("ia_nutri_consentimentos"."destino" is not null) and ("ia_nutri_consentimentos"."destino" is null or "ia_nutri_consentimentos"."destino" in ('anthropic-us', 'bedrock-eu', 'teste'))),
	CONSTRAINT "ia_nutri_consentimentos_canal_valido" CHECK ("ia_nutri_consentimentos"."canal" in ('app', 'nutricionista') and ("ia_nutri_consentimentos"."canal" = 'app' or "ia_nutri_consentimentos"."evento" = 'revogacao')),
	CONSTRAINT "ia_nutri_consentimentos_tamanhos" CHECK (("ia_nutri_consentimentos"."ip" is null or char_length("ia_nutri_consentimentos"."ip") <= 45) and ("ia_nutri_consentimentos"."user_agent" is null or char_length("ia_nutri_consentimentos"."user_agent") <= 300))
);
--> statement-breakpoint
CREATE TABLE "ia_nutri_mensagens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"sessao_inicio" timestamp with time zone NOT NULL,
	"autor" text NOT NULL,
	"texto" text,
	"texto_fixo" text,
	"tipo_resposta" text,
	"responde_a" uuid,
	"status" text,
	"categoria" text,
	"fontes" jsonb,
	"motivo_tecnico" text,
	"risco" text,
	"encaminhada_em" timestamp with time zone,
	"aberta_pela_nutri_em" timestamp with time zone,
	"resolvida_em" timestamp with time zone,
	"resolvida_por" uuid,
	"resolucao" text,
	"avaliacao" text,
	"modelo" text,
	"prompt_versao" text,
	"reserva_micro_usd" bigint DEFAULT 0 NOT NULL,
	"enviado_em" timestamp with time zone,
	"saiu_em" timestamp with time zone,
	"destino" text,
	"revogada_em" timestamp with time zone,
	"contou_no_limite" boolean DEFAULT false NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ia_nutri_mensagens_tenant_paciente_id_unique" UNIQUE("tenant_id","patient_id","id"),
	CONSTRAINT "ia_nutri_mensagens_autor_valido" CHECK ("ia_nutri_mensagens"."autor" in ('paciente', 'ia', 'sistema')),
	CONSTRAINT "ia_nutri_mensagens_texto_tamanho" CHECK ("ia_nutri_mensagens"."texto" is null or ("ia_nutri_mensagens"."autor" = 'paciente' and char_length("ia_nutri_mensagens"."texto") between 1 and 500) or ("ia_nutri_mensagens"."autor" = 'ia' and char_length("ia_nutri_mensagens"."texto") between 1 and 24000)),
	CONSTRAINT "ia_nutri_mensagens_texto_fixo_valido" CHECK ("ia_nutri_mensagens"."texto_fixo" is null or ("ia_nutri_mensagens"."autor" <> 'paciente' and "ia_nutri_mensagens"."texto_fixo" in ('risco_emergencia', 'risco_transtorno', 'sintoma_agudo', 'fora_do_escopo', 'mudanca_plano', 'sintoma_ou_exame', 'suplemento_ou_remedio', 'peso_ou_dieta_restritiva', 'nao_encontrei', 'falha', 'indisponivel'))),
	CONSTRAINT "ia_nutri_mensagens_status" CHECK (("ia_nutri_mensagens"."autor" = 'paciente') = ("ia_nutri_mensagens"."status" is not null) and ("ia_nutri_mensagens"."status" is null or "ia_nutri_mensagens"."status" in ('na_fila', 'processando', 'respondida', 'falhou', 'cancelada'))),
	CONSTRAINT "ia_nutri_mensagens_responde_a" CHECK ("ia_nutri_mensagens"."responde_a" is null or "ia_nutri_mensagens"."autor" <> 'paciente'),
	CONSTRAINT "ia_nutri_mensagens_categoria_valida" CHECK ("ia_nutri_mensagens"."categoria" is null or "ia_nutri_mensagens"."categoria" in ('plano', 'fora_do_escopo', 'mudanca_plano', 'sintoma_ou_exame', 'suplemento_ou_remedio', 'peso_ou_dieta_restritiva', 'risco')),
	CONSTRAINT "ia_nutri_mensagens_tipo_resposta_valido" CHECK ("ia_nutri_mensagens"."tipo_resposta" is null or ("ia_nutri_mensagens"."autor" = 'ia' and "ia_nutri_mensagens"."tipo_resposta" in ('quantidade', 'substituicao', 'horario', 'refeicao', 'orientacao'))),
	CONSTRAINT "ia_nutri_mensagens_risco_valido" CHECK ("ia_nutri_mensagens"."risco" is null or ("ia_nutri_mensagens"."autor" = 'paciente' and "ia_nutri_mensagens"."risco" in ('emergencia', 'transtorno_alimentar', 'modelo'))),
	CONSTRAINT "ia_nutri_mensagens_motivo_valido" CHECK ("ia_nutri_mensagens"."motivo_tecnico" is null or "ia_nutri_mensagens"."motivo_tecnico" in ('invalida_fonte', 'invalida_tipo', 'invalida_termo', 'invalida_formato', 'recusa', 'interrompida', 'cota', 'teto_plataforma', 'provedor_indisponivel', 'resultado_incerto', 'limite_custo', 'indisponivel', 'condicao')),
	CONSTRAINT "ia_nutri_mensagens_so_da_pergunta" CHECK ("ia_nutri_mensagens"."autor" = 'paciente' or ("ia_nutri_mensagens"."encaminhada_em" is null and "ia_nutri_mensagens"."aberta_pela_nutri_em" is null and "ia_nutri_mensagens"."resolvida_em" is null and "ia_nutri_mensagens"."saiu_em" is null and "ia_nutri_mensagens"."enviado_em" is null)),
	CONSTRAINT "ia_nutri_mensagens_avaliacao_valida" CHECK ("ia_nutri_mensagens"."avaliacao" is null or ("ia_nutri_mensagens"."autor" = 'ia' and "ia_nutri_mensagens"."avaliacao" in ('ajudou', 'nao_ajudou'))),
	CONSTRAINT "ia_nutri_mensagens_resolucao" CHECK (("ia_nutri_mensagens"."resolucao" is null) = ("ia_nutri_mensagens"."resolvida_em" is null) and ("ia_nutri_mensagens"."resolucao" is null or "ia_nutri_mensagens"."resolucao" in ('vista', 'encerrada'))),
	CONSTRAINT "ia_nutri_mensagens_destino_valido" CHECK ("ia_nutri_mensagens"."destino" is null or ("ia_nutri_mensagens"."destino" in ('anthropic-us', 'bedrock-eu', 'teste') and "ia_nutri_mensagens"."saiu_em" is not null)),
	CONSTRAINT "ia_nutri_mensagens_reserva_valida" CHECK ("ia_nutri_mensagens"."reserva_micro_usd" >= 0),
	CONSTRAINT "ia_nutri_mensagens_textos_tecnicos" CHECK (("ia_nutri_mensagens"."modelo" is null or char_length("ia_nutri_mensagens"."modelo") <= 60) and ("ia_nutri_mensagens"."prompt_versao" is null or char_length("ia_nutri_mensagens"."prompt_versao") <= 60))
);
--> statement-breakpoint
CREATE TABLE "ia_nutri_participacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"liberada_em" timestamp with time zone,
	"liberada_por" uuid,
	"bloqueada_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ia_nutri_participacoes_paciente_unique" UNIQUE("tenant_id","patient_id"),
	CONSTRAINT "ia_nutri_participacoes_quem_liberou" CHECK (("ia_nutri_participacoes"."liberada_em" is null) = ("ia_nutri_participacoes"."liberada_por" is null))
);
--> statement-breakpoint
CREATE TABLE "ia_nutri_pausa" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"pausada_em" timestamp with time zone,
	"pausada_por" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ia_nutri_pausa_linha_unica" CHECK ("ia_nutri_pausa"."id")
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_tipo_valido";--> statement-breakpoint
ALTER TABLE "admin_actions" DROP CONSTRAINT "admin_actions_acao_valida";--> statement-breakpoint
ALTER TABLE "admin_actions" DROP CONSTRAINT "admin_actions_alvo_coerente";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ia_nutri_ativada_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ia_nutri_cota_mensal_usd" numeric(7, 2) DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ia_nutri_aviso_mes" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ia_nutri_risco_aviso_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ia_nutri_consentimentos" ADD CONSTRAINT "ia_nutri_consentimentos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ia_nutri_consentimentos" ADD CONSTRAINT "ia_nutri_consentimentos_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ia_nutri_mensagens" ADD CONSTRAINT "ia_nutri_mensagens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ia_nutri_mensagens" ADD CONSTRAINT "ia_nutri_mensagens_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ia_nutri_participacoes" ADD CONSTRAINT "ia_nutri_participacoes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ia_nutri_participacoes" ADD CONSTRAINT "ia_nutri_participacoes_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ia_nutri_consentimentos_paciente_idx" ON "ia_nutri_consentimentos" USING btree ("tenant_id","patient_id","registrado_em");--> statement-breakpoint
CREATE INDEX "ia_nutri_mensagens_fila_idx" ON "ia_nutri_mensagens" USING btree ("tenant_id","encaminhada_em") WHERE "ia_nutri_mensagens"."encaminhada_em" is not null and "ia_nutri_mensagens"."resolvida_em" is null;--> statement-breakpoint
CREATE INDEX "ia_nutri_mensagens_paciente_idx" ON "ia_nutri_mensagens" USING btree ("tenant_id","patient_id","created_at");--> statement-breakpoint
CREATE INDEX "ia_nutri_mensagens_limites_idx" ON "ia_nutri_mensagens" USING btree ("tenant_id","patient_id","created_at") WHERE "ia_nutri_mensagens"."contou_no_limite";--> statement-breakpoint
CREATE INDEX "ia_nutri_mensagens_expira_idx" ON "ia_nutri_mensagens" USING btree ("tenant_id","expira_em");--> statement-breakpoint
CREATE UNIQUE INDEX "ia_nutri_mensagens_uma_por_vez" ON "ia_nutri_mensagens" USING btree ("tenant_id","patient_id") WHERE "ia_nutri_mensagens"."status" in ('na_fila', 'processando');--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tipo_valido" CHECK ("notifications"."tipo" in ('lembrete_24h', 'lembrete_2h', 'consulta_marcada', 'consulta_cancelada', 'convite_paciente', 'resposta_confirmacao', 'resposta_remarcar', 'push_teste', 'comentario_diario', 'plano_novo', 'conteudo_novo', 'documento_novo', 'documento_atualizado', 'exame_revisado', 'exame_expirado', 'duvida_vista'));--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_acao_valida" CHECK ("admin_actions"."acao" in ('reiniciar_2fa', 'codigo_2fa_recusado', 'liberar_ia', 'bloquear_ia', 'ajustar_cota_ia', 'ajustar_cota_ia_nutri', 'pausar_ia_nutri', 'retomar_ia_nutri'));--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_alvo_coerente" CHECK ((("admin_actions"."acao" = 'reiniciar_2fa') = ("admin_actions"."alvo_user_id" is not null and "admin_actions"."alvo_papel" is not null))
          and (("admin_actions"."acao" in ('liberar_ia', 'bloquear_ia', 'ajustar_cota_ia', 'ajustar_cota_ia_nutri')) = ("admin_actions"."alvo_tenant_id" is not null))
          and (("admin_actions"."acao" in ('liberar_ia', 'bloquear_ia', 'ajustar_cota_ia', 'ajustar_cota_ia_nutri', 'pausar_ia_nutri', 'retomar_ia_nutri')) <= ("admin_actions"."alvo_user_id" is null and "admin_actions"."alvo_papel" is null)));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_ia_nutri_cota_valida" CHECK ("tenants"."ia_nutri_cota_mensal_usd" between 0 and 1000);