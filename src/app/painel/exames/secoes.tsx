'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MSG_EXAMES } from '@/modules/exames/constantes';

const SECOES = [
  { href: '/painel/exames/catalogo', rotulo: MSG_EXAMES.catalogo.secaoCatalogo },
  { href: '/painel/exames/modelos', rotulo: MSG_EXAMES.catalogo.secaoModelos },
] as const;

/** Plano 22 (T3, spec §4.1): "Catálogo · Modelos de solicitação", a seção atual com `aria-current="page"` (e em negrito, sublinhada). */
export function SecoesDeExames() {
  const atual = usePathname();
  return (
    <nav aria-label="Seções de exames" data-guia="secoes-exames">
      <ul className="flex flex-wrap border-b border-borda">
        {SECOES.map((s) => {
          const ativa = atual === s.href || atual.startsWith(`${s.href}/`);
          return (
            <li key={s.href}>
              <Link href={s.href} aria-current={ativa ? 'page' : undefined} className={`inline-flex min-h-11 items-center px-3 focus-visible:outline-offset-[-3px] ${ativa ? 'border-b-2 border-marca font-semibold' : 'text-suave'}`}>
                {s.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
