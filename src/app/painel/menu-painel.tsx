'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ITENS_DO_MENU, itemAtual } from './navegacao';

/** D20: o item ativo é pílula na cor do consultório (forma + cor + aria-current, WCAG 1.4.1). */
export function MenuPainel() {
  const atual = itemAtual(usePathname());
  return (
    <nav aria-label="Menu do painel" data-guia="menu">
      <ul className="flex flex-wrap gap-1">
        {ITENS_DO_MENU.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={atual === i.href ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-full px-4 font-medium ${atual === i.href ? 'bg-destaque text-white' : 'text-suave hover:bg-linha hover:text-texto'}`}
            >
              {i.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
