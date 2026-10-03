-- Revisão final do Plano 05 (gerada pelo drizzle-kit a partir do schema; rodar com DATABASE_URL_MIGRATOR, CLAUDE.md regra 7).
-- (a) appointments_link_online: com `link_online ~ '^https://'` sozinho, online com link nulo dava NULL (lógica de 3 valores)
--     e o CHECK passava; agora `is not null` explícito e `\S+` como o linkValido da aplicação (src/modules/agenda/consultas.ts).
-- (b) public_booking_requests.appointment_id ganha a FK composta (mesmo tenant) como as outras tabelas da agenda; NO ACTION,
--     como notifications_consulta_fk e consultations_consulta_fk: consulta não é apagada (cancelar muda o status), e o
--     pedido some sozinho em 24 h (agenda-limpeza); o seed do E2E apaga os pedidos antes das consultas.
-- appointments e public_booking_requests ainda não existem em produção (Plano 05 não publicado): sem migração de dados.
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_link_online";--> statement-breakpoint
ALTER TABLE "public_booking_requests" ADD CONSTRAINT "public_booking_requests_consulta_fk" FOREIGN KEY ("tenant_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_link_online" CHECK (("appointments"."modalidade" = 'presencial' and "appointments"."link_online" is null) or ("appointments"."modalidade" = 'online' and "appointments"."link_online" is not null and "appointments"."link_online" ~ '^https://\S+$' and char_length("appointments"."link_online") <= 500));