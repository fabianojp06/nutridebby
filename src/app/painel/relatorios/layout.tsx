/**
 * Plano 26 (§4.1): o contêiner das telas dos Relatórios (e da impressão), com a largura das telas do Financeiro. O título,
 * as abas e o período ficam em cada página (`telaDosRelatorios`). O layout não é barreira: cada página chama requireNutri.
 */
export default function RelatoriosLayout({ children }: LayoutProps<'/painel/relatorios'>) {
  return <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6 print:max-w-none print:p-0">{children}</main>;
}
