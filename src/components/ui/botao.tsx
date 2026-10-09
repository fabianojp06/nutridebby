import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps } from 'react';

const ESTILO = {
  primario: 'bg-destaque text-white hover:brightness-95',
  secundario: 'border border-campo bg-cartao text-texto hover:bg-linha',
  escuro: 'bg-botao text-botao-texto hover:opacity-90',
} as const;
type Variante = keyof typeof ESTILO;
const BASE = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 font-semibold disabled:opacity-60';

/** As classes do `Botao` para quem desenha o próprio botão (o `ConfirmarBotao` do admin, P16-17). */
export const classeDoBotao = (variante: Variante = 'primario') => `${BASE} ${ESTILO[variante]}`;

/** D24: botão de alvo de 44 px (WCAG 2.5.8). Primário na cor do consultório (texto branco, ≥ 4,5 garantido pelo perfil). */
export function Botao({ variante = 'primario', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  return <button className={`${classeDoBotao(variante)} ${className}`} {...props} />;
}

/** O mesmo visual num link (navegação, não ação). */
export function BotaoLink({ variante = 'primario', className = '', ...props }: ComponentProps<typeof Link> & { variante?: Variante }) {
  return <Link className={`${classeDoBotao(variante)} ${className}`} {...props} />;
}
