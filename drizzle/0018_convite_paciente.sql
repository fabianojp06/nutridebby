ALTER TABLE "consents" DROP CONSTRAINT "consents_user_termo_unique";--> statement-breakpoint
ALTER TABLE "invites" DROP CONSTRAINT "invites_tipo_valido";--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "patient_id" uuid;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invites_paciente_pendente_idx" ON "invites" USING btree ("patient_id") WHERE "invites"."usado_em" is null;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_termo_tenant_unique" UNIQUE NULLS NOT DISTINCT("user_id","termo_versao","tenant_id");--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_alvo" CHECK (("invites"."tipo" = 'nutri' and "invites"."user_id" is not null and "invites"."patient_id" is null)
       or ("invites"."tipo" = 'paciente' and "invites"."user_id" is null and "invites"."tenant_id" is not null and "invites"."patient_id" is not null));--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_tipo_valido" CHECK ("invites"."tipo" in ('nutri', 'paciente'));