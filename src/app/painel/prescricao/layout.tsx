import Link from 'next/link';
import { MSG_MODELOS } from '@/modules/documentos/modelos-textos';

/**
 * Plano 22 (T10b, spec §4.1): "Prescrição" do hub Configurações — os itens salvos e os modelos de prescrição. O layout não
 * lê nada nem protege nada: **cada página** chama `acessoComDocumentos` (sem `documentos_liberados`, `notFound()`), e cada
 * Server Action também (o `notFound()` de um layout não protege as actions). A navegação "Seções de prescrição" fica em
 * cada página (`SecoesDePrescricao`), porque a seção atual depende do `?tipo=` e, na tela do item, do tipo do item.
 */
export default function PrescricaoLayout({ children }: LayoutProps<'/painel/prescricao'>) {
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <p className="text-sm">
        <Link href="/painel/configuracoes" className="text-link underline">
          {MSG_MODELOS.voltar}
        </Link>
      </p>
      {children}
    </main>
  );
}
