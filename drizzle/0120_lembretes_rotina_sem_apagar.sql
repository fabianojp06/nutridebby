-- Plano 17 (spec §5.3, revisão da Tarefa 1): "a nutricionista não religa" também vale para o DELETE — sem isto a equipe
-- apagaria o lembrete que o paciente desligou e criaria outro igual, ligado. A equipe ainda o desliga do lado dela
-- (ligado = false). Passam: o contexto vazio (migration) e o worker (anonimização), e o paciente bloqueado (a exclusão
-- atendida, Tarefa 7, leva o paciente a `bloqueado` antes de apagar, na mesma transação). O paciente nunca apaga (RLS).
CREATE OR REPLACE FUNCTION app_lembretes_rotina_sem_apagar() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
BEGIN
  IF r IN ('', 'worker') OR OLD.desligado_pelo_paciente_em IS NULL THEN
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM public.patients p WHERE p.tenant_id = OLD.tenant_id AND p.id = OLD.patient_id AND p.status = 'bloqueado') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'a equipe não apaga o lembrete que o paciente desligou' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE TRIGGER lembretes_rotina_sem_apagar BEFORE DELETE ON lembretes_rotina FOR EACH ROW EXECUTE FUNCTION app_lembretes_rotina_sem_apagar();
