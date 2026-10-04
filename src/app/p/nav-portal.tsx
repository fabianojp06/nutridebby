'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ITENS_DO_PORTAL, itemAtual } from './navegacao';

/**
 * D23: barra de abas do portal, no rodapé. R16 / D3 (Plano 07, ratificado pelo dono em 04/10/2026): 7 colunas IGUAIS
 * (Início, Plano, Diário, Conteúdos, Evolução, Agenda, Perfil), texto pequeno, e a palavra que não cabe na coluna quebra
 * com hífen (`hyphens-auto`, pelo `lang="pt-BR"` do <html>; sem dicionário no navegador, `wrap-break-word` quebra sem
 * hífen) — a barra nunca rola na horizontal, em nenhuma largura. Cada link mantém o alvo de toque de 44 px de altura.
 */
export function NavPortal() {
  const atual = itemAtual(usePathname());
  return (
    <nav aria-label="Portal" className="sticky bottom-0 border-t border-borda bg-cartao">
      <ul className="grid grid-cols-7">
        {ITENS_DO_PORTAL.map((i) => (
          <li key={i.href} className="min-w-0">
            <Link
              href={i.href}
              aria-current={atual === i.href ? 'page' : undefined}
              className="flex min-h-11 flex-col items-center justify-center px-0.5 text-center text-xs hyphens-auto wrap-break-word aria-[current=page]:font-semibold aria-[current=page]:text-marca aria-[current=page]:underline"
            >
              {i.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
