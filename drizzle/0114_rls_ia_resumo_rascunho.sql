-- Plano 14B (RN-120, D11): app_ia_tarefas_imutavel (0108) + carimbo_dados entre as colunas fixas (o "Reaproveitar"
-- compara com ele). O resto é o da 0108, linha a linha. Os tipos novos (resumo_historico, rascunho_plano) herdam, sem
-- mudança, a RLS e o staff_only, a auditoria (entidade `ia`) e o ia_tarefas_sem_apagar da 0099.
-- O carimbo é gravado no pedido, mas o que sai é remontado no portão do worker (D12, paciente travado): para o
-- "Reaproveitar" nunca devolver um resumo feito com dados diferentes dos do carimbo, o worker grava o carimbo do pedido
-- montado no mesmo UPDATE que marca enviado_em — a única troca aceita (contexto worker, tarefa em processando ainda não
-- enviada, enviado_em preenchido junto). Fora disso, o carimbo é fixo.
CREATE OR REPLACE FUNCTION app_ia_tarefas_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.tipo, NEW.pedido_por, NEW.modelo, NEW.prompt_versao, NEW.criado_em)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.tipo, OLD.pedido_por, OLD.modelo, OLD.prompt_versao, OLD.criado_em) THEN
    RAISE EXCEPTION 'coluna fixa da tarefa de IA' USING ERRCODE = '42501';
  END IF;
  IF NEW.carimbo_dados IS DISTINCT FROM OLD.carimbo_dados
     AND NOT (app_current_role() IS NOT DISTINCT FROM 'worker' AND OLD.status = 'processando'
              AND OLD.enviado_em IS NULL AND NEW.enviado_em IS NOT NULL) THEN
    RAISE EXCEPTION 'coluna fixa da tarefa de IA' USING ERRCODE = '42501';
  END IF;
  IF NEW.exam_id IS NOT NULL AND NEW.exam_id IS DISTINCT FROM OLD.exam_id THEN
    RAISE EXCEPTION 'a tarefa de IA não muda de exame' USING ERRCODE = '42501';
  END IF;
  IF OLD.saiu_em IS NOT NULL AND NEW.saiu_em IS DISTINCT FROM OLD.saiu_em THEN
    RAISE EXCEPTION 'a saída do laudo ao provedor não é apagada nem reescrita' USING ERRCODE = '42501';
  END IF;
  IF OLD.destino IS NOT NULL AND NEW.destino IS DISTINCT FROM OLD.destino THEN
    RAISE EXCEPTION 'o destino da saída ao provedor não muda' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
