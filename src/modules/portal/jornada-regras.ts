import { arredondar, casasDecimais, formatarDecimal } from '@/lib/numero';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { CIRCUNFERENCIAS } from '@/modules/pacientes/antropometria-constantes';
import { formatarDiferenca, type Ponto, type SerieEvolucao } from '@/modules/pacientes/evolucao';
import { dataPorExtenso, mesPorExtenso, quandoRelativo, quandoRelativoComFuso } from './datas-portal';

/**
 * Plano 16 (§4.5, US-194): a Jornada e a mini-jornada da faixa. Puro, mas SÓ SERVIDOR (importa pacientes/evolucao, que
 * importa o banco): os componentes de cliente recebem as strings prontas. RN-206: a variação é número com sinal, sem cor,
 * elogio ou meta. RN-203: com o peso oculto, quem chama já não leu peso nem IMC (pesoKg/imc nulos, pesos vazios) e a
 * Jornada fica sem gráfico de medida corporal em destaque (G-D16 a).
 */
export const MSG_JORNADA = {
  titulo: 'Sua jornada',
  desde: (mes: string) => `Sua jornada desde ${mes}`,
  comeca: 'Sua jornada começa na primeira consulta.',
  orientacao: 'Orientação da sua nutricionista',
  primeira: 'primeira consulta',
  proxima: 'próxima consulta',
  medidasDe: (data: string) => `Medidas de ${data}`,
  todasAsMedidas: 'Todas as medidas',
  minhasConsultas: 'Minhas consultas',
  agendar: 'Agendar consulta',
  verConsulta: 'Ver a consulta',
  pesoNasConsultas: 'Peso nas consultas',
  cinturaNasConsultas: 'Cintura nas consultas',
  semMarco: 'Nenhuma consulta marcada.',
  proximoMarco: (quando: string) => `Próximo marco: consulta ${quando}`,
  semMudanca: (mes: string) => `Sem mudança de peso desde ${mes}`,
  variacao: (diferenca: string, mes: string) => `${diferenca} desde ${mes}`,
  consultas: (n: number, mes: string) => `${n} ${n === 1 ? 'consulta' : 'consultas'} desde ${mes}`,
  modalidade: { online: 'Online.', presencial: 'Presencial.' },
} as const;

export type AvaliacaoDaJornada = { id: string; data: string; consultationId: string | null; pesoKg: number | null; imc: number | null; percGordura: number | null; circunferencias: Record<string, number> };
export type AtendimentoDaJornada = { id: string; data: string; orientacao: string | null };
export type ProximaConsulta = { id: string; inicio: Date; modalidade: 'presencial' | 'online' };
export type Medida = { id: string; texto: string };
type Quando = { semFuso: string; comFuso: string };
export type Marco =
  | { tipo: 'proxima'; consultaId: string; quando: Quando; modalidade: string }
  | { tipo: 'atendimento'; data: string; titulo: string; primeira: boolean; medidas: Medida[]; orientacao: string | null }
  | { tipo: 'medidas'; data: string; titulo: string; medidas: Medida[] };
export type Jornada = { titulo: string; grafico: SerieEvolucao | null; marcos: Marco[]; vazia: boolean; podeAgendar: boolean };
export type EntradaDaJornada = {
  atendimentos: readonly AtendimentoDaJornada[];
  avaliacoes: readonly AvaliacaoDaJornada[];
  proxima: ProximaConsulta | null;
  podeAgendar: boolean;
  percGordura: boolean;
  /** "Não mostrar peso no app" (RN-203): sem gráfico de medida corporal em destaque, nem o de cintura (G-D16 a). */
  pesoOculto: boolean;
};
export type MiniJornada = { linha1: string; linha2: Quando; complemento: string | null; pontos: number[]; podeAgendar: boolean };
export type EntradaDaMini = { pesos: readonly Ponto[]; atendimentos: number; primeiroAtendimento: string | null; proxima: { inicio: Date } | null; podeAgendar: boolean };

/** "78,6", "86", "27,2": as casas que a medida tem. */
const g = (n: number) => formatarDecimal(n, casasDecimais(n));

/** P06 D14: peso, IMC, % de gordura (só com a opção do consultório) e circunferências; nunca dobras nem densidade. */
export function medidasDaAvaliacao(a: AvaliacaoDaJornada, o: { percGordura: boolean }): Medida[] {
  const m: Medida[] = [];
  if (a.pesoKg !== null) m.push({ id: 'peso', texto: `${g(a.pesoKg)} kg` });
  if (a.imc !== null) m.push({ id: 'imc', texto: `IMC ${g(a.imc)}` });
  if (o.percGordura && a.percGordura !== null) m.push({ id: 'perc_gordura', texto: `% de gordura ${g(a.percGordura)}` });
  for (const c of CIRCUNFERENCIAS) {
    const v = a.circunferencias[c.id];
    if (typeof v === 'number') m.push({ id: `circ_${c.id}`, texto: `${c.rotulo.toLocaleLowerCase('pt-BR')} ${g(v)} cm` });
  }
  return m;
}

