import { getDb, type Db } from '@/db/client';
import type { AnthropometryRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { arredondar, formatarDecimal } from '@/lib/numero';
import { CIRCUNFERENCIAS, listarAntropometrias } from './antropometria';
import { marcadoresDoPaciente, type SerieMarcador } from './exames';

export const MSG_POUCOS_DADOS = 'Registre mais uma avaliação para ver a evolução';

export type Ponto = { data: string; valor: number };
export type SerieEvolucao = { id: string; rotulo: string; unidade: string; casas: number; pontos: Ponto[] };
export type Diferenca = { rotulo: string; primeiro: Ponto; ultimo: Ponto; texto: string };

/** Uma série por medida, só com as datas em que ela foi medida; série sem ponto some. */
export function seriesDasAvaliacoes(avaliacoes: AnthropometryRow[]): SerieEvolucao[] {
  const asc = [...avaliacoes].sort((a, b) => a.data.localeCompare(b.data) || a.createdAt.getTime() - b.createdAt.getTime());
  const serie = (id: string, rotulo: string, unidade: string, casas: number, valor: (a: AnthropometryRow) => number | null | undefined): SerieEvolucao => ({
    id,
    rotulo,
    unidade,
    casas,
    pontos: asc.flatMap((a) => {
      const v = valor(a);
      return typeof v === 'number' ? [{ data: a.data, valor: v }] : [];
    }),
  });
  return [
    serie('peso', 'Peso', 'kg', 1, (a) => a.pesoKg),
    serie('imc', 'IMC', '', 2, (a) => a.imc),
    serie('perc_gordura', '% de gordura', '%', 2, (a) => a.percGordura),
    ...CIRCUNFERENCIAS.map((c) => serie(`circ_${c.id}`, c.rotulo, 'cm', 1, (a) => a.circunferencias[c.id])),
  ].filter((s) => s.pontos.length > 0);
}

/** Casas para exibir um marcador de exame: o maior número de decimais digitado nos pontos, com teto de 3 (a aba Exames mostra o valor exato). */
export function casasDoMarcador(pontos: Ponto[]): number {
  return Math.min(3, Math.max(0, ...pontos.map((p) => (String(p.valor).split('.')[1] ?? '').length)));
}

/** US-017: "−3,2 kg" (sinal de menos tipográfico), "+1,0 kg", "0,0 kg". */
export function formatarDiferenca(v: number, casas: number, unidade: string): string {
  // arredonda o módulo e aplica o sinal depois: `arredondar` leva meios negativos para +∞ (−2,5 → −2), o que assimetriza.
  const r = arredondar(Math.abs(v), casas);
  const sinal = r === 0 ? '' : v < 0 ? '−' : '+';
  return `${sinal}${formatarDecimal(r, casas)}${unidade ? ` ${unidade}` : ''}`;
}

/** Primeiro × último registro de cada série com 2 pontos ou mais. */
export function diferencas(series: SerieEvolucao[]): Diferenca[] {
  return series
    .filter((s) => s.pontos.length >= 2)
    .map((s) => {
      const primeiro = s.pontos[0];
      const ultimo = s.pontos[s.pontos.length - 1];
      return { rotulo: s.rotulo, primeiro, ultimo, texto: formatarDiferenca(ultimo.valor - primeiro.valor, s.casas, s.unidade) };
    });
}

/** Tudo o que a aba Evolução mostra. As leituras (antropometria, exames) são auditadas pelos serviços de origem. */
export async function evolucaoDoPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()) {
  const [avaliacoes, marcadores] = await Promise.all([listarAntropometrias(ctx, patientId, db), marcadoresDoPaciente(ctx, patientId, db)]);
  const series = seriesDasAvaliacoes(avaliacoes);
  return { avaliacoes: avaliacoes.length, series, diferencas: diferencas(series), marcadores: marcadores as SerieMarcador[] };
}
