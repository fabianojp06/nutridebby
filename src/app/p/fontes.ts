import localFont from 'next/font/local';

/**
 * Plano 16 (RNF-193, D9): só no portal (aplicadas em src/app/p/layout.tsx). Servidas pelo próprio app (SUS-106: os woff2
 * versionados em src/fontes/, LEIAME.md; cada uma é um arquivo variável só do subconjunto latin) —
 * o navegador não fala com o Google (CSP font-src 'self', LGPD). Subconjunto latin; títulos e números em Red Hat Display,
 * texto em Atkinson Hyperlegible Next (alta legibilidade). Orçamento: 160 KB de woff2 no primeiro carregamento
 * (e2e/fontes-portal.spec.ts); os dois arquivos somam 64 KB.
 */
export const redHat = localFont({ src: '../../fontes/red-hat-display-latin.woff2', weight: '700 900', variable: '--font-redhat', display: 'swap' });
export const atkinson = localFont({ src: '../../fontes/atkinson-hyperlegible-next-latin.woff2', weight: '400 700', variable: '--font-atkinson', display: 'swap' });