export function montarJornada(e: EntradaDaJornada, agora: Date, fuso: string): Jornada {
  const hoje = partesNoFuso(agora, fuso).data;
  const atendimentosAsc = [...e.atendimentos].sort((a, b) => a.data.localeCompare(b.data));
  const primeira = atendimentosAsc[0]?.id ?? null;
  const ids = new Set(e.atendimentos.map((a) => a.id));
  const porAtendimento = new Map(e.avaliacoes.flatMap((a) => (a.consultationId && ids.has(a.consultationId) ? [[a.consultationId, a] as const] : [])));
  const passados: Exclude<Marco, { tipo: 'proxima' }>[] = [
    ...e.atendimentos.map((a) => {
      const avaliacao = porAtendimento.get(a.id);
      return { tipo: 'atendimento' as const, data: a.data, titulo: dataPorExtenso(a.data, hoje), primeira: a.id === primeira, medidas: avaliacao ? medidasDaAvaliacao(avaliacao, e) : [], orientacao: a.orientacao };
    }),
    // avaliação sem atendimento (ou de atendimento que o paciente não vê) vira um marco próprio
    ...e.avaliacoes
      .filter((a) => !a.consultationId || !ids.has(a.consultationId))
      .map((a) => ({ tipo: 'medidas' as const, data: a.data, titulo: MSG_JORNADA.medidasDe(dataPorExtenso(a.data, hoje)), medidas: medidasDaAvaliacao(a, e) })),
  ].sort((a, b) => b.data.localeCompare(a.data));
  const proxima: Marco[] = e.proxima
    ? [{ tipo: 'proxima', consultaId: e.proxima.id, quando: { semFuso: quandoRelativo(e.proxima.inicio, agora, fuso), comFuso: quandoRelativoComFuso(e.proxima.inicio, agora, fuso) }, modalidade: MSG_JORNADA.modalidade[e.proxima.modalidade] }]
    : [];
  const asc = [...e.avaliacoes].sort((a, b) => a.data.localeCompare(b.data));
  const pontos = (valor: (a: AvaliacaoDaJornada) => number | null | undefined): Ponto[] =>
    asc.flatMap((a) => {
      const v = valor(a);
      return typeof v === 'number' ? [{ data: a.data, valor: v }] : [];
    });
  const pesos = pontos((a) => a.pesoKg);
  const cinturas = pontos((a) => a.circunferencias.cintura);
  // §4.5: com o peso visível e menos de 2 pesos, a cintura assume o gráfico; com o peso oculto, nenhum (G-D16 a)
  const grafico: SerieEvolucao | null =
    pesos.length >= 2
      ? { id: 'peso', rotulo: MSG_JORNADA.pesoNasConsultas, unidade: 'kg', casas: 1, pontos: pesos }
      : !e.pesoOculto && cinturas.length >= 2
        ? { id: 'circ_cintura', rotulo: MSG_JORNADA.cinturaNasConsultas, unidade: 'cm', casas: 1, pontos: cinturas }
        : null;
  return {
    titulo: atendimentosAsc[0] ? MSG_JORNADA.desde(mesPorExtenso(atendimentosAsc[0].data, hoje)) : MSG_JORNADA.titulo,
    grafico,
    marcos: [...proxima, ...passados],
    vazia: proxima.length + passados.length === 0,
    podeAgendar: e.podeAgendar,
  };
}

/** RN-202: a mini-jornada da faixa de Hoje. O gráfico pequeno (pontos) é decorativo; o complemento (último peso) vai só ao leitor de tela, DENTRO do texto do link (sem aria-label: WCAG 2.5.3, Rótulo no nome). */
export function miniJornada(e: EntradaDaMini, agora: Date, fuso: string): MiniJornada {
  const hoje = partesNoFuso(agora, fuso).data;
  let linha1: string = MSG_JORNADA.comeca;
  let complemento: string | null = null;
  if (e.pesos.length >= 2) {
    const [primeiro, ultimo] = [e.pesos[0], e.pesos[e.pesos.length - 1]];
    const mes = mesPorExtenso(primeiro.data, hoje);
    const diferenca = ultimo.valor - primeiro.valor;
    const modulo = arredondar(Math.abs(diferenca), 1);
    linha1 = modulo === 0 ? MSG_JORNADA.semMudanca(mes) : MSG_JORNADA.variacao(formatarDiferenca(diferenca, 1, 'kg'), mes);
    complemento = `${g(ultimo.valor)} kg na última consulta`;
  } else if (e.atendimentos > 0 && e.primeiroAtendimento) {
    linha1 = MSG_JORNADA.consultas(e.atendimentos, mesPorExtenso(e.primeiroAtendimento, hoje));
  }
  const quando = e.proxima ? { semFuso: quandoRelativo(e.proxima.inicio, agora, fuso), comFuso: quandoRelativoComFuso(e.proxima.inicio, agora, fuso) } : null;
  return {
    linha1,
    linha2: quando ? { semFuso: MSG_JORNADA.proximoMarco(quando.semFuso), comFuso: MSG_JORNADA.proximoMarco(quando.comFuso) } : { semFuso: MSG_JORNADA.semMarco, comFuso: MSG_JORNADA.semMarco },
    complemento,
    pontos: e.pesos.length >= 2 ? e.pesos.map((p) => p.valor) : [],
    podeAgendar: e.podeAgendar,
  };
}
