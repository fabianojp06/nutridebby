import { diaCurto, diaDaSemana, partesNoFuso, rotuloDoFuso, somarDias } from '@/modules/agenda/fuso';

/** Plano 16 (RN-217): datas por extenso curtas do portal, no fuso do tenant. Puro (servidor e cliente). */
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const partes = (data: string) => data.split('-').map(Number) as [number, number, number];

/** "Quinta, 8 out" — a data da faixa de Hoje. */
export function dataDaFaixa(data: string): string {
  const [, m, d] = partes(data);
  return `${DIAS[diaDaSemana(data)]}, ${d} ${MESES[m - 1].slice(0, 3)}`;
}

/** "Ontem" ou "Ter, 6 out" — o separador de dia em "Dias anteriores" (RN-195). */
export function separadorDoDia(data: string, hoje: string): string {
  if (data === somarDias(hoje, -1)) return 'Ontem';
  const [, m, d] = partes(data);
  return `${DIAS_CURTOS[diaDaSemana(data)]}, ${d} ${MESES[m - 1].slice(0, 3)}`;
}

/** "22 de setembro" (com " de 2025" quando o ano não é o de hoje) — a data de um atendimento na Jornada. */
export function dataPorExtenso(data: string, hoje: string): string {
  const [a, m, d] = partes(data);
  return `${d} de ${MESES[m - 1]}${a === partes(hoje)[0] ? '' : ` de ${a}`}`;
}

/** "março" (ou "março de 2025") — o mês de "desde {mês}" (Desvio 7). */
export function mesPorExtenso(data: string, hoje: string): string {
  const [a, m] = partes(data);
  return `${MESES[m - 1]}${a === partes(hoje)[0] ? '' : ` de ${a}`}`;
}

/** "hoje, 17:00", "amanhã, 14:00" ou "sex., 16/10, 14:00" — consulta no mural e na faixa, no fuso do tenant. */
export function quandoRelativo(inicio: Date, agora: Date, fuso: string): string {
  const i = partesNoFuso(inicio, fuso);
  const hoje = partesNoFuso(agora, fuso).data;
  if (i.data === hoje) return `hoje, ${i.hora}`;
  if (i.data === somarDias(hoje, 1)) return `amanhã, ${i.hora}`;
  return `${diaCurto(i.data)}, ${i.hora}`;
}

/** RN-06: com a sigla do fuso, para o aparelho que está noutro fuso (QuandoLocal escolhe). */
export function quandoRelativoComFuso(inicio: Date, agora: Date, fuso: string): string {
  return `${quandoRelativo(inicio, agora, fuso)} (${rotuloDoFuso(fuso)})`;
}

/** A hora de um item do mural, com e sem a sigla do fuso (QuandoLocal escolhe no aparelho). */
export function horaComFuso(instante: Date, fuso: string): { semFuso: string; comFuso: string } {
  const hora = partesNoFuso(instante, fuso).hora;
  return { semFuso: hora, comFuso: `${hora} (${rotuloDoFuso(fuso)})` };
}

/** "daqui a 1 h 25 min" — a próxima refeição na sanfona do Plano. */
export function daquiA(minutos: number): string {
  if (minutos <= 0) return 'agora';
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `daqui a ${[h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ')}`;
}
