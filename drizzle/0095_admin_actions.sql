CREATE TABLE "admin_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid,
	"acao" text NOT NULL,
	"alvo_user_id" uuid NOT NULL,
	"alvo_papel" text NOT NULL,
	"origem" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_actions_acao_valida" CHECK ("admin_actions"."acao" in ('reiniciar_2fa')),
	CONSTRAINT "admin_actions_origem_valida" CHECK ("admin_actions"."origem" in ('admin', 'cli')),
	CONSTRAINT "admin_actions_autor_coerente" CHECK (("admin_actions"."origem" = 'cli') = ("admin_actions"."admin_user_id" is null))
);
