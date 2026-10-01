import { sairAction } from '@/app/sair/actions';

const BASE = 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current';
const PADRAO = 'rounded border border-current px-3 py-1 text-sm';

/**
 * Botão "Sair" das áreas logadas: um formulário que chama `sairAction` (encerra a sessão e vai para /entrar). Funciona
 * sem JavaScript. `data-sair` deixa o editor do plano alimentar pedir confirmação quando há edição não salva
 * (`use-salvamento.ts`). `className` ajusta o visual ao lugar onde aparece; o foco visível e o cursor são sempre os mesmos.
 */
export function BotaoSair({ className = PADRAO }: { className?: string }) {
  return (
    <form action={sairAction}>
      <button type="submit" data-sair className={`${BASE} ${className}`}>
        Sair
      </button>
    </form>
  );
}
