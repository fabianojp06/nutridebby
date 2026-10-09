'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { classeDoItem } from '@/app/painel/navegacao';
import { ABAS_DO_ADMIN, abaAtual } from './navegacao';

/** P16-17: a aba atual é pílula, sublinhada e em negrito, com aria-current (o mesmo item do menu do painel, WCAG 1.4.1). */
export function AbasDoAdmin() {
  const atual = abaAtual(usePathname());
  return (
    <nav aria-label="Administração">
      <ul className="flex flex-wrap gap-1">
        {ABAS_DO_ADMIN.map((a) => (
          <li key={a.href}>
            <Link href={a.href} aria-current={atual === a.href ? 'page' : undefined} className={classeDoItem(atual === a.href)}>
              {a.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
