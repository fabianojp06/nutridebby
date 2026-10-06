-- Code review do PR #22, item 1: o código do 2FA da admin recusado ao reiniciar o 2FA de outra conta fica registrado
-- (como a recusa da assinatura do Plano 10A), sem conta-alvo: o código é conferido antes de procurar o e-mail.
ALTER TABLE "admin_actions" DROP CONSTRAINT "admin_actions_acao_valida";--> statement-breakpoint
ALTER TABLE "admin_actions" ALTER COLUMN "alvo_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_actions" ALTER COLUMN "alvo_papel" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_alvo_coerente" CHECK (("admin_actions"."acao" = 'reiniciar_2fa') = ("admin_actions"."alvo_user_id" is not null and "admin_actions"."alvo_papel" is not null));--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_acao_valida" CHECK ("admin_actions"."acao" in ('reiniciar_2fa', 'codigo_2fa_recusado'));