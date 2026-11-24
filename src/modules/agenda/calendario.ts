import { somarAnos } from '@/modules/pacientes/datas';
import { ANOS_FUTUROS_AGENDA, diaDaSemana, segundaDaSemana, somarDias } from './fuso';
import { minutosDe } from './horarios';

/**
 * Plano 23 (AG-D14, RN-411 a RN-414): calendário da agenda, puro. Datas 'AAAA-MM-DD' já no fuso do consultório (quem chama
 * usa `hojeNoFuso`/`dataDaAgendaOuHoje`); só aritmética de calendário em UTC, nada de `Date` local. Os helpers de fuso ficam
 * em `fuso.ts`, que este plano não edita (C-402).
 */
export type Visao = 'dia' | 'semana' | 'mes' | 'lista';

/** RN-411: `dia`, `semana`, `mes`, `lista`; qualquer outro valor (inclusive `string[]`) vira `semana`. */
export const lerVisao = (v: unknown): Visao => (v === 'dia' || v === 'mes' || v === 'lista' ? v : 'semana');

const p2 = (n: number) => String(n).padStart(2, '0');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'] as const;

/** "novembro de 2026" (caption do Mês e título da impressão). */
export function nomeDoMesDoAno(data: string): string {
  return `${MESES[Number(data.slice(5, 7)) - 1]} de ${data.slice(0, 4)}`;
}

/** Os 7 dias da semana de `data`, de segunda a domingo. */
export function semanaDe(data: string): string[] {
  const s = segundaDaSemana(data);
  return Array.from({ length: 7 }, (_, i) => somarDias(s, i));
}

const primeiroDoMes = (data: string) => `${data.slice(0, 8)}01`;
const ultimoDoMes = (data: string) => {
  const [a, m] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};
const mesVizinho = (data: string, n: number) => {
  const [a, m] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
};
const diasEntre = (de: string, ate: string): string[] => {
  const r: string[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) r.push(d);
  return r;
};

/**
 * RN-413: a grade do Mês de `data`, em semanas inteiras de segunda a domingo — da semana do dia 1º à do último dia (4 a 6
 * semanas: fevereiro de 2027 começa numa segunda e cabe em 4). Os dias de fora do mês completam a primeira e a última semana.
 */
export function gradeDoMes(data: string): string[][] {
  const fim = ultimoDoMes(data);
  const semanas: string[][] = [];
  for (let s = segundaDaSemana(primeiroDoMes(data)); s <= fim; s = somarDias(s, 7)) semanas.push(semanaDe(s));
  return semanas;
}

/**
 * Os dias da visão (`de` e `ate` inclusive) e para onde vão "Anterior" e "Próximo" (RN-411). Dia: 1 dia. Semana: segunda a
 * domingo. Mês: só os dias do mês (a grade completa as semanas com dias vazios). Lista: 30 dias a partir da data; com o
 * filtro de paciente, 12 meses a partir da data (ao abrir, hoje: as mesmas consultas futuras que a seção "Consultas" da ficha
 * conta) e "Anterior"/"Próximo" andam 12 meses. "Próximo" nunca passa do teto das datas da agenda (hoje + 5 anos,
 * `dataDaAgendaOuHoje`): passaria, e a página voltaria para hoje.
 */
export function periodoDaVisao(
  v: Visao,
  data: string,
  o: { comPaciente: boolean; hoje: string },
): { dias: string[]; de: string; ate: string; anterior: string; proximo: string } {
  const teto = somarAnos(o.hoje, ANOS_FUTUROS_AGENDA);
  const limitar = (d: string) => (d > teto ? teto : d);
  const com = (de: string, ate: string, anterior: string, proximo: string) => ({ dias: diasEntre(de, ate), de, ate, anterior, proximo: limitar(proximo) });
  if (v === 'dia') return com(data, data, somarDias(data, -1), somarDias(data, 1));
  if (v === 'semana') {
    const s = segundaDaSemana(data);
    return com(s, somarDias(s, 6), somarDias(s, -7), somarDias(s, 7));
  }
  if (v === 'mes') return com(primeiroDoMes(data), ultimoDoMes(data), mesVizinho(data, -1), mesVizinho(data, 1));
  if (o.comPaciente) return com(data, somarDias(somarAnos(data, 1), -1), somarAnos(data, -1), somarAnos(data, 1));
  return com(data, somarDias(data, 29), somarDias(data, -30), somarDias(data, 30));
}

/**
 * RN-412: faixa de horas da grade (horas cheias, `ate` exclusivo). O menor início e o maior fim das regras dos dias da visão,
 * arredondados para fora; sem regra, 8h às 18h; um item fora da faixa amplia (`fimMin` ≤ `inicioMin` = passa da
 * meia-noite, vai até 24h); "Mostrar 24 horas", 0h às 24h.
 */
export function faixaDaGrade(
  regras: { inicio: string; fim: string; diaSemana: number }[],
  dias: string[],
  itens: { inicioMin: number; fimMin: number }[],
  horas24: boolean,
): { de: number; ate: number } {
  if (horas24) return { de: 0, ate: 24 };
  const semana = new Set(dias.map(diaDaSemana));
  const doPeriodo = regras.filter((r) => semana.has(r.diaSemana));
  let de = doPeriodo.length ? Math.min(...doPeriodo.map((r) => Math.floor(minutosDe(r.inicio) / 60))) : 8;
  let ate = doPeriodo.length ? Math.max(...doPeriodo.map((r) => Math.ceil(minutosDe(r.fim) / 60))) : 18;
  for (const i of itens) {
    de = Math.min(de, Math.floor(i.inicioMin / 60));
    ate = Math.max(ate, i.fimMin <= i.inicioMin ? 24 : Math.ceil(i.fimMin / 60));
  }
  return { de, ate: Math.min(ate, 24) };
}

const bissexto = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;

/** RN-414: o dia do aniversário em `ano` ('AAAA-MM-DD'); 29/02 vira 28/02 em ano não bissexto. */
export function diaDoAniversario(nascimento: string, ano: number): string {
  const md = nascimento.slice(5, 10);
  return md === '02-29' && !bissexto(ano) ? `${ano}-02-28` : `${ano}-${md}`;
}

/** "08:40" a partir de minutos desde 00:00 (24:00 no fim do dia). */
export const hhmmDe = (min: number) => `${p2(Math.floor(min / 60))}:${p2(min % 60)}`;
