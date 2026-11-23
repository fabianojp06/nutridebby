import localFont from 'next/font/local';

/**
 * Plano 16 (RNF-193, D9): só no portal (aplicadas em src/app/p/layout.tsx). Servidas pelo próprio app (SUS-106: os woff2
 * versionados em src/fontes/, LEIAME.md; cada uma é um arquivo variável só do subconjunto latin) —
 * o navegador não fala com o Google (CSP font-src 'self', LGPD). Subconjunto latin; títulos e números em Red Hat Display,
 * texto em Atkinson Hyperlegible Next (alta legibilidade). Orçamento: 160 KB de woff2 no primeiro carregamento
 * (e2e/fontes-portal.spec.ts); os dois arquivos somam 64 KB.
 */
export const redHat = localFont({ src: '../../fontes/red-hat-display-latin.woff2', weight: '700 900', variable: '--font-redhat', display: 'swap' });
// Duas faces fixas (400 e 700) do mesmo arquivo variável, baixado uma vez: como no next/font/google (weight ['400', '700']),
// font-medium (500) cai no 400 e font-semibold (600) no 700 — uma faixa '400 700' daria 500 e 600 de verdade e mudaria o
// peso de botões e rótulos do portal (revisão do SUS-106). A Red Hat fica na faixa: 700–900 já se comporta como as faces
// 700/800/900 de antes (abaixo de 700 cai no 700).
export const atkinson = localFont({
  src: [
    { path: '../../fontes/atkinson-hyperlegible-next-latin.woff2', weight: '400' },
    { path: '../../fontes/atkinson-hyperlegible-next-latin.woff2', weight: '700' },
  ],
  variable: '--font-atkinson',
  display: 'swap',
});
