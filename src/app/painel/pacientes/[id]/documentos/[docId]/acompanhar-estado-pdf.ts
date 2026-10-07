import { CONSULTA_AUTOMATICA } from '@/lib/consulta-automatica';
import { DIGITALIZACAO_MAX_MS } from '@/modules/documentos/constantes';

export const POLL_ESTADO_PDF_MS = 3000;
/**
 * P12-14 (revisão): o "Preparando o PDF…" e o "Montando o PDF digitalizado…" param de consultar depois de 1 h — o prazo em
 * que o pedido não pode mais estar em andamento (a varredura do worker marca "falhou" o PDF e a digitalizada pendentes
 * há mais de 1 h, PDF_DOCUMENTO_PENDENTE_MAX_MS e DIGITALIZACAO_MAX_MS). Antes, com o worker parado, a tela consultava
 * para sempre.
 */
export const ACOMPANHAR_PDF_MAX_MS = DIGITALIZACAO_MAX_MS;

type Estado = { status: string; pdfStatus: string | null; digitalizacaoStatus: string | null };

/** O que a tela espera mudar: o PDF sai de "preparando" (ou falha), ou a digitalizada deixa de estar em curso. */
export function mudou(e: Estado, esperando: 'pdf' | 'digitalizacao'): boolean {
  return esperando === 'pdf'
    ? e.status !== 'preparando' || e.pdfStatus === 'falhou' || e.pdfStatus === 'sem_cota'
    : e.status !== 'aguardando_assinatura' || !['recebendo', 'pendente'].includes(e.digitalizacaoStatus ?? '');
}

/**
 * Consulta o estado do documento a cada 3 s (sem auditoria e sem contar como uso da sessão: CONSULTA_AUTOMATICA), uma de
 * cada vez, até mudar (chama `aoMudar` uma vez e para) ou até ACOMPANHAR_PDF_MAX_MS. Devolve a função que para.
 */
export function acompanharEstadoPdf(
  docId: string,
  esperando: 'pdf' | 'digitalizacao',
  aoMudar: () => void,
  buscar: typeof fetch = fetch,
  agora: () => number = Date.now,
): () => void {
  const fim = agora() + ACOMPANHAR_PDF_MAX_MS;
  let ativo = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const agendar = () => {
    if (ativo && agora() + POLL_ESTADO_PDF_MS <= fim) timer = setTimeout(consultar, POLL_ESTADO_PDF_MS);
  };
  const consultar = async () => {
    try {
      const r = await buscar(`/api/painel/documentos/${docId}/pdf?estado=1`, CONSULTA_AUTOMATICA);
      if (ativo && r.ok && mudou((await r.json()) as Estado, esperando) && ativo) {
        ativo = false;
        aoMudar();
        return;
      }
    } catch {
      // sem rede: tenta na próxima vez
    }
    agendar();
  };
  agendar();
  return () => {
    ativo = false;
    clearTimeout(timer);
  };
}
