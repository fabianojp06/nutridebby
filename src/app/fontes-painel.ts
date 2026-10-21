import { Bricolage_Grotesque, Figtree } from 'next/font/google';

/**
 * P08-13: as fontes do painel com preload, só nos layouts do painel e do admin (o next/font pré-carrega nas rotas do layout
 * que as declara). O layout raiz declara as mesmas sem preload, para o portal do paciente (/p, fontes próprias em
 * src/app/p/fontes.ts) não baixá-las antes do primeiro quadro. O build gera duas cópias de cada woff2 (com e sem preload,
 * URLs diferentes): no painel vale a desta declaração porque o CSS do layout do painel vem depois do da raiz (a última
 * `@font-face` com a mesma família); quem abre outra página que use as fontes e depois o painel baixa as duas de novo, uma
 * vez. D24: baixadas no build e servidas pelo próprio app (LGPD, CSP font-src 'self').
 */
const figtree = Figtree({ variable: '--font-figtree', subsets: ['latin'], display: 'swap' });
const bricolage = Bricolage_Grotesque({ variable: '--font-bricolage', subsets: ['latin'], display: 'swap' });

/** As variáveis `--font-figtree` e `--font-bricolage` (globals.css: font-sans, font-titulo) no contêiner do layout. */
export const FONTES_DO_PAINEL = `${figtree.variable} ${bricolage.variable}`;
