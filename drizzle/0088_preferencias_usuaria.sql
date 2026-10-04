ALTER TABLE "user" ADD COLUMN "tema" text DEFAULT 'sistema' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "guia" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_tema_valido" CHECK ("user"."tema" in ('sistema','claro','escuro'));