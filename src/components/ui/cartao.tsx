import type { HTMLAttributes, ReactNode } from 'react';

type Props = { id: string; titulo: string; children?: ReactNode; acao?: ReactNode; className?: string; destaque?: boolean; tituloFocavel?: boolean } & Omit<HTMLAttributes<HTMLElement>, 'title' | 'id' | 'className' | 'children'>;

/**
 * D24: o cartão do Bento (raio 24). `destaque`: fundo na cor do consultório, todo texto branco (≥ 4,5 garantido), e
 * `data-sobre-marca` no contêiner para o foco ficar branco ali (T12: na cor da marca ele some sobre a própria cor).
 * `resto`: data-guia (manual). `tituloFocavel`: o título recebe o foco por script (tabIndex -1), depois de apagar um item da seção.
 */
export function Cartao({ id, titulo, children, acao, className = '', destaque = false, tituloFocavel = false, ...resto }: Props) {
  return (
    <section
      {...resto}
      aria-labelledby={id}
      data-sobre-marca={destaque ? '' : undefined}
      className={`rounded-3xl border p-5 ${destaque ? 'border-transparent bg-destaque text-white' : 'border-borda bg-cartao text-texto'} ${className}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 id={id} tabIndex={tituloFocavel ? -1 : undefined} className="font-titulo text-lg font-semibold">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}
