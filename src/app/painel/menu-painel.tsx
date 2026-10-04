'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { classeDoItem, ITENS_DO_MENU, itemAtual } from './navegacao';

/** D20: o item ativo é pílula na cor do consultório, sublinhado e em negrito (forma + cor + aria-current, WCAG 1.4.1). */
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
              className={classeDoItem(atual === i.href)}
            >
              {i.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
