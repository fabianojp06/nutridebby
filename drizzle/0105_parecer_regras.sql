-- Plano 13 (spec de documentos assinados v0.5, "Plano 13 — preparação"): retificação no banco. Custom (regra 2 do
-- CLAUDE.md): não edita as migrations 0089/0091/0093. Rodar com DATABASE_URL_MIGRATOR (regra 7). Sem migração de dados e
-- sem DISABLE TRIGGER (SBIS NGS1.07.01); o gatilho de auditoria (regra 8, 0090) não muda.

-- 1. RN-146: o INSERT da versão nova. Sem retifica_id, só a versão 1, em qualquer estado (a fábrica do teste de
-- isolamento, D19 do 10A, e os helpers inserem emitidos direto; nenhuma usa retifica_id). Com retifica_id: só em RASCUNHO
-- (o motivo, regra (a) abaixo, e as colunas do preparo e da assinatura passam pelo ramo de rascunho do
-- app_documento_imutavel; um INSERT direto já "preparando"/"assinado" pularia o motivo e deixaria duas versões "assinado"
-- em vigor), da original do mesmo tenant e paciente, do MESMO tipo, ainda "assinado" (a versão em vigor) e não
-- anonimizada, e com a versão seguinte à dela. FOR SHARE: um cancelamento ou uma substituição concorrentes da original
-- esperam este INSERT (e vice-versa).
CREATE OR REPLACE FUNCTION app_documento_versao() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  o record;
BEGIN
  IF NEW.retifica_id IS NULL THEN
    IF NEW.versao <> 1 THEN
      RAISE EXCEPTION 'versão sem retificação (RN-146)' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status <> 'rascunho' THEN
    RAISE EXCEPTION 'retificação fora da regra (RN-146): a versão nova nasce em rascunho' USING ERRCODE = '42501';
  END IF;
  SELECT tipo, status, versao, anonimizado_em INTO o
    FROM signed_documents
   WHERE id = NEW.retifica_id AND tenant_id = NEW.tenant_id AND patient_id = NEW.patient_id
   FOR SHARE;
  IF NOT FOUND OR o.tipo <> NEW.tipo OR o.status <> 'assinado' OR o.anonimizado_em IS NOT NULL OR NEW.versao <> o.versao + 1 THEN
    RAISE EXCEPTION 'retificação fora da regra (RN-146): só da versão em vigor, do mesmo tipo, com a versão seguinte' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER documento_versao BEFORE INSERT ON signed_documents FOR EACH ROW EXECUTE FUNCTION app_documento_versao();
