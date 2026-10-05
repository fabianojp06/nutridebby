-- RN-140 / RN-141 (spec de documentos assinados v0.3): a imutabilidade é do BANCO. Por estado, só as colunas listadas
-- mudam; updated_at sempre; um UPDATE que não muda nada passa. ERRCODE 42501 (o mesmo da RLS e do paciente_colunas).
CREATE OR REPLACE FUNCTION app_documento_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
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
    -- Minor 13 (revisão de segurança): fora dos emitidos, nada do PDF assinado nem do base (defesa em profundidade)
    -- e nada da digitalizada (revisão T2, I1: a trava D24 e as fotos só existem em aguardando_assinatura)
    IF NEW.pdf_path IS NOT NULL OR NEW.pdf_sha256 IS NOT NULL OR NEW.assinado_em IS NOT NULL OR NEW.assinatura_tipo IS NOT NULL
       OR NEW.base_pdf_path IS NOT NULL OR NEW.entregue_em IS NOT NULL
       OR NEW.digitalizacao IS NOT NULL OR NEW.digitalizacao_status IS NOT NULL OR NEW.digitalizacao_em IS NOT NULL THEN
      RAISE EXCEPTION 'rascunho sem PDF nem assinatura (RN-141)' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('preparando', 'aguardando_assinatura') THEN
    -- "Voltar a editar" (RN-140 a): tudo do preparo volta a nulo
    IF NEW.status = 'rascunho' THEN
      IF NOT (mudou <@ ARRAY['status', 'codigo', 'declaracao_em', 'base_pdf_path', 'base_pdf_sha256', 'base_pdf_bytes', 'area_assinatura', 'pdf_status', 'pdf_pedido_em', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em'])
         OR NEW.codigo IS NOT NULL OR NEW.declaracao_em IS NOT NULL OR NEW.base_pdf_path IS NOT NULL OR NEW.base_pdf_sha256 IS NOT NULL
         OR NEW.base_pdf_bytes IS NOT NULL OR NEW.area_assinatura IS NOT NULL
         OR NEW.digitalizacao IS NOT NULL OR NEW.digitalizacao_status IS NOT NULL OR NEW.digitalizacao_em IS NOT NULL THEN
        RAISE EXCEPTION 'voltar a editar fora da regra (RN-140 a)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    -- o worker grava o PDF base uma vez e libera para assinar
    IF OLD.status = 'preparando' AND NEW.status = 'aguardando_assinatura' THEN
      IF app_current_role() IS DISTINCT FROM 'worker'
         OR NOT (mudou <@ ARRAY['status', 'pdf_status', 'base_pdf_path', 'base_pdf_sha256', 'base_pdf_bytes', 'area_assinatura'])
         OR OLD.base_pdf_path IS NOT NULL OR NEW.base_pdf_path IS NULL OR NEW.base_pdf_sha256 IS NULL OR NEW.base_pdf_bytes IS NULL THEN
        RAISE EXCEPTION 'PDF base fora da regra (RN-141)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    -- mesmo estado: só o acompanhamento do PDF; a digitalizada (fotos e trava D24) só em aguardando_assinatura
    -- (revisão T2, I1: fotos gravadas em "preparando" chegariam ao PDF de outra versão, com outro código)
    IF NEW.status = OLD.status THEN
      IF NOT (mudou <@ ARRAY['pdf_status', 'pdf_pedido_em'])
         AND NOT (OLD.status = 'aguardando_assinatura' AND mudou <@ ARRAY['pdf_status', 'pdf_pedido_em', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em']) THEN
        RAISE EXCEPTION 'conteúdo congelado desde o preparo (RN-140)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    -- a assinatura (RN-140 b; regra 9 do CLAUDE.md — desvio registrado): os ponteiros do base e das fotos FICAM; cada
    -- arquivo sai depois no SEU apagarArquivo, com o ponteiro no naMesmaTransacao (soltarArquivosDoPreparo, T5)
    IF OLD.status = 'aguardando_assinatura' AND NEW.status = 'assinado' THEN
      IF NOT (mudou <@ ARRAY['status', 'pdf_path', 'pdf_sha256', 'assinatura_tipo', 'assinatura_emissor', 'assinante_nome', 'assinado_em', 'assinado_por', 'entregue_em', 'digitalizacao_status', 'digitalizacao_em']) THEN
        RAISE EXCEPTION 'assinatura fora da regra (RN-140 b)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'transição inválida (RN-141)' USING ERRCODE = '42501';
  END IF;

  -- emitido (assinado, substituido, cancelado): os ponteiros do preparo só SAEM (base → NULL, fotos encolhem), um
  -- arquivo por vez no naMesmaTransacao do apagarArquivo dele; nunca trocam nem crescem. As fotos seguem um array
  -- (R15 do pre-flight: '["a"]' @> '"a"' é verdadeiro, então um escalar contido passaria sem o jsonb_typeof)
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
      RETURN NEW;
    END IF;
    IF NEW.status = 'substituido' AND mudou <@ ARRAY['status', 'substituido_em', 'base_pdf_path', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em'] AND NEW.substituido_em IS NOT NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'documento assinado não muda (RN-140)' USING ERRCODE = '42501';
  END IF;

  -- substituido / cancelado: só soltar o que sobrou do preparo (a conferência de "só sai" está acima)
  IF NEW.status = OLD.status AND mudou <@ ARRAY['base_pdf_path', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em'] THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'documento emitido não muda (RN-140)' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE TRIGGER documento_imutavel BEFORE UPDATE OR DELETE ON signed_documents FOR EACH ROW EXECUTE FUNCTION app_documento_imutavel();
--> statement-breakpoint
-- RN-140: as notas seguem o documento. Na cascata do rascunho apagado, a linha-mãe já não é visível (status nulo).
CREATE OR REPLACE FUNCTION app_notas_imutaveis() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d record;
BEGIN
  SELECT status, anonimizado_em INTO d FROM signed_documents WHERE id = coalesce(NEW.documento_id, OLD.documento_id);
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
    IF NEW.justificativa_uso IS NOT NULL OR NEW.motivo_cancelamento IS NOT NULL THEN
      RAISE EXCEPTION 'nota de documento anonimizado só é limpa' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF d.status = 'rascunho' THEN
    IF NEW.motivo_cancelamento IS NOT NULL THEN
      RAISE EXCEPTION 'rascunho não tem motivo de cancelamento' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- de "preparando" em diante a justificativa é fixa; o motivo entra uma vez, com o documento já cancelado (US-149)
  IF (TG_OP = 'INSERT' AND NEW.justificativa_uso IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.justificativa_uso IS DISTINCT FROM OLD.justificativa_uso)
     OR (NEW.motivo_cancelamento IS NOT NULL AND (d.status <> 'cancelado' OR (TG_OP = 'UPDATE' AND OLD.motivo_cancelamento IS NOT NULL AND NEW.motivo_cancelamento IS DISTINCT FROM OLD.motivo_cancelamento)))
     OR (TG_OP = 'UPDATE' AND OLD.motivo_cancelamento IS NOT NULL AND NEW.motivo_cancelamento IS NULL) THEN
    RAISE EXCEPTION 'nota congelada desde o preparo (RN-140)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER notas_imutaveis BEFORE INSERT OR UPDATE OR DELETE ON signed_document_notes FOR EACH ROW EXECUTE FUNCTION app_notas_imutaveis();
--> statement-breakpoint
-- RN-140 (c): a ÚNICA porta para limpar um documento emitido. Contexto worker de um tenant, paciente bloqueado (o job de
-- retenção, lgpd.ts, chama no naMesmaTransacao de apagarArquivo, um documento por vez, ANTES de anonimizar o paciente).
-- Devolve o caminho do PDF a apagar. SECURITY INVOKER: não precisa de privilégio a mais (o gatilho já exige o worker).
-- DESVIO REGISTRADO (Minors das duas revisões): a RN-140 (c) da spec v0.3 dizia SECURITY DEFINER, como a 0065; INVOKER
-- é mais estreito (roda com os privilégios do nutri_app no contexto worker) e a spec v0.3.1 passa a dizê-lo.
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
  UPDATE public.signed_document_notes SET justificativa_uso = NULL, motivo_cancelamento = NULL, updated_at = clock_timestamp() WHERE documento_id = p_documento;
  UPDATE public.document_verifications SET situacao = 'eliminado', situacao_em = clock_timestamp() WHERE documento_id = p_documento;
  DELETE FROM public.document_access_codes WHERE documento_id = p_documento;
  RETURN v_caminho;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_anonimizar_documentos(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_anonimizar_documentos(uuid) TO nutri_app_role;
--> statement-breakpoint
-- RN-158 (Minor 14 da revisão de segurança): a sessão de paciente SEM LOGIN faz UPDATE em document_access_codes
-- (app_allow_paciente_escrita, 0090). Só isto pode mudar: `tentativas` sobe de 1 em 1 (nunca volta a zero), e `usado_em`,
-- `sessao_hash` e `sessao_expira_em` saem de nulo juntos, UMA vez; o resto é fixo. Vale para todo papel.
CREATE OR REPLACE FUNCTION app_codigo_acesso_regras() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.documento_id, NEW.codigo_hash, NEW.expira_em, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.documento_id, OLD.codigo_hash, OLD.expira_em, OLD.created_at) THEN
    RAISE EXCEPTION 'coluna fixa do código do link (RN-158)' USING ERRCODE = '42501';
  END IF;
  IF NEW.tentativas < OLD.tentativas OR NEW.tentativas > OLD.tentativas + 1 THEN
    RAISE EXCEPTION 'tentativas do código só sobem (RN-158)' USING ERRCODE = '42501';
  END IF;
  IF (NEW.usado_em, NEW.sessao_hash, NEW.sessao_expira_em) IS DISTINCT FROM (OLD.usado_em, OLD.sessao_hash, OLD.sessao_expira_em)
     AND (OLD.usado_em IS NOT NULL OR OLD.sessao_hash IS NOT NULL OR NEW.usado_em IS NULL OR NEW.sessao_hash IS NULL OR NEW.sessao_expira_em IS NULL) THEN
    RAISE EXCEPTION 'a sessão do código nasce uma vez (RN-158)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER codigo_acesso_regras BEFORE UPDATE ON document_access_codes FOR EACH ROW EXECUTE FUNCTION app_codigo_acesso_regras();
