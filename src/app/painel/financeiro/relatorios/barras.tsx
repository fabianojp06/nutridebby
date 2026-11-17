import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';
import { nomeDoMes } from '@/modules/financeiro/meses';
import type { EntradasESaidasDoMes } from '@/modules/financeiro/resumo';

const C = MSG_FINANCEIRO.relatorios.colunas;
/** Largura de cada mês no desenho (duas barras e o respiro) e altura útil. */
const COLUNA = 10;
const BARRA = 3.5;
const ALTURA = 60;

/**
 * US-306: as barras de entradas e saídas dos últimos 12 meses. Só desenho (`aria-hidden`): a tabela ao lado é a
 * alternativa em texto. Cor só por classe com token (`fill-ok`, `fill-erro`), que muda com o tema — nunca `fill="#…"` em
 * atributo — e a legenda em texto ("Entradas", "Saídas"), para a cor não ser a única pista.
 */
export function Barras({ meses }: { meses: EntradasESaidasDoMes[] }) {
  const maximo = Math.max(1, ...meses.flatMap((m) => [m.entradas, m.saidas]));
  const altura = (v: number) => (v / maximo) * ALTURA;
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-x-4 text-sm">
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block size-3 rounded-sm bg-ok" />
          {C.entradas}
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block size-3 rounded-sm bg-erro" />
          {C.saidas}
        </li>
      </ul>
      <div>
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${COLUNA * meses.length} ${ALTURA}`}
          preserveAspectRatio="none"
          className="h-40 w-full"
          focusable="false"
        >
          {meses.map((m, i) => (
            <g key={m.mes}>
              <rect className="fill-ok" x={i * COLUNA + 1.25} y={ALTURA - altura(m.entradas)} width={BARRA} height={altura(m.entradas)} />
              <rect className="fill-erro" x={i * COLUNA + 1.25 + BARRA} y={ALTURA - altura(m.saidas)} width={BARRA} height={altura(m.saidas)} />
            </g>
          ))}
        </svg>
        <div aria-hidden="true" className="grid grid-cols-12 border-t border-linha pt-1 text-center text-xs text-suave">
          {meses.map((m) => (
            <span key={m.mes}>{nomeDoMes(m.mes).slice(0, 3)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
