CREATE TABLE "ia_autorizacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"evento" text NOT NULL,
	"versao" text,
	"usos" text[],
	"destino" text,
	"canal" text NOT NULL,
	"em" timestamp with time zone DEFAULT now() NOT NULL,
	"registrado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"registrado_por" uuid,
	"ip" text,
	"user_agent" text,
	"email_hmac" text,
	"arquivo_path" text,
	CONSTRAINT "ia_autorizacoes_evento_valido" CHECK ("ia_autorizacoes"."evento" in ('autorizou', 'retirou', 'pedido_email')),
	CONSTRAINT "ia_autorizacoes_canal_valido" CHECK ("ia_autorizacoes"."canal" in ('app', 'link', 'papel', 'nutricionista')),
	CONSTRAINT "ia_autorizacoes_versao" CHECK (("ia_autorizacoes"."evento" = 'retirou') = ("ia_autorizacoes"."versao" is null) and ("ia_autorizacoes"."versao" is null or char_length("ia_autorizacoes"."versao") between 1 and 40)),
	CONSTRAINT "ia_autorizacoes_usos" CHECK (("ia_autorizacoes"."evento" = 'autorizou') = ("ia_autorizacoes"."usos" is not null) and ("ia_autorizacoes"."usos" is null or (cardinality("ia_autorizacoes"."usos") > 0 and "ia_autorizacoes"."usos" <@ array['leitura_laudos', 'resumo_historico', 'rascunho_plano']::text[]))),
	CONSTRAINT "ia_autorizacoes_destino" CHECK (("ia_autorizacoes"."evento" = 'autorizou') = ("ia_autorizacoes"."destino" is not null) and ("ia_autorizacoes"."destino" is null or "ia_autorizacoes"."destino" in ('anthropic-us', 'bedrock-eu', 'teste'))),
	CONSTRAINT "ia_autorizacoes_canal_do_evento" CHECK (("ia_autorizacoes"."evento" <> 'pedido_email' or "ia_autorizacoes"."canal" = 'link') and ("ia_autorizacoes"."evento" <> 'retirou' or "ia_autorizacoes"."canal" <> 'papel') and ("ia_autorizacoes"."evento" <> 'autorizou' or "ia_autorizacoes"."canal" <> 'nutricionista')),
	CONSTRAINT "ia_autorizacoes_em" CHECK ("ia_autorizacoes"."em" <= "ia_autorizacoes"."registrado_em"),
	CONSTRAINT "ia_autorizacoes_link_sem_conta" CHECK (not ("ia_autorizacoes"."canal" = 'link' and "ia_autorizacoes"."evento" <> 'pedido_email') or "ia_autorizacoes"."registrado_por" is null),
	CONSTRAINT "ia_autorizacoes_ip_so_digital" CHECK (("ia_autorizacoes"."ip" is null and "ia_autorizacoes"."user_agent" is null) or ("ia_autorizacoes"."canal" in ('app', 'link') and "ia_autorizacoes"."evento" <> 'pedido_email')),
	CONSTRAINT "ia_autorizacoes_tamanhos" CHECK (("ia_autorizacoes"."ip" is null or char_length("ia_autorizacoes"."ip") <= 45) and ("ia_autorizacoes"."user_agent" is null or char_length("ia_autorizacoes"."user_agent") <= 300) and ("ia_autorizacoes"."email_hmac" is null or char_length("ia_autorizacoes"."email_hmac") <= 64)),
	CONSTRAINT "ia_autorizacoes_hmac_so_link" CHECK ("ia_autorizacoes"."email_hmac" is null or "ia_autorizacoes"."canal" = 'link'),
	CONSTRAINT "ia_autorizacoes_arquivo_so_papel" CHECK ("ia_autorizacoes"."arquivo_path" is null or ("ia_autorizacoes"."canal" = 'papel' and "ia_autorizacoes"."evento" = 'autorizou' and "ia_autorizacoes"."arquivo_path" like "ia_autorizacoes"."tenant_id"::text || '/ia_autorizacao_termo/%'))
);
--> statement-breakpoint
ALTER TABLE "stored_files" DROP CONSTRAINT "stored_files_tipo_valido";--> statement-breakpoint
ALTER TABLE "ia_tarefas" ADD COLUMN "destino" text;--> statement-breakpoint
ALTER TABLE "ia_autorizacoes" ADD CONSTRAINT "ia_autorizacoes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ia_autorizacoes" ADD CONSTRAINT "ia_autorizacoes_arquivo_path_stored_files_caminho_fk" FOREIGN KEY ("arquivo_path") REFERENCES "public"."stored_files"("caminho") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ia_autorizacoes" ADD CONSTRAINT "ia_autorizacoes_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ia_autorizacoes_paciente_idx" ON "ia_autorizacoes" USING btree ("tenant_id","patient_id","registrado_em");--> statement-breakpoint
ALTER TABLE "ia_tarefas" ADD CONSTRAINT "ia_tarefas_destino_valido" CHECK ("ia_tarefas"."destino" is null or ("ia_tarefas"."destino" in ('anthropic-us', 'bedrock-eu', 'teste') and "ia_tarefas"."saiu_em" is not null));--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_tipo_valido" CHECK ("stored_files"."tipo" in ('logo','capa','exame','plano_pdf','diario_foto','diario_foto_original','orientacao_pdf','exportacao','documento_base','documento_assinado','documento_digitalizado','exame_original','exame_pagina','ia_autorizacao_termo'));