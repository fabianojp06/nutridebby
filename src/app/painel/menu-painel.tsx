'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MSG_MENSAGENS } from '@/modules/mensagens/constantes';
import { useContadorDeMensagens } from './contador-de-mensagens';
import { classeDoItem, ITEM_EXAMES, ITEM_MENSAGENS, itemAtual, itensDoMenu, rotuloDoItem } from './navegacao';

export type ItemComContador = { mostrar: boolean; pendentes: number };
const NENHUM: ItemComContador = { mostrar: false, pendentes: 0 };

/**
 * D20: o item ativo é pílula na cor do consultório, sublinhado e em negrito (forma + cor + aria-current, WCAG 1.4.1).
 * `exames` (Plano 12) e `mensagens` (Plano 25): o item aparece com `mostrar` e leva o número dos pendentes no rótulo. O de
 * "Mensagens" (conversas com mensagem do paciente não lida + dúvidas abertas da IA Nutri) também é atualizado pela consulta
 * de 60 s (RN-459) e, com número, ganha o `aria-label` "Mensagens, {n} não lidas".
 */
export function MenuPainel({ exames = NENHUM, mensagens = NENHUM }: { exames?: ItemComContador; mensagens?: ItemComContador }) {
  const atual = itemAtual(usePathname());
  const naoLidas = useContadorDeMensagens(mensagens);
  const contador: Record<string, number> = { [ITEM_EXAMES.href]: exames.pendentes, [ITEM_MENSAGENS.href]: naoLidas };
  return (
    <nav aria-label="Menu do painel" data-guia="menu">
      <ul className="flex flex-wrap gap-1">
        {itensDoMenu({ exames: exames.mostrar, mensagens: mensagens.mostrar }).map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={atual === i.href ? 'page' : undefined}
              aria-label={i.href === ITEM_MENSAGENS.href && naoLidas > 0 ? MSG_MENSAGENS.menu.aria(naoLidas) : undefined}
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
