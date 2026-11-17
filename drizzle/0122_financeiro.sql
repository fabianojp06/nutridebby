CREATE TABLE "fin_categorias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"nome" text NOT NULL,
	"chave" text,
	"arquivada_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_categorias_tenant_id_tipo_unique" UNIQUE("tenant_id","id","tipo"),
	CONSTRAINT "fin_categorias_tipo_valido" CHECK ("fin_categorias"."tipo" in ('entrada', 'saida')),
	CONSTRAINT "fin_categorias_nome_tamanho" CHECK (char_length("fin_categorias"."nome") between 1 and 60),
	CONSTRAINT "fin_categorias_chave_valida" CHECK ("fin_categorias"."chave" is null or ("fin_categorias"."chave" = 'consultas' and "fin_categorias"."tipo" = 'entrada')),
	CONSTRAINT "fin_categorias_chave_nunca_arquivada" CHECK ("fin_categorias"."chave" is null or "fin_categorias"."arquivada_em" is null)
);
--> statement-breakpoint
CREATE TABLE "fin_configuracoes" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"saldo_inicial_centavos" integer NOT NULL,
	"saldo_inicial_em" date NOT NULL,
	"valor_consulta_centavos" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_configuracoes_saldo_faixa" CHECK ("fin_configuracoes"."saldo_inicial_centavos" between -1000000000 and 1000000000),
	CONSTRAINT "fin_configuracoes_saldo_data" CHECK ("fin_configuracoes"."saldo_inicial_em" >= '2000-01-01'),
	CONSTRAINT "fin_configuracoes_valor_consulta_faixa" CHECK ("fin_configuracoes"."valor_consulta_centavos" is null or "fin_configuracoes"."valor_consulta_centavos" between 1 and 100000000)
);
--> statement-breakpoint
CREATE TABLE "fin_lancamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"categoria_id" uuid NOT NULL,
	"valor_centavos" integer NOT NULL,
	"vencimento" date NOT NULL,
	"pago_em" date,
	"forma_pagamento" text,
	"descricao" text,
	"patient_id" uuid,
	"appointment_id" uuid,
	"criado_por" uuid NOT NULL,
	"cancelado_em" timestamp with time zone,
	"cancelado_por" uuid,
	"motivo_cancelamento" text,
	"anonimizado_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_lancamentos_tipo_valido" CHECK ("fin_lancamentos"."tipo" in ('entrada', 'saida')),
	CONSTRAINT "fin_lancamentos_valor_faixa" CHECK ("fin_lancamentos"."valor_centavos" between 1 and 100000000),
	CONSTRAINT "fin_lancamentos_vencimento_faixa" CHECK ("fin_lancamentos"."vencimento" between '2000-01-01' and '2100-12-31'),
	CONSTRAINT "fin_lancamentos_pago_em_faixa" CHECK ("fin_lancamentos"."pago_em" is null or "fin_lancamentos"."pago_em" between '2000-01-01' and '2100-12-31'),
	CONSTRAINT "fin_lancamentos_forma_valida" CHECK ("fin_lancamentos"."forma_pagamento" is null or "fin_lancamentos"."forma_pagamento" in ('pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'transferencia', 'boleto', 'outra')),
	CONSTRAINT "fin_lancamentos_pago_tem_forma" CHECK ("fin_lancamentos"."pago_em" is null or "fin_lancamentos"."forma_pagamento" is not null),
	CONSTRAINT "fin_lancamentos_descricao_tamanho" CHECK ("fin_lancamentos"."descricao" is null or char_length("fin_lancamentos"."descricao") between 1 and 200),
	CONSTRAINT "fin_lancamentos_motivo_tamanho" CHECK ("fin_lancamentos"."motivo_cancelamento" is null or char_length("fin_lancamentos"."motivo_cancelamento") between 1 and 200),
	CONSTRAINT "fin_lancamentos_saida_sem_paciente" CHECK ("fin_lancamentos"."tipo" = 'entrada' or "fin_lancamentos"."patient_id" is null),
	CONSTRAINT "fin_lancamentos_consulta_com_paciente" CHECK ("fin_lancamentos"."appointment_id" is null or "fin_lancamentos"."patient_id" is not null),
	CONSTRAINT "fin_lancamentos_cancelamento_coerente" CHECK (("fin_lancamentos"."cancelado_em" is null and "fin_lancamentos"."cancelado_por" is null and "fin_lancamentos"."motivo_cancelamento" is null) or ("fin_lancamentos"."cancelado_em" is not null and ("fin_lancamentos"."motivo_cancelamento" is not null or "fin_lancamentos"."anonimizado_em" is not null))),
	CONSTRAINT "fin_lancamentos_anonimizado_sem_texto" CHECK ("fin_lancamentos"."anonimizado_em" is null or ("fin_lancamentos"."descricao" is null and "fin_lancamentos"."motivo_cancelamento" is null))
);
--> statement-breakpoint
ALTER TABLE "fin_categorias" ADD CONSTRAINT "fin_categorias_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_configuracoes" ADD CONSTRAINT "fin_configuracoes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_lancamentos" ADD CONSTRAINT "fin_lancamentos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_lancamentos" ADD CONSTRAINT "fin_lancamentos_categoria_fk" FOREIGN KEY ("tenant_id","categoria_id","tipo") REFERENCES "public"."fin_categorias"("tenant_id","id","tipo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_lancamentos" ADD CONSTRAINT "fin_lancamentos_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_lancamentos" ADD CONSTRAINT "fin_lancamentos_consulta_fk" FOREIGN KEY ("tenant_id","patient_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","patient_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fin_categorias_chave_unique" ON "fin_categorias" USING btree ("tenant_id","chave") WHERE "fin_categorias"."chave" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "fin_categorias_nome_unique" ON "fin_categorias" USING btree ("tenant_id","tipo",lower("nome"));--> statement-breakpoint
CREATE UNIQUE INDEX "fin_lancamentos_consulta_ativa_unique" ON "fin_lancamentos" USING btree ("tenant_id","appointment_id") WHERE "fin_lancamentos"."appointment_id" is not null and "fin_lancamentos"."cancelado_em" is null;--> statement-breakpoint
CREATE INDEX "fin_lancamentos_pago_idx" ON "fin_lancamentos" USING btree ("tenant_id","pago_em") WHERE "fin_lancamentos"."cancelado_em" is null and "fin_lancamentos"."pago_em" is not null;--> statement-breakpoint
CREATE INDEX "fin_lancamentos_aberto_idx" ON "fin_lancamentos" USING btree ("tenant_id","vencimento") WHERE "fin_lancamentos"."cancelado_em" is null and "fin_lancamentos"."pago_em" is null;--> statement-breakpoint
CREATE INDEX "fin_lancamentos_paciente_idx" ON "fin_lancamentos" USING btree ("tenant_id","patient_id","vencimento") WHERE "fin_lancamentos"."patient_id" is not null;--> statement-breakpoint
CREATE INDEX "fin_lancamentos_criado_idx" ON "fin_lancamentos" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE INDEX "fin_lancamentos_categoria_idx" ON "fin_lancamentos" USING btree ("tenant_id","categoria_id","tipo");