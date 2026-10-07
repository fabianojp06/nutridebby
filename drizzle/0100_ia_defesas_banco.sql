-- Plano 11, revisão final (Minors 1, 2 e 3 de segurança): defesa em profundidade no banco. Sem tabela nova.
--
-- Minor 1 (LGPD art. 9º; D13): a sessão nutri não registra ciência por e-mail — nem trocando versão ou data de quem já
-- tem canal 'email' (seria a ciência de uma versão nova do aviso sem o envio). Com canal 'email', a nutricionista só
-- grava (versão, data, canal) iguais aos de antes (a recusa e o envio pendente continuam livres). O resto da 0099 fica.
CREATE OR REPLACE FUNCTION app_patients_ia_quem() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
BEGIN
  IF (TG_OP = 'INSERT' AND (NEW.ia_aviso_versao IS NOT NULL OR NEW.ia_aviso_enviado_em IS NOT NULL OR NEW.ia_recusada_em IS NOT NULL))
     OR (TG_OP = 'UPDATE' AND (NEW.ia_aviso_versao, NEW.ia_aviso_em, NEW.ia_aviso_canal, NEW.ia_aviso_enviado_em, NEW.ia_recusada_em)
         IS DISTINCT FROM (OLD.ia_aviso_versao, OLD.ia_aviso_em, OLD.ia_aviso_canal, OLD.ia_aviso_enviado_em, OLD.ia_recusada_em)) THEN
    IF r NOT IN ('', 'nutri', 'worker') THEN
      RAISE EXCEPTION 'a ciência e a recusa de IA só mudam pela nutricionista ou pelo worker' USING ERRCODE = '42501';
    END IF;
    IF r = 'nutri' AND NEW.ia_aviso_canal = 'email'
       AND (TG_OP = 'INSERT'
            OR (NEW.ia_aviso_versao, NEW.ia_aviso_em, NEW.ia_aviso_canal) IS DISTINCT FROM (OLD.ia_aviso_versao, OLD.ia_aviso_em, OLD.ia_aviso_canal)) THEN
      RAISE EXCEPTION 'a ciência por e-mail só é registrada no pós-envio (worker)' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Minor 2 (§5.11, exportação do titular): a tarefa não muda de consultório, de paciente, de tipo, de quem pediu nem de
-- modelo; exam_id só vai a nulo (o SET NULL da exclusão do exame, 0099) e saiu_em, uma vez gravado, nunca muda nem volta a
-- nulo (é o que a exportação mostra). Situação, conteúdo, datas de execução e custo seguem livres (worker, conferência,
-- cancelamento, varredura). Recusa com 42501, como a RLS e o gatilho de apagar.
CREATE OR REPLACE FUNCTION app_ia_tarefas_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.tipo, NEW.pedido_por, NEW.modelo, NEW.prompt_versao, NEW.criado_em)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.tipo, OLD.pedido_por, OLD.modelo, OLD.prompt_versao, OLD.criado_em) THEN
    RAISE EXCEPTION 'coluna fixa da tarefa de IA' USING ERRCODE = '42501';
  END IF;
  IF NEW.exam_id IS NOT NULL AND NEW.exam_id IS DISTINCT FROM OLD.exam_id THEN
    RAISE EXCEPTION 'a tarefa de IA não muda de exame' USING ERRCODE = '42501';
  END IF;
  IF OLD.saiu_em IS NOT NULL AND NEW.saiu_em IS DISTINCT FROM OLD.saiu_em THEN
    RAISE EXCEPTION 'a saída do laudo ao provedor não é apagada nem reescrita' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ia_tarefas_imutavel BEFORE UPDATE ON ia_tarefas FOR EACH ROW EXECUTE FUNCTION app_ia_tarefas_imutavel();
--> statement-breakpoint
-- Minor 3 (A-06, D20 do 10A): os interruptores da admin — ia_liberada, ia_cota_mensal_usd e documentos_liberados — só mudam
-- fora de withTenant (a admin roda sem app.role; migrations e seed também). `tenants` não tem RLS: sem isto, qualquer
-- contexto withTenant (nutri, paciente, publico, worker) poderia ligá-los. As outras colunas (ativação da IA pela
-- nutricionista, marca do aviso de 80%, armazenamento, perfil) seguem como estão.
CREATE OR REPLACE FUNCTION app_tenants_interruptores_da_admin() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_current_role() IS NOT NULL
     AND (NEW.ia_liberada, NEW.ia_cota_mensal_usd, NEW.documentos_liberados)
         IS DISTINCT FROM (OLD.ia_liberada, OLD.ia_cota_mensal_usd, OLD.documentos_liberados) THEN
    RAISE EXCEPTION 'só a admin muda a liberação da IA, o limite de IA e a liberação dos documentos' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER tenants_interruptores_da_admin BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION app_tenants_interruptores_da_admin();
