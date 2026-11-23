-- Limpeza dos Minor P17–P20 (TRI-17-20; triagem, seção 3). CLAUDE.md regra 2 (Plano 17). Nada de 0119/0120 é editado.
-- TRI-17-20 #5 (triagem, seção 3, item 2): a equipe apagava a marca do último slot e reabria o envio (o push saía de novo em
-- até 10 min). O DELETE da marca passa a ser só do worker e do contexto vazio (migration, anonimização) — e da cascata do
-- lembrete (FK lembretes_rotina_envios_lembrete_fk, ON DELETE CASCADE): a equipe ainda apaga o lembrete e a marca sai junto,
-- inclusive na exclusão atendida (lgpd.ts). A cascata roda dentro do gatilho de RI do lembrete, então aqui pg_trigger_depth()
-- é 2 (conferido em banco.test.ts); um DELETE direto da sessão `nutri` tem profundidade 1. Os outros papéis: 42501.
CREATE OR REPLACE FUNCTION app_lembretes_rotina_envios_sem_apagar() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF coalesce(app_current_role(), '') IN ('', 'worker') OR pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'a marca de envio do lembrete só sai pelo worker ou com o lembrete' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE TRIGGER lembretes_rotina_envios_sem_apagar BEFORE DELETE ON lembretes_rotina_envios FOR EACH ROW EXECUTE FUNCTION app_lembretes_rotina_envios_sem_apagar();
