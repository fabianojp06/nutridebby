import { formatarDecimal } from '@/lib/numero';
import { formatarData } from '../datas';

type Props = { id: string; titulo: string; unidade: string; casas: number; pontos: { data: string; valor: number }[] };

const L = 640;
const A = 220;
const M = { esq: 56, dir: 16, topo: 16, baixo: 32 };

/**
 * Linha de uma série só (o título nomeia a série; sem legenda). SVG renderizado no servidor, sem JS:
 * linha de 2 px, marcadores de 8 px com dica nativa (<title>) e área de toque maior; grade recessiva;
 * a tabela com os mesmos dados atende leitor de tela e impressão. Cor por classe (claro/escuro).
 */
export function GraficoLinha({ id, titulo, unidade, casas, pontos }: Props) {
  if (pontos.length === 0) return null;
  const asc = [...pontos].sort((a, b) => a.data.localeCompare(b.data));
  const tempo = asc.map((p) => Date.parse(`${p.data}T00:00:00Z`));
  const t0 = Math.min(...tempo);
  const t1 = Math.max(...tempo);
  const valores = asc.map((p) => p.valor);
  let v0 = Math.min(...valores);
  let v1 = Math.max(...valores);
  const folga = v1 === v0 ? Math.max(1, Math.abs(v0) * 0.05) : (v1 - v0) * 0.1;
  v0 -= folga;
  v1 += folga;
  const x = (t: number) => (t1 === t0 ? (M.esq + L - M.dir) / 2 : M.esq + ((t - t0) / (t1 - t0)) * (L - M.esq - M.dir));
  const y = (v: number) => M.topo + (1 - (v - v0) / (v1 - v0)) * (A - M.topo - M.baixo);
  const fmt = (v: number) => `${formatarDecimal(v, casas)}${unidade ? ` ${unidade}` : ''}`;
  const marcas = [v0 + folga, (v0 + v1) / 2, v1 - folga];
  const nome = unidade ? `${titulo} (${unidade})` : titulo;
  return (
    <figure className="space-y-2 text-zinc-700 dark:text-zinc-300">
      <svg viewBox={`0 0 ${L} ${A}`} role="img" aria-labelledby={`${id}-titulo ${id}-desc`} className="h-auto w-full max-w-2xl">
        <title id={`${id}-titulo`}>{nome}</title>
        <desc id={`${id}-desc`}>{`${asc.length} registros, de ${formatarData(asc[0].data)} a ${formatarData(asc[asc.length - 1].data)}.`}</desc>
        {marcas.map((v) => (
          <g key={v}>
            <line x1={M.esq} x2={L - M.dir} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.15} />
            <text x={M.esq - 8} y={y(v) + 4} textAnchor="end" fontSize={12} fill="currentColor">{formatarDecimal(v, casas)}</text>
          </g>
        ))}
        <text x={x(t0)} y={A - 8} textAnchor="start" fontSize={12} fill="currentColor">{formatarData(asc[0].data)}</text>
        {asc.length > 1 && <text x={x(t1)} y={A - 8} textAnchor="end" fontSize={12} fill="currentColor">{formatarData(asc[asc.length - 1].data)}</text>}
        <polyline
          points={asc.map((p, i) => `${x(tempo[i])},${y(p.valor)}`).join(' ')}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          className="stroke-emerald-700 dark:stroke-emerald-400"
        />
        {asc.map((p, i) => (
          <g key={p.data + i}>
            <circle cx={x(tempo[i])} cy={y(p.valor)} r={4} strokeWidth={2} className="fill-emerald-700 stroke-white dark:fill-emerald-400 dark:stroke-zinc-900" />
            <circle cx={x(tempo[i])} cy={y(p.valor)} r={12} fill="transparent">
              <title>{`${formatarData(p.data)}: ${fmt(p.valor)}`}</title>
            </circle>
          </g>
        ))}
      </svg>
      <details>
        <summary className="cursor-pointer text-sm">Ver os dados em tabela</summary>
        <table className="mt-2 text-left text-sm">
          <caption className="sr-only">{nome}</caption>
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Valor</th>
            </tr>
          </thead>
          <tbody>
            {asc.map((p, i) => (
              <tr key={p.data + i}>
                <td>{formatarData(p.data)}</td>
                <td>{fmt(p.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
