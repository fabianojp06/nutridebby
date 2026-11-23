-- SUS-102 (segurança): `tenants` não tem RLS (tabela do M1 fora da RLS, regra 1 do CLAUDE.md). Até aqui só dois gatilhos
-- guardavam colunas (`tenants_interruptores_da_admin`, 0100/0116, e `tenants_ia_nutri_da_equipe`, 0116); qualquer sessão
-- withTenant mudava o resto (status, slug, agenda, DPA, armazenamento…) de QUALQUER consultório, e criava ou apagava
-- consultórios. Este gatilho (BEFORE INSERT OR UPDATE OR DELETE) fecha por sessão:
--   * INSERT e DELETE: só o contexto vazio (admin, que roda sem `app.role`, fora de withTenant — `criarContaNutri` em
--     src/modules/plataforma/contas.ts —, migrations, scripts, seed do E2E e dos testes) e o `worker`; qualquer outro papel
--     (nutri, paciente, publico, conta) dá 42501. Não é REVOKE: o admin usa o mesmo role do banco (`nutri_app`).
--   * UPDATE em paciente, publico e conta: só a linha do próprio `app.tenant_id` (outra linha — e, na `conta`, que não tem
--     tenant, qualquer linha — dá 42501 mesmo sem mudança: o UPDATE sem mudança também trava a linha); nela, nenhuma coluna
--     muda, salvo a liberada de propósito abaixo; o UPDATE sem mudança passa;
--   * UPDATE em nutri: só a linha do próprio `app.tenant_id` (outra linha, ou trocar o `id`, dá 42501); nela, nunca as colunas
--     da admin — `status` (suspensão, `suspensao.ts`), `wa_cota_mensal`, `taxa_faltas_base`, `go_live_em` (`metricas.ts`) e
--     `dpa_aceito_em`/`dpa_versao` (`registrarAceiteDpa`, `dpa.ts`), todos gravados no contexto vazio (`db.transaction`/
--     `db.update`, fora de withTenant: levantamento do SUS-102 e do /code-review high do PR #62); o resto é livre, e as
--     regras dos dois gatilhos de antes continuam valendo, sem repetir aqui. `armazenamento_bytes` fica livre para a
--     nutricionista nos dois sentidos: `apagarArquivo` (armazenamento.ts) devolve o espaço na sessão dela (exame, anexo,
--     capa, documento…), e a troca de arquivo (`liberados`) pode passar a cota por um instante, até o `apagarArquivo` do
--     substituído — um teto ou "só para cima" aqui quebraria os dois caminhos;
--   * worker e contexto vazio: UPDATE como antes.
-- Coluna liberada para a sessão de PACIENTE (e só no próprio consultório, só para cima e só até a cota):
--   * armazenamento_bytes — a reserva da cota em `salvarArquivo`/`salvarArquivos` (src/modules/plataforma/armazenamento.ts)
--     com a sessão do paciente: foto do diário (US-042, `diario_foto_original`) e original do exame enviado (US-160,
--     `exame_original`, `enviarExame`). A devolução (`apagarArquivo`) nunca roda numa sessão de paciente que apague linha —
--     `stored_files` só aceita INSERT dela —, então o paciente nunca baixa o contador. O teto 5368709120 é o
--     `COTA_BYTES` (5 GiB, RN-18) de armazenamento.ts, a mesma conta do UPDATE condicional de `gravarArquivos` (o paciente
--     nunca usa `liberados` nem `naoBarrarPelaCota`); mudou a constante, muda aqui — `src/db/tenants-gatilho.test.ts`
--     confere os dois.
-- publico e conta: nenhum caminho do código muda `tenants` (levantamento do SUS-102), então nada é liberado.
-- Nome com "p", depois de `tenants_ia_nutri_da_equipe` e `tenants_interruptores_da_admin` (os BEFORE rodam em ordem alfabética):
-- quem já recusava continua recusando com a mesma mensagem. O gatilho não reescreve NEW (sem o problema dos microssegundos).
CREATE OR REPLACE FUNCTION app_tenants_por_sessao() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
  t uuid := app_current_tenant();
BEGIN
  IF TG_OP IN ('INSERT', 'DELETE') THEN
    IF r NOT IN ('', 'worker') THEN
      RAISE EXCEPTION 'as sessões do consultório não criam nem apagam consultório' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF r IN ('paciente', 'publico', 'conta') THEN
    IF t IS NULL OR OLD.id <> t THEN
      RAISE EXCEPTION 'as sessões de paciente, pública e de conta não mudam o consultório' USING ERRCODE = '42501';
    END IF;
    IF to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN
      RETURN NEW;
    END IF;
    IF r = 'paciente'
       AND NEW.armazenamento_bytes > OLD.armazenamento_bytes
       AND NEW.armazenamento_bytes <= 5368709120 -- COTA_BYTES (armazenamento.ts)
       AND (to_jsonb(NEW) - 'armazenamento_bytes') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'armazenamento_bytes') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'as sessões de paciente, pública e de conta não mudam o consultório' USING ERRCODE = '42501';
  ELSIF r = 'nutri' THEN
    IF t IS NULL OR OLD.id <> t OR NEW.id <> OLD.id THEN
      RAISE EXCEPTION 'a sessão da nutricionista só muda o próprio consultório' USING ERRCODE = '42501';
    END IF;
    IF (NEW.status, NEW.wa_cota_mensal, NEW.taxa_faltas_base, NEW.go_live_em, NEW.dpa_aceito_em, NEW.dpa_versao)
       IS DISTINCT FROM (OLD.status, OLD.wa_cota_mensal, OLD.taxa_faltas_base, OLD.go_live_em, OLD.dpa_aceito_em, OLD.dpa_versao) THEN
      RAISE EXCEPTION 'só a admin muda a situação, a cota de WhatsApp, as métricas de base e o aceite do DPA do consultório'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER tenants_por_sessao BEFORE INSERT OR UPDATE OR DELETE ON tenants FOR EACH ROW EXECUTE FUNCTION app_tenants_por_sessao();
