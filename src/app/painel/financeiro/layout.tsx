/**
 * Plano 20 (§4.1, §7): o contêiner das telas do Financeiro, com a largura da tela da consulta. O título (h1), a navegação
 * interna e a região de mensagens ficam em cada página, pelo `TopoDoFinanceiro`: o h1 de algumas telas depende do que a
 * página carrega ("Entrada — {categoria}", "Pagamentos pendentes de {nome}"), e um layout não recebe dados da página. O
 * layout não é barreira: cada página chama requireNutri.
 */
export default function FinanceiroLayout({ children }: LayoutProps<'/painel/financeiro'>) {
  return <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">{children}</main>;
}
