'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';

const S = MSG_FINANCEIRO.secoes;
const BASE = '/painel/financeiro';
const SECOES = [
  { href: BASE, rotulo: S.resumo },
  { href: `${BASE}/lancamentos`, rotulo: S.lancamentos },
  { href: `${BASE}/pendencias`, rotulo: S.pendentes },
  { href: `${BASE}/relatorios`, rotulo: S.relatorios },
  { href: `${BASE}/configuracoes`, rotulo: S.configuracoes },
] as const;

/** O Resumo só na própria rota; as outras seções também nas subpáginas (novo lançamento, pendências de um paciente). */
const atual = (caminho: string, href: string) => (href === BASE ? caminho === BASE : caminho === href || caminho.startsWith(`${href}/`));

/**
 * §4.1: abaixo do h1, as seções do Financeiro no estilo das abas do prontuário (sublinhado e negrito na atual, não só cor).
 * Cinco itens: quebram linha abaixo de 768 px em vez de rolar.
 */
export function SecoesDoFinanceiro() {
  const caminho = usePathname() ?? '';
  return (
    <nav aria-label="Seções do Financeiro" data-guia="financeiro-secoes">
      <ul className="flex flex-wrap border-b border-borda">
        {SECOES.map((s) => {
          const ativa = atual(caminho, s.href);
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={ativa ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center whitespace-nowrap px-3 ${ativa ? 'border-b-2 border-marca font-semibold' : 'text-suave hover:text-texto'}`}
              >
                {s.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
