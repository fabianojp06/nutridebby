-- Fechamento do Plano 05 (decisões do dono; gerada pelo drizzle-kit a partir do schema + o UPDATE de dados no fim; rodar com DATABASE_URL_MIGRATOR, CLAUDE.md regra 7):
-- (E) consulta cancelada sozinha ao atender o pedido de exclusão (US-018): cancelado_por = 'sistema'.
-- (F) página pública de agendamento desligada por padrão — nos tenants novos (DEFAULT) e em TODOS os existentes (UPDATE
--     de dados em `tenants`, tabela sem RLS nem auditoria); a nutricionista liga em Configurações.
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_cancelado_por_valido";--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "agendamento_publico_ativo" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelado_por_valido" CHECK ("appointments"."cancelado_por" is null or "appointments"."cancelado_por" in ('nutri', 'paciente', 'sistema'));--> statement-breakpoint
UPDATE "tenants" SET "agendamento_publico_ativo" = false;
