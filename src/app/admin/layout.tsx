import { BotaoSair } from '@/components/botao-sair';
import { VigiaDeSessao } from '@/components/vigia-sessao';
import { AbasDoAdmin } from './abas';

/**
 * Cabeçalho comum das páginas da administração (visual V2, P16-17): o nome, as abas "Contas", "Servidor" e "Segurança" e o
 * botão "Sair". O admin não tem tema (sempre os tokens claros do :root). Não decide acesso: cada página continua chamando
 * `requireUser(['admin'], …)` (§4.1). O contêiner é bloco (como no painel): o `<main className="mx-auto max-w-*">` das
 * telas fica com a largura toda.
 */
export default function AdminLayout({ children }: LayoutProps<'/admin'>) {
  return (
    <div className="min-h-dvh bg-fundo font-sans text-texto">
      <header className="border-b border-borda bg-cartao">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 md:px-6">
          <p className="font-titulo text-lg font-semibold">NutriDebby · Administração</p>
          <AbasDoAdmin />
          <div className="ml-auto">
            <BotaoSair className="inline-flex min-h-11 items-center rounded-full border border-campo px-4" />
          </div>
        </div>
      </header>
      {children}
      {/* P12-14: aviso de inatividade e saída automática (30 min sem uso, 8 h de limite) */}
      <VigiaDeSessao />
    </div>
  );
}
