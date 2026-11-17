import Link from 'next/link';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { SecoesDeExames } from './secoes';

/**
 * Plano 22 (T3, spec §4.1): "Exames" do hub Configurações — o catálogo e os modelos de solicitação, com a navegação
 * interna "Seções de exames" (`aria-current`, no estilo das abas do prontuário). Cada página tem o próprio h1 e confere a
 * sessão (`requireNutri`); o layout não lê nada.
 */
export default function ExamesLayout({ children }: LayoutProps<'/painel/exames'>) {
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <p className="text-sm">
        <Link href="/painel/configuracoes" className="text-link underline">{MSG_EXAMES.catalogo.voltar}</Link>
      </p>
      <SecoesDeExames />
      {children}
    </main>
  );
}
