import type { ReactNode } from 'react';

const NEUTRO = 'rounded-full bg-linha px-2 py-0.5 text-sm text-texto';
/** Plano 25 (§7.1): "Sinal de risco" na caixa de Mensagens — tokens de erro (os dois temas), ícone decorativo e o texto. */
const ALERTA = 'inline-flex items-center gap-1 rounded-full border border-erro bg-erro-fundo text-erro px-2 py-0.5 text-sm font-semibold';

/**
 * D24: etiqueta curta (situação, contagem). Não é o `Selo` de busca-alimento.tsx (R10). `alerta` (Plano 25): o sinal não é
 * só cor — leva o ícone (aria-hidden) e o texto.
 */
export function Selo({ children, variante = 'neutro' }: { children: ReactNode; variante?: 'neutro' | 'alerta' }) {
  if (variante === 'neutro') return <span className={NEUTRO}>{children}</span>;
  return (
    <span className={ALERTA}>
      <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 2 1.5 13.5h13L8 2z" />
        <path d="M8 6.5v3" />
        <path d="M8 11.5h.01" />
      </svg>
      {children}
    </span>
  );
}
