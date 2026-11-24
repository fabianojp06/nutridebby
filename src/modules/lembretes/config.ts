/**
 * Plano 17 (§5.1, §5.2): tipos e validação da configuração dos lembretes de rotina. Puro (sem banco): o painel valida
 * antes de salvar, e o worker revalida cada linha (`validarConfig`, sem o texto, que ele nem lê) antes de `planoDoDia`.
 */
import { semInvalidosNoBanco } from '@/lib/texto-seguro';
import { HORA_HHMM, minutosDe } from '@/modules/agenda/horarios';
import { ANTECEDENCIAS, DIARIO_DEPOIS, INTERVALOS_AGUA, JANELA_FIM_MIN, JANELA_INICIO_MIN, MAX_HORARIOS, MSG_LEMBRETES as M, TEXTO_MAX } from './constantes';

export type DiaDaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = domingo
export type ConfigAgua = { inicio: string; fim: string; intervaloMin: 60 | 90 | 120 | 180 | 240; dias: DiaDaSemana[] };
export type ConfigRefeicoes = { antecedenciaMin: 0 | 15 | 30; diarioDepoisMin: 30 | 60 | null };
export type ConfigHorarios = { horarios: string[]; dias: DiaDaSemana[] }; // suplemento e livre
export type LembreteNovo =
  | { tipo: 'agua'; config: ConfigAgua }
  | { tipo: 'refeicoes'; config: ConfigRefeicoes }
  | { tipo: 'suplemento'; config: ConfigHorarios; texto: string }
  | { tipo: 'livre'; config: ConfigHorarios; texto: string };
export type SemTexto<T> = T extends unknown ? Omit<T, 'texto'> : never;

type Erros = Record<string, string>;
type Tipo = LembreteNovo['tipo'];

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Número de formulário: número inteiro ou texto só de dígitos (FormData). */
const inteiro = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);

function daLista<T extends number>(v: unknown, lista: readonly T[]): T | null {
  const n = inteiro(v);
  return n !== null && (lista as readonly number[]).includes(n) ? (n as T) : null;
}

const naJanela = (v: unknown): v is string => typeof v === 'string' && HORA_HHMM.test(v) && minutosDe(v) >= JANELA_INICIO_MIN && minutosDe(v) <= JANELA_FIM_MIN;

/** Dias distintos, em ordem; null se não for lista de 0..6. Lista vazia vira o erro "ao menos um dia". */
function dias(v: unknown, erros: Erros): DiaDaSemana[] | null {
  const ns = Array.isArray(v) ? v.map(inteiro) : null;
  if (!ns || ns.some((n) => n === null || n < 0 || n > 6)) {
    erros.dias = M.diasVazio;
    return null;
  }
  if (ns.length === 0) {
    erros.dias = M.diasVazio;
    return null;
  }
  return [...new Set(ns as DiaDaSemana[])].sort((a, b) => a - b);
}

function configAgua(c: Record<string, unknown>, erros: Erros): ConfigAgua | null {
  const inicioOk = naJanela(c.inicio);
  const fimOk = naJanela(c.fim);
  if (!inicioOk) erros.inicio = M.horarioForaDaJanela;
  if (!fimOk) erros.fim = M.horarioForaDaJanela;
  else if (inicioOk && minutosDe(c.fim as string) <= minutosDe(c.inicio as string)) erros.fim = M.fimAntesDoInicio;
  const intervaloMin = daLista(c.intervaloMin, INTERVALOS_AGUA);
  if (intervaloMin === null) erros.intervaloMin = M.intervalo;
  const d = dias(c.dias, erros);
  if (Object.keys(erros).length) return null;
  return { inicio: c.inicio as string, fim: c.fim as string, intervaloMin: intervaloMin!, dias: d! };
}

function configRefeicoes(c: Record<string, unknown>, erros: Erros): ConfigRefeicoes | null {
  const antecedenciaMin = daLista(c.antecedenciaMin, ANTECEDENCIAS);
  if (antecedenciaMin === null) erros.antecedenciaMin = M.opcao;
  // desligado: null (ou '' vindo de formulário); ausente é config malformada
  const desligado = c.diarioDepoisMin === null || c.diarioDepoisMin === '';
  const diarioDepoisMin = desligado ? null : daLista(c.diarioDepoisMin, DIARIO_DEPOIS);
  if (!desligado && diarioDepoisMin === null) erros.diarioDepoisMin = M.opcao;
  if (Object.keys(erros).length) return null;
  return { antecedenciaMin: antecedenciaMin!, diarioDepoisMin };
}

