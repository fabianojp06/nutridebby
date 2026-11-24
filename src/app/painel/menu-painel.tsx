'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { classeDoItem, ITEM_DUVIDAS, ITEM_EXAMES, itemAtual, itensDoMenu, rotuloDoItem } from './navegacao';

export type ItemComContador = { mostrar: boolean; pendentes: number };
const NENHUM: ItemComContador = { mostrar: false, pendentes: 0 };

/**
 * D20: o item ativo é pílula na cor do consultório, sublinhado e em negrito (forma + cor + aria-current, WCAG 1.4.1).
 * `exames` (Plano 12) e `duvidas` (Plano 15): o item aparece com `mostrar` e leva o número dos pendentes no rótulo.
 * `papel` e `financeiro` (Plano 26, RN-514): o menu da recepção (`itensDoMenu`).
 */
export function MenuPainel({ exames = NENHUM, duvidas = NENHUM, papel = 'nutri', financeiro = false }: { exames?: ItemComContador; duvidas?: ItemComContador; papel?: 'nutri' | 'recepcao'; financeiro?: boolean }) {
  const atual = itemAtual(usePathname());
  const contador: Record<string, number> = { [ITEM_EXAMES.href]: exames.pendentes, [ITEM_DUVIDAS.href]: duvidas.pendentes };
  return (
    <nav aria-label="Menu do painel" data-guia="menu">
      <ul className="flex flex-wrap gap-1">
        {itensDoMenu({ exames: exames.mostrar, duvidas: duvidas.mostrar, papel, financeiro }).map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={atual === i.href ? 'page' : undefined}
              className={classeDoItem(atual === i.href)}
            >
              {rotuloDoItem(i.rotulo, contador[i.href] ?? 0)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
