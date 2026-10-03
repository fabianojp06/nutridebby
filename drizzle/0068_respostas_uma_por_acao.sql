-- Code-review do PR #7 (gerada pelo drizzle-kit a partir do schema; rodar com DATABASE_URL_MIGRATOR, CLAUDE.md regra 7):
-- as respostas "1"/"2" do WhatsApp (resposta_confirmacao, resposta_remarcar) saem da chave única por (consulta, canal,
-- tipo, início da consulta): o teto delas (1 WhatsApp de cada tipo por horário; o e-mail com o link sai de novo só num
-- pedido novo, a cada 60 min) é conferido no webhook sob a trava da consulta (`respostasDevidas`). Os lembretes
-- continuam com uma linha por horário (D6).
DROP INDEX "notifications_versao_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_versao_unique" ON "notifications" USING btree ("appointment_id","canal","tipo","inicio_consulta") WHERE "notifications"."tipo" in ('lembrete_24h', 'lembrete_2h');