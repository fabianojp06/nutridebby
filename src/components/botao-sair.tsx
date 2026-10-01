const BASE = 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current';
const PADRAO = 'rounded border border-current px-3 py-1 text-sm';

/**
 * Botão "Sair" das áreas logadas: `<form method="post" action="/sair">`, que o Route Handler `src/app/sair/route.ts`
 * trata (apaga a sessão e o cookie e vai para /entrar). Navegação de página inteira, que funciona sem JavaScript e
 * também quando outra aba já saiu. `data-sair` deixa o editor do plano alimentar enviar a edição pendente (ou pedir
 * confirmação) antes de sair (`use-salvamento.ts`). `className` ajusta o visual ao lugar onde aparece; o foco visível e
 * o cursor são sempre os mesmos.
 */
export function BotaoSair({ className = PADRAO }: { className?: string }) {
  return (
    <form method="post" action="/sair">
      <button type="submit" data-sair className={`${BASE} ${className}`}>
        Sair
      </button>
    </form>
  );
}
