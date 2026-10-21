import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Bricolage_Grotesque, Figtree } from 'next/font/google';
import './globals.css';

// D24: baixadas no build e servidas pelo próprio app — o navegador não fala com o Google (LGPD, CSP font-src 'self').
// P08-13: sem preload — no layout raiz o preload vale para todas as rotas, e o portal do paciente (/p, fontes próprias em
// src/app/p/fontes.ts) baixava ~60 KB destas duas no celular antes do primeiro quadro; fora do /p elas baixam quando a
// página as usa (swap, com a fonte de reserva ajustada pelo next/font).
const figtree = Figtree({ variable: '--font-figtree', subsets: ['latin'], display: 'swap', preload: false });
const bricolage = Bricolage_Grotesque({ variable: '--font-bricolage', subsets: ['latin'], display: 'swap', preload: false });

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
