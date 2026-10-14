-- Plano 14B (spec da IA §11, US-123 (d) (f) (g), RN-124, RN-125, RNF-102, §5.11 item 9). CLAUDE.md regra 2.
SELECT app_enable_tenant_rls('ia_geracoes_modelos');
--> statement-breakpoint
SELECT app_enable_staff_only('ia_geracoes_modelos');
--> statement-breakpoint
-- RNF-110: o pedido é registro técnico (quem pediu, quando, custo); nada da IA é apagado de vez (§5.11 item 3)
REVOKE DELETE, TRUNCATE ON ia_geracoes_modelos FROM nutri_app_role;
--> statement-breakpoint
-- a FK de anamnesis_templates fica aqui (o schema TS criaria import circular entre ia.ts e pacientes.ts)
ALTER TABLE anamnesis_templates ADD CONSTRAINT anamnesis_templates_ia_geracao_fk
  FOREIGN KEY (tenant_id, ia_geracao_id) REFERENCES ia_geracoes_modelos (tenant_id, id);
--> statement-breakpoint
-- tenant, área, quem pediu, modelo, versão da instrução e data do pedido não mudam depois de gravados
CREATE OR REPLACE FUNCTION app_ia_geracoes_imutavel() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.area, NEW.pedido_por, NEW.modelo, NEW.prompt_versao, NEW.criado_em)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.area, OLD.pedido_por, OLD.modelo, OLD.prompt_versao, OLD.criado_em) THEN
    RAISE EXCEPTION 'coluna fixa da geração de modelos' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ia_geracoes_modelos_imutavel BEFORE UPDATE ON ia_geracoes_modelos FOR EACH ROW EXECUTE FUNCTION app_ia_geracoes_imutavel();
--> statement-breakpoint
-- RN-125 / §5.11 item 9 (D18): a origem IA só nasce pelo worker (a gravação do pacote), sem aprovação; depois não muda; a
-- aprovação vai de nula a preenchida UMA vez, em nome da usuária da sessão, e não muda mais. No contexto vazio (migration,
-- script do dono) só valem os CHECKs. Recusa com 42501, como a RLS.
CREATE OR REPLACE FUNCTION app_modelo_ia_origem() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.ia_geracao_id IS NOT NULL AND r <> '' AND r <> 'worker' THEN
      RAISE EXCEPTION 'origem IA só pelo worker' USING ERRCODE = '42501';
    END IF;
    IF NEW.ia_geracao_id IS NOT NULL AND NEW.aprovado_em IS NOT NULL THEN
      RAISE EXCEPTION 'modelo da IA nasce sem aprovação' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.ia_geracao_id IS DISTINCT FROM OLD.ia_geracao_id THEN
    RAISE EXCEPTION 'a origem IA do modelo não muda' USING ERRCODE = '42501';
  END IF;
  IF OLD.aprovado_em IS NOT NULL AND (NEW.aprovado_em, NEW.aprovado_por) IS DISTINCT FROM (OLD.aprovado_em, OLD.aprovado_por) THEN
    RAISE EXCEPTION 'a aprovação do modelo não muda' USING ERRCODE = '42501';
  END IF;
  IF OLD.aprovado_em IS NULL AND NEW.aprovado_em IS NOT NULL AND r <> '' AND NEW.aprovado_por IS DISTINCT FROM app_current_user() THEN
    RAISE EXCEPTION 'quem aprova é a usuária da sessão' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER meal_plans_ia_origem BEFORE INSERT OR UPDATE ON meal_plans FOR EACH ROW EXECUTE FUNCTION app_modelo_ia_origem();
--> statement-breakpoint
CREATE TRIGGER anamnesis_templates_ia_origem BEFORE INSERT OR UPDATE ON anamnesis_templates FOR EACH ROW EXECUTE FUNCTION app_modelo_ia_origem();
