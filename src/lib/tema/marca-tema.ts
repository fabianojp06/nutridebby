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

/** Plano 16 (§4.7): o verde claro do portal (token p-clara, claro) e a opacidade do cartão translúcido da mini-jornada na faixa. */
export const VERDE_CLARO_PORTAL = '#e2efe9';
export const OPACIDADE_CARTAO_FAIXA = 0.16;

/**
 * Plano 16 (RN-207, G-D7 ★ = a): a cor da faixa do portal. A cor do consultório já tem ≥ 4,5:1 com o branco (perfilSchema),
 * mas na faixa o texto branco também fica sobre o cartão translúcido (verde claro a 16%), que clareia o fundo — com a cor no
 * limite (#767676) cai para 3,52:1. Escurece com preto em passos de 2% até o branco passar nos dois; a cor padrão não muda.
 * Só a faixa e os cabeçalhos do portal usam (--nd-faixa); botões e links continuam com a cor do consultório.
 */
export function corDaFaixa(cor: string): string {
  for (let i = 0; i <= 50; i++) {
    const c = misturar(cor, '#000000', i / 50);
    if (contraste('#ffffff', c) >= 4.5 && contraste('#ffffff', misturar(c, VERDE_CLARO_PORTAL, OPACIDADE_CARTAO_FAIXA)) >= 4.5) return c;
  }
  return '#000000';
}