--> statement-breakpoint
-- 2. app_documento_imutavel (0093) com três regras do Plano 13 — o resto é o da 0093, linha a linha:
--   (a) rascunho → preparando de uma retificação exige o motivo na nota (Q13-1, SBIS NGS1.12.01);
--   (b) assinado → cancelado recusado com uma retificação em andamento (RN-147 no banco, D-P3 do plano);
--   (c) assinado → substituido só com uma retificação desta já "assinado" (RN-146: na mesma transação da assinatura dela).
-- search_path fixo (Minor do Plano 12 para as funções de gatilho).
CREATE OR REPLACE FUNCTION app_documento_imutavel() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  o jsonb;
  n jsonb;
  mudou text[];
  fixas constant text[] := ARRAY['id', 'tenant_id', 'patient_id', 'tipo', 'versao', 'retifica_id', 'created_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'rascunho' THEN
      RAISE EXCEPTION 'documento fora do rascunho não é apagado (RN-140)' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  o := to_jsonb(OLD) - 'updated_at';
  n := to_jsonb(NEW) - 'updated_at';
  IF o = n THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(array_agg(k), '{}') INTO mudou FROM jsonb_object_keys(o) AS k WHERE o -> k IS DISTINCT FROM n -> k;
  IF mudou && fixas THEN
    RAISE EXCEPTION 'coluna fixa do documento (RN-140)' USING ERRCODE = '42501';
  END IF;

  -- anonimização (RN-140 c): só o worker, só documento emitido, e só limpar
  IF OLD.anonimizado_em IS NULL AND NEW.anonimizado_em IS NOT NULL THEN
    IF app_current_role() IS DISTINCT FROM 'worker' OR OLD.status NOT IN ('assinado', 'substituido', 'cancelado')
       OR NOT (mudou <@ ARRAY['anonimizado_em', 'conteudo', 'pdf_path', 'base_pdf_path', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em'])
       OR NEW.conteudo <> '{}'::jsonb OR NEW.pdf_path IS NOT NULL OR NEW.base_pdf_path IS NOT NULL THEN
      RAISE EXCEPTION 'anonimização fora da regra (RN-140 c)' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.anonimizado_em IS NOT NULL THEN
    RAISE EXCEPTION 'documento anonimizado não muda' USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'rascunho' THEN
    IF NEW.status NOT IN ('rascunho', 'preparando') OR 'anonimizado_em' = ANY (mudou) THEN
      RAISE EXCEPTION 'transição inválida a partir do rascunho (RN-141)' USING ERRCODE = '42501';
    END IF;
    IF NEW.pdf_path IS NOT NULL OR NEW.pdf_sha256 IS NOT NULL OR NEW.assinado_em IS NOT NULL OR NEW.assinatura_tipo IS NOT NULL
       OR NEW.assinado_por IS NOT NULL OR NEW.assinatura_emissor IS NOT NULL OR NEW.assinante_nome IS NOT NULL
       OR NEW.cancelado_em IS NOT NULL OR NEW.substituido_em IS NOT NULL
       OR NEW.base_pdf_path IS NOT NULL OR NEW.entregue_em IS NOT NULL
       OR NEW.digitalizacao IS NOT NULL OR NEW.digitalizacao_status IS NOT NULL OR NEW.digitalizacao_em IS NOT NULL THEN
      RAISE EXCEPTION 'rascunho sem PDF nem assinatura (RN-141)' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'preparando' AND (NEW.declaracao_em IS NULL OR NEW.pdf_status IS DISTINCT FROM 'pendente') THEN
      RAISE EXCEPTION 'preparo fora da regra (RN-141): declaração e PDF pendente' USING ERRCODE = '42501';
    END IF;
    -- (a) Plano 13: a retificação vai ao preparo só com o motivo (1–500, não só espaços, tabulações ou quebras de linha)
    IF NEW.status = 'preparando' AND NEW.retifica_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM signed_document_notes nt
          WHERE nt.documento_id = NEW.id AND char_length(btrim(coalesce(nt.motivo_retificacao, ''), E' \t\r\n')) BETWEEN 1 AND 500) THEN
      RAISE EXCEPTION 'retificação sem motivo (RN-146, SBIS NGS1.12.01)' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('preparando', 'aguardando_assinatura') THEN
    IF NEW.status = 'rascunho' THEN
      IF NOT (mudou <@ ARRAY['status', 'codigo', 'declaracao_em', 'base_pdf_path', 'base_pdf_sha256', 'base_pdf_bytes', 'area_assinatura', 'pdf_status', 'pdf_pedido_em', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em'])
         OR NEW.codigo IS NOT NULL OR NEW.declaracao_em IS NOT NULL OR NEW.base_pdf_path IS NOT NULL OR NEW.base_pdf_sha256 IS NOT NULL
         OR NEW.base_pdf_bytes IS NOT NULL OR NEW.area_assinatura IS NOT NULL
         OR NEW.digitalizacao IS NOT NULL OR NEW.digitalizacao_status IS NOT NULL OR NEW.digitalizacao_em IS NOT NULL THEN
        RAISE EXCEPTION 'voltar a editar fora da regra (RN-140 a)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.status = 'preparando' AND NEW.status = 'aguardando_assinatura' THEN
      IF app_current_role() IS DISTINCT FROM 'worker'
         OR NOT (mudou <@ ARRAY['status', 'pdf_status', 'base_pdf_path', 'base_pdf_sha256', 'base_pdf_bytes', 'area_assinatura'])
         OR OLD.base_pdf_path IS NOT NULL OR NEW.base_pdf_path IS NULL OR NEW.base_pdf_sha256 IS NULL OR NEW.base_pdf_bytes IS NULL THEN
        RAISE EXCEPTION 'PDF base fora da regra (RN-141)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.status = OLD.status THEN
      IF NOT (mudou <@ ARRAY['pdf_status', 'pdf_pedido_em'])
         AND NOT (OLD.status = 'aguardando_assinatura' AND mudou <@ ARRAY['pdf_status', 'pdf_pedido_em', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em']) THEN
        RAISE EXCEPTION 'conteúdo congelado desde o preparo (RN-140)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.status = 'aguardando_assinatura' AND NEW.status = 'assinado' THEN
      IF NOT (mudou <@ ARRAY['status', 'pdf_path', 'pdf_sha256', 'assinatura_tipo', 'assinatura_emissor', 'assinante_nome', 'assinado_em', 'assinado_por', 'entregue_em', 'digitalizacao_status', 'digitalizacao_em']) THEN
        RAISE EXCEPTION 'assinatura fora da regra (RN-140 b)' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM stored_files f
                      WHERE f.caminho = NEW.pdf_path AND f.tenant_id = NEW.tenant_id AND f.patient_id = NEW.patient_id AND f.tipo = 'documento_assinado') THEN
        RAISE EXCEPTION 'PDF assinado fora da regra (RN-140 b): arquivo de outro tipo' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'transição inválida (RN-141)' USING ERRCODE = '42501';
  END IF;

  IF NOT (NEW.base_pdf_path IS NULL OR NEW.base_pdf_path IS NOT DISTINCT FROM OLD.base_pdf_path)
     OR NOT (NEW.digitalizacao IS NULL OR (OLD.digitalizacao IS NOT NULL AND jsonb_typeof(NEW.digitalizacao) = 'array' AND OLD.digitalizacao @> NEW.digitalizacao)) THEN
    RAISE EXCEPTION 'ponteiro de arquivo de documento emitido só sai (RN-140, regra 9)' USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'assinado' THEN
    IF NEW.status = 'assinado' AND mudou <@ ARRAY['base_pdf_path', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em', 'entregue_em']
       AND (OLD.entregue_em IS NULL OR NEW.entregue_em IS NOT DISTINCT FROM OLD.entregue_em) THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'cancelado' AND mudou <@ ARRAY['status', 'cancelado_em', 'base_pdf_path', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em'] AND NEW.cancelado_em IS NOT NULL THEN
      -- (b) Plano 13 (RN-147): conclua ou apague a retificação antes de cancelar
      IF EXISTS (SELECT 1 FROM signed_documents r
                  WHERE r.retifica_id = OLD.id AND r.tenant_id = OLD.tenant_id AND r.status IN ('rascunho', 'preparando', 'aguardando_assinatura')) THEN
        RAISE EXCEPTION 'cancelamento com retificação em andamento (RN-147)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.status = 'substituido' AND mudou <@ ARRAY['status', 'substituido_em', 'base_pdf_path', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em'] AND NEW.substituido_em IS NOT NULL THEN
      -- (c) Plano 13 (RN-146): só quando a retificação desta já foi assinada (na mesma transação, registrarAssinatura)
      IF NOT EXISTS (SELECT 1 FROM signed_documents r
                      WHERE r.retifica_id = OLD.id AND r.tenant_id = OLD.tenant_id AND r.status = 'assinado') THEN
        RAISE EXCEPTION 'substituição só com a retificação assinada (RN-146)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'documento assinado não muda (RN-140)' USING ERRCODE = '42501';
  END IF;

  IF NEW.status = OLD.status AND mudou <@ ARRAY['base_pdf_path', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em'] THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'documento emitido não muda (RN-140)' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
-- 3. app_notas_imutaveis (0091) com o motivo da retificação: só numa versão nova (retifica_id), livre no rascunho, fixo do
-- preparo em diante (como a justificativa), limpo na anonimização.
CREATE OR REPLACE FUNCTION app_notas_imutaveis() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  d record;
BEGIN
  SELECT status, anonimizado_em, retifica_id INTO d FROM signed_documents WHERE id = coalesce(NEW.documento_id, OLD.documento_id);
  IF TG_OP = 'DELETE' THEN
    IF d.status IS NOT NULL AND d.status <> 'rascunho' THEN
      RAISE EXCEPTION 'nota de documento emitido não é apagada (RN-140)' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.documento_id) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.documento_id) THEN
    RAISE EXCEPTION 'coluna fixa da nota (RN-140)' USING ERRCODE = '42501';
  END IF;
  IF d.anonimizado_em IS NOT NULL THEN
    IF NEW.justificativa_uso IS NOT NULL OR NEW.motivo_cancelamento IS NOT NULL OR NEW.motivo_retificacao IS NOT NULL THEN
      RAISE EXCEPTION 'nota de documento anonimizado só é limpa' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.motivo_retificacao IS NOT NULL AND d.retifica_id IS NULL THEN
    RAISE EXCEPTION 'motivo de retificação só numa retificação (RN-146)' USING ERRCODE = '42501';
  END IF;
  IF d.status = 'rascunho' THEN
    IF NEW.motivo_cancelamento IS NOT NULL THEN
      RAISE EXCEPTION 'rascunho não tem motivo de cancelamento' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (TG_OP = 'INSERT' AND (NEW.justificativa_uso IS NOT NULL OR NEW.motivo_retificacao IS NOT NULL))
     OR (TG_OP = 'UPDATE' AND (NEW.justificativa_uso IS DISTINCT FROM OLD.justificativa_uso OR NEW.motivo_retificacao IS DISTINCT FROM OLD.motivo_retificacao))
     OR (NEW.motivo_cancelamento IS NOT NULL AND (d.status <> 'cancelado' OR (TG_OP = 'UPDATE' AND OLD.motivo_cancelamento IS NOT NULL AND NEW.motivo_cancelamento IS DISTINCT FROM OLD.motivo_cancelamento)))
     OR (TG_OP = 'UPDATE' AND OLD.motivo_cancelamento IS NOT NULL AND NEW.motivo_cancelamento IS NULL) THEN
    RAISE EXCEPTION 'nota congelada desde o preparo (RN-140)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- 4. app_anonimizar_documentos (0091) limpando também o motivo da retificação. O resto é o da 0091.
CREATE OR REPLACE FUNCTION app_anonimizar_documentos(p_documento uuid) RETURNS text
LANGUAGE plpgsql VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := app_current_tenant();
  v_caminho text;
BEGIN
  IF v_tenant IS NULL OR app_current_role() IS DISTINCT FROM 'worker' THEN
    RAISE EXCEPTION 'app_anonimizar_documentos() só roda no contexto worker de um tenant' USING ERRCODE = '42501';
  END IF;
  SELECT sd.pdf_path INTO v_caminho
    FROM public.signed_documents sd
    JOIN public.patients p ON p.tenant_id = sd.tenant_id AND p.id = sd.patient_id
   WHERE sd.id = p_documento AND sd.tenant_id = v_tenant AND p.status = 'bloqueado' AND p.anonimizado_em IS NULL
     AND sd.anonimizado_em IS NULL AND sd.status IN ('assinado', 'substituido', 'cancelado')
   FOR UPDATE OF sd;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'app_anonimizar_documentos(): documento emitido de paciente bloqueado não encontrado neste tenant' USING ERRCODE = '42501';
  END IF;
  UPDATE public.signed_documents
     SET anonimizado_em = clock_timestamp(), conteudo = '{}'::jsonb, pdf_path = NULL, base_pdf_path = NULL, digitalizacao = NULL, digitalizacao_status = NULL, digitalizacao_em = NULL, updated_at = clock_timestamp()
   WHERE id = p_documento;
  UPDATE public.signed_document_notes
     SET justificativa_uso = NULL, motivo_cancelamento = NULL, motivo_retificacao = NULL, updated_at = clock_timestamp()
   WHERE documento_id = p_documento;
  UPDATE public.document_verifications SET situacao = 'eliminado', situacao_em = clock_timestamp() WHERE documento_id = p_documento;
  DELETE FROM public.document_access_codes WHERE documento_id = p_documento;
  RETURN v_caminho;
END $$;
