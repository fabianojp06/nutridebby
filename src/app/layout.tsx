import type { Metadata } from 'next';
import { connection } from 'next/server';
import localFont from 'next/font/local';
import './globals.css';

// D24: servidas pelo próprio app — o navegador não fala com o Google (LGPD, CSP font-src 'self'). SUS-106: os woff2 ficam no
// repositório (src/fontes/, LEIAME.md), em vez de baixados do Google Fonts no build, que derrubava o CI.
// P08-13: sem preload — no layout raiz o preload vale para todas as rotas, e o portal do paciente (/p, fontes próprias em
// src/app/p/fontes.ts) baixava ~60 KB destas duas no celular antes do primeiro quadro. O painel e o admin as declaram de
// novo com preload (src/app/fontes-painel.ts); nas outras páginas elas baixam quando a página as usa (swap).
const figtree = localFont({ src: '../fontes/figtree-latin.woff2', weight: '300 900', variable: '--font-figtree', display: 'swap', preload: false });
const bricolage = localFont({ src: '../fontes/bricolage-grotesque-latin.woff2', weight: '200 800', variable: '--font-bricolage', display: 'swap', preload: false });

export const metadata: Metadata = {
  title: 'NutriDebby',
  description: 'NutriDebby',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  await connection(); // D7: CSP com nonce exige render por requisição em todas as páginas
  return (
    <html lang="pt-BR" className={`${figtree.variable} ${bricolage.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
