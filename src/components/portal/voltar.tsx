import Link from 'next/link';

/**
 * Plano 16 (§4.2, Desvio 13): "Voltar" das telas de detalhe — 44 × 44 px, nome acessível "Voltar para {destino}". Link
 * simples, de servidor, sem history.back(): o nome acessível diz exatamente para onde o toque leva. Com history.back(), as
 * telas que mudam a URL (filtros e busca de Conteúdos, `?dias=` da Lista de compras, `?semana=` de Agendar, o redirect da
 * consulta remarcada) e o histórico de outro site ou do /entrar levariam a outro lugar, e a tela de detalhe não tem a nav
 * "Seções" para sair da cadeia. O "voltar" do navegador e o gesto do aparelho continuam voltando pelo histórico.
 */
export function Voltar({ href, rotulo }: { href: string; rotulo: string }) {
  return (
    <Link
      href={href}
      aria-label={rotulo}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </Link>
  );
}
