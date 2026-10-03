CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_vinculo_endpoint_unique" UNIQUE("tenant_id","patient_id","endpoint"),
	CONSTRAINT "push_subscriptions_endpoint_https" CHECK ("push_subscriptions"."endpoint" ~ '^https://' and char_length("push_subscriptions"."endpoint") <= 1000),
	CONSTRAINT "push_subscriptions_chaves" CHECK ("push_subscriptions"."p256dh" ~ '^[A-Za-z0-9_-]{80,100}$' and "push_subscriptions"."auth" ~ '^[A-Za-z0-9_-]{16,30}$'),
	CONSTRAINT "push_subscriptions_user_agent" CHECK (char_length("push_subscriptions"."user_agent") <= 300)
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;