import Link from 'next/link';
import { MSG_RELATORIOS, type Secao } from '@/modules/relatorios/constantes';
import { urlDaSecao } from './url';

const ABA = 'inline-flex min-h-11 items-center whitespace-nowrap px-3';

/**
 * §4.1 (RN-480): as abas dos Relatórios, no estilo da navegação do Financeiro — links com `aria-current="page"` na atual,
 * sublinhado e negrito (não só cor). Só as seções que o acesso vê (`secoesPermitidas`), na ordem. Cada link leva o período
 * escolhido (`periodo`, nulo sem filtro ou com erro: a outra seção abre no padrão).
 */
export function AbasDosRelatorios({ atual, secoes, periodo }: { atual: Secao; secoes: Secao[]; periodo: { de: string; ate: string } | null }) {
  return (
    <nav aria-label={MSG_RELATORIOS.navAbas} data-guia="abas-relatorios">
      <ul className="flex flex-wrap border-b border-borda">
        {secoes.map((s) => (
          <li key={s}>
            <Link
              href={urlDaSecao(s, periodo ?? {})}
              aria-current={s === atual ? 'page' : undefined}
              className={`${ABA} ${s === atual ? 'border-b-2 border-marca font-semibold' : 'text-suave hover:text-texto'}`}
            >
              {MSG_RELATORIOS.abas[s]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * RN-492: "Mais consultas" e "Maior receita" como links com `aria-current` (como as abas), não `<select>`. O nome da
 * navegação é o h2 da seção ("Ranking de pacientes").
 */
export function CriterioDoRanking({ por, periodo }: { por: 'consultas' | 'receita'; periodo: { de: string; ate: string } | null }) {
  return (
    <nav aria-label={MSG_RELATORIOS.titulosDaSecao.ranking}>
      <ul className="flex flex-wrap gap-2">
        {(['consultas', 'receita'] as const).map((p) => (
          <li key={p}>
            <Link
              href={urlDaSecao('ranking', { ...(periodo ?? {}), por: p === 'receita' ? p : undefined })}
              aria-current={p === por ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-full border px-4 ${p === por ? 'border-marca font-semibold underline decoration-2 underline-offset-4' : 'border-campo text-suave hover:text-texto'}`}
            >
              {MSG_RELATORIOS.ranking.por[p]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
