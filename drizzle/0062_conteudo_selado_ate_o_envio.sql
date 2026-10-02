-- T14 (US-010, revisão da T11): o texto cifrado de uma notificação (convite por WhatsApp, com o link de uso único do
-- convite) só existe enquanto ela pode sair — toda saída final (enviada, ignorada, falhou…) o apaga. A tabela é do
-- Plano 05 (ainda sem dados de produção): a restrição vale para as linhas que já existem.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_conteudo_so_antes_do_envio" CHECK ("notifications"."conteudo_selado" is null or "notifications"."status" in ('pendente', 'enviando'));
