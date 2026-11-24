import { nomeDoMes } from '@/modules/financeiro/meses';

/** Altura útil e largura de cada mês no desenho (as barras da série lado a lado e o respiro). */
const ALTURA = 60;
const COLUNA = 10;

export type Serie = { rotulo: string; /** classe de preenchimento com token (`fill-ok`) */ fill: string; /** a mesma cor na legenda (`bg-ok`) */ bg: string; valores: number[] };

/**
 * Plano 26 (§7.1, RNF-481): as barras por mês da Agenda e do Financeiro. Só desenho (`aria-hidden`): a tabela logo abaixo
 * é a alternativa em texto. Cor só por classe com token, que muda com o tema — nunca `fill="#…"` —, e a legenda em texto,
 * para a cor não ser a única pista. Fora da impressão (`print:hidden`): o papel leva só as tabelas (RN-495).
 */
export function BarrasPorMes({ meses, series }: { meses: string[]; series: Serie[] }) {
  const maximo = Math.max(1, ...series.flatMap((s) => s.valores));
  const largura = (COLUNA - 2.5) / series.length;
  const altura = (v: number) => (Math.max(0, v) / maximo) * ALTURA;
  return (
    <div aria-hidden="true" className="space-y-2 print:hidden">
      <ul className="flex flex-wrap gap-x-4 text-sm">
        {series.map((s) => (
          <li key={s.rotulo} className="flex items-center gap-2">
            <span className={`inline-block size-3 rounded-sm ${s.bg}`} />
            {s.rotulo}
          </li>
        ))}
      </ul>
      <div>
        <svg aria-hidden="true" viewBox={`0 0 ${COLUNA * meses.length} ${ALTURA}`} preserveAspectRatio="none" className="h-40 w-full" focusable="false">
          {meses.map((m, i) => (
            <g key={m}>
              {series.map((s, j) => (
                <rect key={s.rotulo} className={s.fill} x={i * COLUNA + 1.25 + j * largura} y={ALTURA - altura(s.valores[i] ?? 0)} width={largura} height={altura(s.valores[i] ?? 0)} />
              ))}
            </g>
          ))}
        </svg>
        <div className="flex border-t border-linha pt-1 text-center text-xs text-suave">
          {meses.map((m) => (
            <span key={m} className="flex-1">
              {nomeDoMes(m).slice(0, 3)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
