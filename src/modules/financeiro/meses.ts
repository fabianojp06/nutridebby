import { dataValida } from '@/modules/pacientes/datas';

/**
 * Calendário do Financeiro: dias 'AAAA-MM-DD' e meses 'AAAA-MM', já no fuso do consultório (RN-305/RN-306). Só aritmética
 * de calendário em UTC — nada de `Date` local, que mudaria com o fuso do servidor. Formato errado é erro de programação
 * (as rotas e o módulo validam antes): RangeError.
 */
const DIA = /^(\d{4})-(0[1-9]|1[0-2])-(\d{2})$/;
const MES = /^(\d{4})-(0[1-9]|1[0-2])$/;

const NOMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'] as const;

const p2 = (n: number) => String(n).padStart(2, '0');
const mesTexto = (ano: number, mes: number) => `${ano}-${p2(mes)}`;

function partesDoDia(dia: string): [number, number, number] {
  const m = DIA.exec(dia);
  if (!m) throw new RangeError('Dia fora do formato AAAA-MM-DD.');
  return [+m[1], +m[2], +m[3]];
}

function partesDoMes(mes: string): [number, number] {
  const m = MES.exec(mes);
  if (!m) throw new RangeError('Mês fora do formato AAAA-MM.');
  return [+m[1], +m[2]];
}

export function mesDe(dia: string): string {
  const [a, m] = partesDoDia(dia);
  return mesTexto(a, m);
}

/** Primeiro e último dia do mês (fevereiro bissexto incluído). */
export function intervaloDoMes(mes: string): { de: string; ate: string } {
  const [a, m] = partesDoMes(mes);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { de: `${mes}-01`, ate: `${mes}-${p2(ultimo)}` };
}

export function mesesDoAno(ano: number): string[] {
  return NOMES.map((_, i) => mesTexto(ano, i + 1));
}

/** Os 12 meses que terminam no mês de `hoje`, do mais antigo ao mais recente. */
export function ultimos12Meses(hoje: string): string[] {
  const [a, m] = partesDoDia(hoje);
  return Array.from({ length: 12 }, (_, i) => {
    const indice = a * 12 + (m - 1) - 11 + i;
    return mesTexto(Math.floor(indice / 12), (indice % 12) + 1);
  });
}

/** "novembro" (minúsculo, como no meio da frase: "Entradas de novembro"). */
export function nomeDoMes(mes: string): string {
  return NOMES[partesDoMes(mes)[1] - 1];
}

/** `ate` − `de`, em dias de calendário (0 no mesmo dia; negativo se `ate` vem antes). */
export function diasEntre(de: string, ate: string): number {
  const [a1, m1, d1] = partesDoDia(de);
  const [a2, m2, d2] = partesDoDia(ate);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

/** RN-321: o período do CSV dos lançamentos tem no máximo 366 dias, contando o primeiro e o último. */
export const PERIODO_MAX_DIAS = 366;

/**
 * O período do CSV (US-306): "De" e "Até" datas que existem, "De" ≤ "Até" e no máximo 366 dias. Puro: o formulário confere
 * antes de navegar e a rota confere de novo.
 */
export function periodoValido(de: string, ate: string): boolean {
  return dataValida(de) && dataValida(ate) && de <= ate && diasEntre(de, ate) + 1 <= PERIODO_MAX_DIAS;
}
