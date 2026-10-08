import { MSG_DIARIO } from '@/modules/portal/diario-constantes';

/** Plano 16 (G-D5 ★ = c, RN-198): o aviso "Desfazer" fica 10 s antes de enviar. Com (a), 0 (envia no toque). */
// `: number`: com o tipo literal, o `PRAZO_DESFAZER_MS === 0` do componente não compila (TS2367)
export const PRAZO_DESFAZER_MS: number = 10_000;

export const MSG_COMI_ASSIM = { desfazer: 'Desfazer', desfeito: 'Registro desfeito.', semConexao: 'Sem conexão. Registre quando voltar.', podeDesfazer: 'Para desfazer, use o botão Desfazer logo abaixo.' } as const;

export type FaseComiAssim = 'pronto' | 'aguardando' | 'enviando' | 'feito' | 'desfeito' | 'erro';

/** O que sobra do prazo depois de `decorridoMs` (a pausa da WCAG 2.2.1 guarda isto). */
export const sobra = (restanteMs: number, decorridoMs: number): number => Math.max(0, restanteMs - decorridoMs);

/** O texto da região viva (role="status", sempre montada — molde de privacidade.tsx). O erro vai num role="alert" à parte. */
export function mensagemDaFase(f: FaseComiAssim): string {
  if (f === 'aguardando' || f === 'enviando' || f === 'feito') return MSG_DIARIO.registrado;
  if (f === 'desfeito') return MSG_COMI_ASSIM.desfeito;
  return '';
}

/** O botão "Comi assim" some depois da resposta (RN-197) e volta no "Desfazer" ou no erro. */
export const mostraBotao = (f: FaseComiAssim): boolean => f === 'pronto' || f === 'desfeito' || f === 'erro';

/**
 * Revisão da T11: o foco vai ao "Desfazer" (e o prazo pausa, WCAG 2.2.1) só quando a ativação veio do teclado ou do leitor
 * de tela — `detail` 0 (clique sem ponteiro) ou o botão com `:focus-visible`. No Chrome, o toque e o clique do mouse já dão
 * o foco ao botão no pointerdown: medir o `activeElement` levava o foco ao "Desfazer" em todo toque, e o prazo nunca corria.
 */
export const focoVaiAoDesfazer = (detail: number, focoVisivel: boolean): boolean => detail === 0 || focoVisivel;

/**
 * RN-198 ("fechar a tela nesse prazo envia"): no celular, ir à tela inicial ou trocar de app só dispara o `visibilitychange`
 * (o `pagehide` pode não vir antes de o sistema descartar a aba). A página escondida envia o que está pendente.
 */
export const saiuDaTela = (estado: DocumentVisibilityState): boolean => estado === 'hidden';
