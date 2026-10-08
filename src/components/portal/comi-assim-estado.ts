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
