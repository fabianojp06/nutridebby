CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"termo_versao" text NOT NULL,
	"aceito_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	CONSTRAINT "consents_user_termo_unique" UNIQUE("user_id","termo_versao")
);
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- T6-R2c: consents é prova de aceite do DPA (append-only), mesmo padrão de audit_log (0002).
REVOKE UPDATE, DELETE ON consents FROM nutri_app_role;