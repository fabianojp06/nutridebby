-- SUS-102 (segurança): `tenants` não tem RLS (tabela do M1 fora da RLS, regra 1 do CLAUDE.md). Até aqui só dois gatilhos
-- guardavam colunas (`tenants_interruptores_da_admin`, 0100/0116, e `tenants_ia_nutri_da_equipe`, 0116); qualquer sessão
-- withTenant mudava o resto (status, slug, agenda, DPA, armazenamento…) de QUALQUER consultório. Este gatilho fecha por sessão:
--   * paciente, publico e conta: nenhuma coluna muda, salvo a liberada de propósito abaixo; UPDATE sem mudança passa;
--   * nutri: só a linha do próprio `app.tenant_id` (outra linha, ou trocar o `id`, dá 42501), com qualquer coluna — as
--     regras dos dois gatilhos de antes continuam valendo, sem repetir aqui;
--   * worker, admin (roda sem `app.role`, fora de withTenant) e o contexto vazio (migrations, scripts, seed): como antes.
-- Coluna liberada para a sessão de PACIENTE (e só no próprio consultório, e só para cima):
--   * armazenamento_bytes — a reserva da cota em `salvarArquivo`/`salvarArquivos` (src/modules/plataforma/armazenamento.ts)
--     com a sessão do paciente: foto do diário (US-042, `diario_foto_original`) e original do exame enviado (US-160,
--     `exame_original`, `enviarExame`). A devolução (`apagarArquivo`) nunca roda numa sessão de paciente que apague linha —
--     `stored_files` só aceita INSERT dela —, então o paciente nunca baixa o contador.
-- publico e conta: nenhum caminho do código muda `tenants` (levantamento do SUS-102), então nada é liberado.
-- Nome com "p", depois de `tenants_ia_nutri_da_equipe` e `tenants_interruptores_da_admin` (os BEFORE rodam em ordem alfabética):
-- quem já recusava continua recusando com a mesma mensagem. O gatilho não reescreve NEW (sem o problema dos microssegundos).
CREATE OR REPLACE FUNCTION app_tenants_por_sessao() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
BEGIN
  IF r IN ('paciente', 'publico', 'conta') THEN
    IF to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN
      RETURN NEW;
    END IF;
    IF r = 'paciente'
       AND OLD.id = app_current_tenant()
       AND NEW.armazenamento_bytes > OLD.armazenamento_bytes
       AND (to_jsonb(NEW) - 'armazenamento_bytes') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'armazenamento_bytes') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'as sessões de paciente, pública e de conta não mudam o consultório' USING ERRCODE = '42501';
  ELSIF r = 'nutri' THEN
    IF app_current_tenant() IS NULL OR OLD.id <> app_current_tenant() OR NEW.id <> OLD.id THEN
      RAISE EXCEPTION 'a sessão da nutricionista só muda o próprio consultório' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER tenants_por_sessao BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION app_tenants_por_sessao();
