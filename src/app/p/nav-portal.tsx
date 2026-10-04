'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ITENS_DO_PORTAL, itemAtual } from './navegacao';

/**
 * D23: barra de abas do portal, no rodapé. R16 / D3 (Plano 07): grade de 7 colunas (Início, Plano, Diário, Conteúdos,
 * Evolução, Agenda, Perfil) com texto pequeno, para caber em 360 px sem rolagem horizontal; cada link mantém o alvo de
 * toque de 44 px. As colunas seguem o texto (no mínimo 44 px): em 7 colunas iguais (51 px em 360 px) "Conteúdos"
 * (58 px) invadia "Diário" e "Evolução".
 */
export function NavPortal() {
  const atual = itemAtual(usePathname());
  return (
    <nav aria-label="Portal" className="sticky bottom-0 border-t bg-white">
      <ul className="grid grid-cols-[repeat(7,minmax(2.75rem,auto))]">
        {ITENS_DO_PORTAL.map((i) => (
          <li key={i.href} className="min-w-0">
            <Link
              href={i.href}
              aria-current={atual === i.href ? 'page' : undefined}
              className="flex min-h-11 flex-col items-center justify-center px-0.5 text-center text-xs wrap-break-word aria-[current=page]:font-semibold aria-[current=page]:underline"
            >
              {i.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
