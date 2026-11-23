import type { TipoDocumento } from '@/modules/documentos/constantes';

/**
 * Plano 22 (US-380, RN-396, EP-D24/EP-D25): as decisões puras do "Compartilhar" do PDF assinado (sem DOM, sem import do
 * servidor; o componente é `compartilhar-pdf.tsx`). A página do servidor importa daqui o `nomeDoPdf` (de um módulo
 * 'use client' ela só receberia uma referência do cliente).
 */
export type FaseCompartilhar = 'inicial' | 'preparando' | 'pronto' | 'baixado' | 'venceu' | 'recusa' | 'falha';

/** A rota do link (`/api/documento/{token}/pdf`); a do portal é `/api/p/documentos/{id}/pdf`. */
const doLink = (url: string) => url.startsWith('/api/documento/');

/**
 * O que a resposta da rota de sempre quer dizer. Só um PDF serve (`application/pdf`); a rota do link responde 303 para a
 * página do link quando a sessão de 15 min venceu — o `fetch` segue o redirecionamento e chega o HTML da página
 * (ou, com `redirect: 'manual'`, o 303/opaqueredirect): "O acesso venceu". No portal, o 401/403 é a recusa de sempre
 * (`recusaDoPortal`: sessão expirada, termo, vínculo); qualquer outra coisa, "Não foi possível preparar o PDF".
 */
export function faseDaResposta(r: { ok: boolean; status: number; contentType: string | null }, url: string): 'pronto' | 'venceu' | 'recusa' | 'falha' {
  const tipo = (r.contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (r.ok && tipo === 'application/pdf') return 'pronto';
  if (doLink(url) && (r.status === 303 || r.status === 0 || (r.ok && tipo === 'text/html'))) return 'venceu';
  if (!doLink(url) && (r.status === 401 || r.status === 403)) return 'recusa';
  return 'falha';
}

type NavegadorQueCompartilha = { share?: unknown; canShare?: (dados: { files: File[] }) => boolean };

/** Pelo compartilhar do aparelho só quando ele aceita o arquivo (`canShare({ files })`); senão, o download. */
export function jeitoDeEntregar(nav: NavegadorQueCompartilha, files: File[]): 'compartilhar' | 'baixar' {
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return 'baixar';
  try {
    return nav.canShare({ files }) ? 'compartilhar' : 'baixar';
  } catch {
    return 'baixar';
  }
}

/** Fechar a folha sem escolher (`AbortError`) não é erro; o resto é "Não foi possível preparar o PDF". */
export const erroDoCompartilhar = (e: unknown): 'falha' | null =>
  e && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError' ? null : 'falha';

const NOME_DO_ARQUIVO: Record<TipoDocumento, string> = {
  receita: 'receita',
  parecer: 'parecer-nutricional',
  solicitacao_exames: 'solicitacao-de-exames',
};

/** O nome do arquivo que o paciente manda ou baixa: o tipo e a data (dd/mm/aaaa), nada do paciente. */
export const nomeDoPdf = (tipo: TipoDocumento, data: string): string => `${NOME_DO_ARQUIVO[tipo]}-${data.replaceAll('/', '-')}.pdf`;
