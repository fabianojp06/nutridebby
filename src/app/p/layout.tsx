import { BotaoSair } from '@/components/botao-sair';
import { SwProvider } from './sw-provider';

/** Todas as páginas do portal do paciente (inclusive as dos próximos planos) ganham o botão "Sair". */
export default function PacienteLayout({ children }: { children: React.ReactNode }) {
  return (
    <SwProvider>
      <header className="flex justify-end px-6 pt-4">
        <BotaoSair />
      </header>
      {children}
    </SwProvider>
  );
}
