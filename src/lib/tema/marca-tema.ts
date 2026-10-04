import { contraste, misturar } from './contraste';
import { TOKENS } from './tokens';

/**
 * D19 / §3.4: a cor do consultório sempre aceita texto branco por cima (perfilSchema: ≥ 4,5), mas como TEXTO, link ou
 * foco sobre o escuro ela reprova (#047857: 3,01). Clareia com branco em passos de 2% até passar sobre o cartão e o fundo.
 */
export function corNoEscuro(cor: string): string {
  for (let i = 0; i <= 50; i++) {
    const c = misturar(cor, '#ffffff', i / 50);
    if (contraste(c, TOKENS.cartao[1]) >= 4.5 && contraste(c, TOKENS.fundo[1]) >= 4.5) return c;
  }
  return '#ffffff';
}

/** Caixas dentro do cartão de destaque: sobreposição escura (a clara derrubava o branco para 3,6 com cores no limite). */
export const CINZA_SOBRE_DESTAQUE = 'rgb(0 0 0 / 0.15)';
