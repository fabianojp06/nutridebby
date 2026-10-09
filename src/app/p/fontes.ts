import { Atkinson_Hyperlegible_Next, Red_Hat_Display } from 'next/font/google';

/**
 * Plano 16 (RNF-193, D9): só no portal (aplicadas em src/app/p/layout.tsx). Baixadas no build e servidas pelo próprio app —
 * o navegador não fala com o Google (CSP font-src 'self', LGPD). Subconjunto latin; títulos e números em Red Hat Display,
 * texto em Atkinson Hyperlegible Next (alta legibilidade). Orçamento: 160 KB de woff2 no primeiro carregamento
 * (e2e/fontes-portal.spec.ts); se passar, `weight: 'variable'` nas duas.
 */
export const redHat = Red_Hat_Display({ variable: '--font-redhat', subsets: ['latin'], weight: ['700', '800', '900'], display: 'swap' });
export const atkinson = Atkinson_Hyperlegible_Next({ variable: '--font-atkinson', subsets: ['latin'], weight: ['400', '700'], display: 'swap' });
