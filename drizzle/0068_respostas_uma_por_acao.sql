-- Code-review do PR #7 (gerada pelo drizzle-kit a partir do schema; rodar com DATABASE_URL_MIGRATOR, CLAUDE.md regra 7):
-- as respostas "1"/"2" do WhatsApp (resposta_confirmacao, resposta_remarcar) saem da chave única por (consulta, canal,
-- tipo, início da consulta): são uma por ação que muda a consulta ("2" → "1" → "2" responde de novo, com e-mail novo),
-- conferida no webhook sob a trava da consulta. Os lembretes continuam com uma linha por horário (D6).
DROP INDEX "notifications_versao_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_versao_unique" ON "notifications" USING btree ("appointment_id","canal","tipo","inicio_consulta") WHERE "notifications"."tipo" in ('lembrete_24h', 'lembrete_2h');