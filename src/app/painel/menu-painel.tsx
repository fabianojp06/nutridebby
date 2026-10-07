'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { classeDoItem, ITEM_EXAMES, itemAtual, itensDoMenu, rotuloDoItem } from './navegacao';

/** D20: o item ativo é pílula na cor do consultório, sublinhado e em negrito (forma + cor + aria-current, WCAG 1.4.1). */
export function MenuPainel({ exames = { mostrar: false, pendentes: 0 } }: { exames?: { mostrar: boolean; pendentes: number } }) {
  const atual = itemAtual(usePathname());
  return (
    <nav aria-label="Menu do painel" data-guia="menu">
      <ul className="flex flex-wrap gap-1">
        {itensDoMenu({ exames: exames.mostrar }).map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={atual === i.href ? 'page' : undefined}
              className={classeDoItem(atual === i.href)}
            >
              {i.href === ITEM_EXAMES.href ? rotuloDoItem(i.rotulo, exames.pendentes) : i.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
