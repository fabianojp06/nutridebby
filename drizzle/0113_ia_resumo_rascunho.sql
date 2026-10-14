ALTER TABLE "ia_tarefas" DROP CONSTRAINT "ia_tarefas_tipo_valido";--> statement-breakpoint
ALTER TABLE "ia_tarefas" ADD COLUMN "carimbo_dados" text;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD COLUMN "ia_origem_em" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "ia_tarefas_em_andamento_sem_exame_idx" ON "ia_tarefas" USING btree ("tenant_id","patient_id","tipo") WHERE "ia_tarefas"."tipo" <> 'leitura_exame' and "ia_tarefas"."status" in ('na_fila', 'processando');--> statement-breakpoint
ALTER TABLE "ia_tarefas" ADD CONSTRAINT "ia_tarefas_carimbo_so_resumo" CHECK (("ia_tarefas"."tipo" = 'resumo_historico') = ("ia_tarefas"."carimbo_dados" is not null) and ("ia_tarefas"."carimbo_dados" is null or "ia_tarefas"."carimbo_dados" ~ '^[0-9a-f]{64}$'));--> statement-breakpoint
ALTER TABLE "ia_tarefas" ADD CONSTRAINT "ia_tarefas_tipo_valido" CHECK ("ia_tarefas"."tipo" in ('leitura_exame', 'resumo_historico', 'rascunho_plano'));--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_ia_origem_so_paciente" CHECK ("meal_plans"."ia_origem_em" is null or not "meal_plans"."is_template");