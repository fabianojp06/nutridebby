ALTER TABLE "tenants" ADD COLUMN "taxa_faltas_base" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "go_live_em" date;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_taxa_faltas_base_valida" CHECK ("tenants"."taxa_faltas_base" is null or "tenants"."taxa_faltas_base" between 0 and 100);