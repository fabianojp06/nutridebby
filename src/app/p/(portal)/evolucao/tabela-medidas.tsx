import { formatarDecimal } from '@/lib/numero';
import { formatarData } from '@/modules/pacientes/datas';
import type { Diferenca, SerieEvolucao } from '@/modules/pacientes/evolucao';

/**
 * Plano 16 (US-194 "Todas as medidas", molde F-Medidas): uma coluna por avaliação, uma linha por medida e a coluna
 * "Desde {mês}" com a diferença (número com sinal, RN-206). Tabela de dados: rola dentro da própria região, focável pelo
 * teclado (WCAG 1.4.10 admite rolagem em tabela; a página nunca rola na horizontal); th com scope. Células com padding
 * (o preflight do Tailwind zera o de th/td), datas e números sem quebra, algarismos tabulares e alinhados à direita (com o cabeçalho das colunas).
 */
export function TabelaMedidas({ series, diferencas, desde }: { series: SerieEvolucao[]; diferencas: Diferenca[]; desde: string }) {
  const datas = [...new Set(series.flatMap((s) => s.pontos.map((p) => p.data)))].sort();
  return (
    <div role="region" aria-labelledby="tabela-medidas" tabIndex={0} className="overflow-x-auto p-2 focus-visible:outline-offset-[-3px]">
      <table className="min-w-full text-left text-sm tabular-nums [&_th]:px-2 [&_td]:px-2 [&_th]:py-2 [&_td]:py-2 [&_thead_th]:whitespace-nowrap [&_td]:whitespace-nowrap [&_td]:text-right [&_thead_th+th]:text-right">
        <caption id="tabela-medidas" className="pb-2 text-left font-semibold">Medidas por avaliação</caption>
        <thead>
          <tr>
            <th scope="col">Medida</th>
            {datas.map((d) => <th scope="col" key={d}>{formatarData(d)}</th>)}
            <th scope="col">{`Desde ${desde}`}</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s) => {
            const dif = diferencas.find((d) => d.rotulo === s.rotulo);
            return (
              <tr key={s.id} className="border-t border-linha">
                <th scope="row">{s.unidade ? `${s.rotulo} (${s.unidade})` : s.rotulo}</th>
                {datas.map((d) => {
                  const p = s.pontos.find((x) => x.data === d);
                  return <td key={d}>{p ? formatarDecimal(p.valor, s.casas) : '—'}</td>;
                })}
                <td>{dif?.texto ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
