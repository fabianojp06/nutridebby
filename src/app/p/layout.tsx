import type { Metadata, Viewport } from 'next';
import { atkinson, redHat } from './fontes';
import { SwProvider } from './sw-provider';

// US-040: o iPhone usa o `apple-touch-icon` e não lê os ícones do manifest
export const metadata: Metadata = {
  appleWebApp: { capable: true, title: 'NutriDebby', statusBarStyle: 'default' },
  icons: { apple: '/icones/apple-touch-icon.png' },
};
export const viewport: Viewport = {
  // D18: barra do sistema na cor do tema do aparelho (RNF-194: sem mudança)
  themeColor: [{ media: '(prefers-color-scheme: dark)', color: '#0f1613' }, { color: '#1d6b5a' }],
};

/**
 * Todas as páginas do portal do paciente. Plano 16: fontes e tokens do layout G (data-app="paciente", só aqui — o painel
 * não muda) e o "Sair" no fim de "Eu" (RN-211); as páginas fora do layout do portal (escolher, sem-acesso, termo) têm o
 * CabecalhoSair. D18: o tema segue o aparelho.
 */
export default function PacienteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-tema="sistema" data-app="paciente" className={`${redHat.variable} ${atkinson.variable} flex min-h-dvh flex-col bg-fundo font-portal text-texto`}>
      <SwProvider>{children}</SwProvider>
    </div>
  );
}
