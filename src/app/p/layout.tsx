import type { Metadata, Viewport } from 'next';
import { SairPortal } from './sair-portal';
import { SwProvider } from './sw-provider';

// US-040: o iPhone usa o `apple-touch-icon` e não lê os ícones do manifest
export const metadata: Metadata = {
  appleWebApp: { capable: true, title: 'NutriDebby', statusBarStyle: 'default' },
  icons: { apple: '/icones/apple-touch-icon.png' },
};
export const viewport: Viewport = { themeColor: '#1d6b5a' };

/** Todas as páginas do portal do paciente (inclusive as dos próximos planos) ganham o botão "Sair", que limpa o aparelho. */
export default function PacienteLayout({ children }: { children: React.ReactNode }) {
  return (
    <SwProvider>
      <header className="flex justify-end px-6 pt-4">
        <SairPortal />
      </header>
      {children}
    </SwProvider>
  );
}
