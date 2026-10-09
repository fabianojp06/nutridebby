-- Plano 14A (spec da IA v0.5.1, RN-128, D17): a ciência do aviso de IA e o "Não usar IA" do Plano 11 saíram do código (a
-- autorização do paciente, ia_autorizacoes, é a condição agora). As colunas FICAM, congeladas: nenhuma sessão do app —
-- qualquer app.role — as grava, nem num INSERT. No contexto vazio (migration, script do dono) passa, para a remoção
-- futura (PM-17: migration destrutiva só com o OK do dono, depois de conferir que estão vazias em produção). A exportação
-- continua a mostrá-las enquanto preenchidas. Janela do deploy: um job aviso_ia pego pelo worker ANTIGO depois desta
-- migration falha aqui e o pg-boss o repete; o worker novo o descarta sem gravar (processEmailJob). Recusa com 42501.
CREATE OR REPLACE FUNCTION app_patients_ia_quem() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_current_role() IS NOT NULL
     AND ((TG_OP = 'INSERT' AND (NEW.ia_aviso_versao IS NOT NULL OR NEW.ia_aviso_em IS NOT NULL OR NEW.ia_aviso_canal IS NOT NULL
                                 OR NEW.ia_aviso_enviado_em IS NOT NULL OR NEW.ia_recusada_em IS NOT NULL))
          OR (TG_OP = 'UPDATE' AND (NEW.ia_aviso_versao, NEW.ia_aviso_em, NEW.ia_aviso_canal, NEW.ia_aviso_enviado_em, NEW.ia_recusada_em)
              IS DISTINCT FROM (OLD.ia_aviso_versao, OLD.ia_aviso_em, OLD.ia_aviso_canal, OLD.ia_aviso_enviado_em, OLD.ia_recusada_em))) THEN
    RAISE EXCEPTION 'a ciência e a recusa de IA do Plano 11 estão congeladas (RN-128)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
