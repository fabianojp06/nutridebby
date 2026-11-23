import Link from 'next/link';
import { MSG_MODELOS, type GrupoDeItens } from '@/modules/documentos/modelos-textos';
import { LISTA_DE_ITENS, LISTA_DE_MODELOS } from './valores';

export type SecaoDePrescricao = GrupoDeItens | 'modelos';

const SECOES: { secao: SecaoDePrescricao; href: string; rotulo: string }[] = [
  { secao: 'suplementos', href: `${LISTA_DE_ITENS}?tipo=suplementos`, rotulo: MSG_MODELOS.secoes.suplementos },
  { secao: 'fitoterapicos', href: `${LISTA_DE_ITENS}?tipo=fitoterapicos`, rotulo: MSG_MODELOS.secoes.fitoterapicos },
  { secao: 'modelos', href: LISTA_DE_MODELOS, rotulo: MSG_MODELOS.secoes.modelos },
];

/**
 * Plano 22 (T10b, spec §4.1): "Suplementos · Fitoterápicos · Modelos de prescrição", a seção atual com
 * `aria-current="page"` (e em negrito, sublinhada), no estilo de "Seções de exames" (T3). A página diz qual é a atual.
 */
export function SecoesDePrescricao({ atual }: { atual: SecaoDePrescricao }) {
  return (
    <nav aria-label="Seções de prescrição" data-guia="secoes-prescricao">
      <ul className="flex flex-wrap border-b border-borda">
        {SECOES.map((s) => {
          const ativa = s.secao === atual;
          return (
            <li key={s.secao}>
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
