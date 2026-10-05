-- Plano 10A, code review do PR #19 (itens 5 e 6). Custom (regra 2 do CLAUDE.md): não edita as migrations 0089/0091.
-- O Plano 10B renumera as migrations dele a partir da 0094. Rodar com DATABASE_URL_MIGRATOR (regra 7). Sem migração de
-- dados: signed_documents só existe neste branch (a validação do CHECK lê a tabela uma vez); o gatilho de auditoria (regra
-- 8, 0090) não muda.

-- 1. Item 5: o LIKE '<tenant>/documento_%' aceitava o base e as fotos como PDF assinado (e o "_" é coringa do LIKE).
-- Prefixo exato com starts_with (sem coringa nem escape): o base na pasta dele, o assinado só em documento_assinado/.
ALTER TABLE "signed_documents" DROP CONSTRAINT "signed_documents_arquivos_do_tenant";--> statement-breakpoint
ALTER TABLE "signed_documents" ADD CONSTRAINT "signed_documents_arquivos_do_tenant" CHECK (("signed_documents"."base_pdf_path" is null or starts_with("signed_documents"."base_pdf_path", "signed_documents"."tenant_id"::text || '/documento_base/')) and ("signed_documents"."pdf_path" is null or starts_with("signed_documents"."pdf_path", "signed_documents"."tenant_id"::text || '/documento_assinado/')));
--> statement-breakpoint
-- 2. app_documento_imutavel (0091) com: item 6 — o rascunho não carrega quem assinou, o emissor, o nome do assinante, o
-- cancelamento nem a substituição, e rascunho → preparando exige declaracao_em e pdf_status 'pendente'; item 5 — a ida a
-- "assinado" confere o TIPO do stored_files do PDF (documento_assinado, mesmo tenant e paciente). O resto é o da 0091.
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
    -- 0093 (code review do PR #19, item 6): nem quem assinou, o emissor, o nome do assinante, o cancelamento ou a substituição
    IF NEW.pdf_path IS NOT NULL OR NEW.pdf_sha256 IS NOT NULL OR NEW.assinado_em IS NOT NULL OR NEW.assinatura_tipo IS NOT NULL
       OR NEW.assinado_por IS NOT NULL OR NEW.assinatura_emissor IS NOT NULL OR NEW.assinante_nome IS NOT NULL
       OR NEW.cancelado_em IS NOT NULL OR NEW.substituido_em IS NOT NULL
       OR NEW.base_pdf_path IS NOT NULL OR NEW.entregue_em IS NOT NULL
       OR NEW.digitalizacao IS NOT NULL OR NEW.digitalizacao_status IS NOT NULL OR NEW.digitalizacao_em IS NOT NULL THEN
      RAISE EXCEPTION 'rascunho sem PDF nem assinatura (RN-141)' USING ERRCODE = '42501';
    END IF;
    -- 0093 (item 6): o preparo (US-143) nasce com a declaração (D5) e o PDF pedido ao worker
    IF NEW.status = 'preparando' AND (NEW.declaracao_em IS NULL OR NEW.pdf_status IS DISTINCT FROM 'pendente') THEN
      RAISE EXCEPTION 'preparo fora da regra (RN-141): declaração e PDF pendente' USING ERRCODE = '42501';
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
      -- 0093 (code review do PR #19, item 5): o PDF assinado é um arquivo do tipo documento_assinado deste paciente (o CHECK
      -- só olha a pasta do caminho); um base ou uma foto gravados com outro caminho não viram "o PDF assinado"
      IF NOT EXISTS (SELECT 1 FROM stored_files f
                      WHERE f.caminho = NEW.pdf_path AND f.tenant_id = NEW.tenant_id AND f.patient_id = NEW.patient_id AND f.tipo = 'documento_assinado') THEN
        RAISE EXCEPTION 'PDF assinado fora da regra (RN-140 b): arquivo de outro tipo' USING ERRCODE = '42501';
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