function configHorarios(c: Record<string, unknown>, erros: Erros): ConfigHorarios | null {
  const hs = c.horarios;
  if (!Array.isArray(hs) || hs.length < 1 || hs.length > MAX_HORARIOS) erros.horarios = M.horarios;
  else if (!hs.every(naJanela)) erros.horarios = M.horarioForaDaJanela;
  else if (new Set(hs).size !== hs.length) erros.horarios = M.horarioRepetido;
  const d = dias(c.dias, erros);
  if (Object.keys(erros).length) return null;
  return { horarios: [...(hs as string[])].sort(), dias: d! };
}

function configDoTipo(tipo: unknown, config: unknown, erros: Erros): SemTexto<LembreteNovo> | null {
  if (!objeto(config)) {
    erros.tipo = M.formulario;
    return null;
  }
  switch (tipo as Tipo) {
    case 'agua': {
      const c = configAgua(config, erros);
      return c && { tipo: 'agua', config: c };
    }
    case 'refeicoes': {
      const c = configRefeicoes(config, erros);
      return c && { tipo: 'refeicoes', config: c };
    }
    case 'suplemento':
    case 'livre': {
      const c = configHorarios(config, erros);
      return c && { tipo: tipo as 'suplemento' | 'livre', config: c };
    }
    default:
      erros.tipo = M.formulario;
      return null;
  }
}

/**
 * Texto do suplemento (nome) e do livre: aparado, 1..60 / 1..120 caracteres (como `char_length(btrim(...))` do CHECK).
 * SUS-110 (regra 3): o NUL (22021 no `text`, com o texto no log) e o surrogate sem par (U+FFFD no banco) saem em silêncio,
 * antes de aparar e medir — como no diário; antes o NUL era recusado com "Formulário inválido.".
 */
function texto(tipo: 'suplemento' | 'livre', v: unknown, erros: Erros): string | null {
  const t = typeof v === 'string' ? semInvalidosNoBanco(v).trim() : '';
  if (!t) erros.texto = tipo === 'suplemento' ? M.textoSuplemento : M.textoLivre;
  else if ([...t].length > TEXTO_MAX[tipo]) erros.texto = tipo === 'suplemento' ? M.textoLongoSuplemento : M.textoLongoLivre;
  else return t;
  return null;
}

/** Validação do formulário da equipe: `{ tipo, config, texto? }` → o lembrete limpo (sem chaves estranhas) ou os erros por campo. */
export function validarLembrete(input: unknown): { ok: true; valor: LembreteNovo } | { ok: false; erros: Record<string, string> } {
  const erros: Erros = {};
  if (!objeto(input)) return { ok: false, erros: { tipo: M.formulario } };
  const semTexto = configDoTipo(input.tipo, input.config, erros);
  const t = input.tipo === 'suplemento' || input.tipo === 'livre' ? texto(input.tipo, input.texto, erros) : null;
  if (!semTexto || Object.keys(erros).length) return { ok: false, erros };
  if (semTexto.tipo === 'suplemento' || semTexto.tipo === 'livre') return { ok: true, valor: { ...semTexto, texto: t! } };
  return { ok: true, valor: semTexto };
}

/** `validarLembrete` sem o texto: o worker revalida a `config` (jsonb) de cada linha sem ler `texto`. */
export function validarConfig(tipo: LembreteNovo['tipo'], config: unknown): { ok: true; valor: SemTexto<LembreteNovo> } | { ok: false } {
  const valor = configDoTipo(tipo, config, {});
  return valor ? { ok: true, valor } : { ok: false };
}

/** §5.4: primeira visão do painel — água 08:00–20:00 a cada 2 h, todos os dias; refeições na hora, sem diário. */
export function sugestaoInicial(): LembreteNovo[] {
  return [
    { tipo: 'agua', config: { inicio: '08:00', fim: '20:00', intervaloMin: 120, dias: [0, 1, 2, 3, 4, 5, 6] } },
    { tipo: 'refeicoes', config: { antecedenciaMin: 0, diarioDepoisMin: null } },
  ];
}
