CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" text NOT NULL,
	"ok" boolean NOT NULL,
	"bytes" bigint,
	"detalhe" text,
	"iniciado_em" timestamp with time zone NOT NULL,
	"concluido_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_runs_tipo_valido" CHECK ("backup_runs"."tipo" in ('banco', 'arquivos'))
);
--> statement-breakpoint
CREATE INDEX "backup_runs_tipo_idx" ON "backup_runs" USING btree ("tipo","concluido_em");