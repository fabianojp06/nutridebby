ALTER TABLE "diary_entries" DROP CONSTRAINT "diary_entries_tem_conteudo";--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "peso_oculto_no_app_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD COLUMN "resposta" text;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD COLUMN "refeicao_do_plano" text;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_resposta_valida" CHECK ("diary_entries"."resposta" is null or "diary_entries"."resposta" in ('como_no_plano', 'outra_coisa'));--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_refeicao_do_plano" CHECK (("diary_entries"."resposta" is null) = ("diary_entries"."refeicao_do_plano" is null) and ("diary_entries"."refeicao_do_plano" is null or char_length("diary_entries"."refeicao_do_plano") between 1 and 80));--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_outra_coisa_tem_conteudo" CHECK ("diary_entries"."resposta" is distinct from 'outra_coisa' or "diary_entries"."texto" is not null or "diary_entries"."foto_status" <> 'sem_foto');--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_tem_conteudo" CHECK ("diary_entries"."texto" is not null or "diary_entries"."foto_status" <> 'sem_foto' or "diary_entries"."resposta" is not distinct from 'como_no_plano');