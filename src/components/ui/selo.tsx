import type { ReactNode } from 'react';

/** D24: etiqueta curta (situação, contagem). Não é o `Selo` de busca-alimento.tsx (R10). */
export function Selo({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-linha px-2 py-0.5 text-sm text-texto">{children}</span>;
}
