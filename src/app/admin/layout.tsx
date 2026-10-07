import { BotaoSair } from '@/components/botao-sair';
import { VigiaDeSessao } from '@/components/vigia-sessao';

/**
 * Cabeçalho comum das páginas da administração, com o botão "Sair". Não decide acesso: cada página continua
 * chamando `requireUser(['admin'], …)` (§4.1).
 */
export default function AdminLayout({ children }: LayoutProps<'/admin'>) {
  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <p className="font-semibold">NutriDebby · Administração</p>
          <BotaoSair />
        </div>
      </header>
      {children}
      {/* P12-14: aviso de inatividade e saída automática (30 min sem uso, 8 h de limite) */}
      <VigiaDeSessao />
    </>
  );
}
