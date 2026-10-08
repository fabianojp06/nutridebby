import Link from 'next/link';
import type { SecaoPortal } from '@/app/p/navegacao';
import { MSG_G } from './textos';

/**
 * Plano 16 (§4.2, RN-190): as seções na faixa. Colunas IGUAIS (5, ou 4 sem "Exames", RN-192), alvo de 44 px, a palavra que
 * não cabe quebra com hífen (como a barra antiga, regra ratificada pelo dono em 04/10/2026): nunca rola na horizontal. A
 * seção atual: pílula branca com o texto na cor da faixa + aria-current (o estado não depende só de cor). Sem JavaScript:
 * a página diz qual é a atual.
 */
export function NavSecoes({ secoes, atual }: { secoes: readonly SecaoPortal[]; atual: string }) {
  return (
    <nav aria-label={MSG_G.navSecoes} className="mt-3">
      <ul className={`grid gap-1 ${secoes.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>
        {secoes.map((s) => (
          <li key={s.href} className="min-w-0">
            <Link
              href={s.href}
              aria-current={s.href === atual ? 'page' : undefined}
              data-guia={s.href === '/p/perfil' ? 'secao-eu' : undefined}
              className="flex min-h-11 items-center justify-center rounded-full px-1 text-center text-sm font-bold text-white hyphens-auto wrap-break-word aria-[current=page]:bg-white aria-[current=page]:text-faixa"
            >
              {s.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
