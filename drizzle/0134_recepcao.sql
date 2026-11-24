CREATE TABLE "equipe_membros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"papel" text NOT NULL,
	"financeiro" boolean DEFAULT false NOT NULL,
	"convidada_por" uuid NOT NULL,
	"desativada_em" timestamp with time zone,
	"desativada_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipe_membros_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "equipe_membros_papel_valido" CHECK ("equipe_membros"."papel" in ('recepcao')),
	CONSTRAINT "equipe_membros_desativacao" CHECK (("equipe_membros"."desativada_em" is null) = ("equipe_membros"."desativada_por" is null))
);
--> statement-breakpoint
ALTER TABLE "invites" DROP CONSTRAINT "invites_tipo_valido";--> statement-breakpoint
ALTER TABLE "invites" DROP CONSTRAINT "invites_alvo";--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT "user_app_role_valido";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ultimo_acesso_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "equipe_membros" ADD CONSTRAINT "equipe_membros_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipe_membros" ADD CONSTRAINT "equipe_membros_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipe_membros_ativas_idx" ON "equipe_membros" USING btree ("tenant_id") WHERE "equipe_membros"."desativada_em" is null;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_tipo_valido" CHECK ("invites"."tipo" in ('nutri', 'paciente', 'recepcao'));--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_alvo" CHECK (("invites"."tipo" = 'nutri' and "invites"."user_id" is not null and "invites"."patient_id" is null)
       or ("invites"."tipo" = 'recepcao' and "invites"."user_id" is not null and "invites"."patient_id" is null and "invites"."tenant_id" is not null)
       or ("invites"."tipo" = 'paciente' and "invites"."user_id" is null and "invites"."tenant_id" is not null and "invites"."patient_id" is not null));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_recepcao_com_tenant" CHECK ("user"."app_role" <> 'recepcao' or "user"."tenant_id" is not null);--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_app_role_valido" CHECK ("user"."app_role" in ('admin','nutri','paciente','recepcao'));