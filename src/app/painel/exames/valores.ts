import type { FaixaDoConsultorio } from '@/db/schema/exames-catalogo';

/**
 * Plano 22 (T3): o que as telas de /painel/exames e as actions dividem, sem import do servidor (o formulário 'use client'
 * também lê daqui).
 */

/** O marcador da ação (`r`, gerado pela action): só serve para a região anunciar de novo; fora do formato, vazio. */
export const marcadorDaUrl = (r: unknown): string => (typeof r === 'string' && /^[0-9a-f]{8}$/.test(r) ? r : '');
export const novoMarcador = (): string => crypto.randomUUID().slice(0, 8);

export const CAMPOS_DA_FAIXA = ['sexo', 'idadeMin', 'idadeMax', 'aPartirDe', 'abaixoDe', 'categoria', 'fonte'] as const;
export type CampoDaFaixa = (typeof CAMPOS_DA_FAIXA)[number];
/** Uma faixa como o formulário a mostra (texto em cada campo); `atualizadaEm` só na que já está gravada. */
export type FaixaDoFormulario = Record<CampoDaFaixa, string> & { atualizadaEm?: string };
export type ExameDoFormulario = {
  nome: string;
  unidade: string;
  sinonimos: string;
  componentes: string;
  modeloNotaAbaixo: string;
  modeloNotaAcima: string;
  faixas: FaixaDoFormulario[];
};
const CAMPOS_DO_EXAME = ['nome', 'unidade', 'sinonimos', 'componentes', 'modeloNotaAbaixo', 'modeloNotaAcima'] as const;
const FAIXA = /^faixas\.(\d{1,3})\.(sexo|idadeMin|idadeMax|aPartirDe|abaixoDe|categoria|fonte)$/;

export const faixaVazia = (): FaixaDoFormulario => ({ sexo: 'todos', idadeMin: '', idadeMax: '', aPartirDe: '', abaixoDe: '', categoria: '', fonte: '' });

const texto = (n: number | null) => (n === null ? '' : String(n).replace('.', ','));

/** O exame gravado → o formulário (números com vírgula decimal, listas um por linha). */
export function exameParaFormulario(e: {
  nome: string;
  unidade: string | null;
  sinonimos: string[];
  componentes: string[];
  faixas: FaixaDoConsultorio[];
  modeloNotaAbaixo: string | null;
  modeloNotaAcima: string | null;
}): ExameDoFormulario {
  return {
    nome: e.nome,
    unidade: e.unidade ?? '',
    sinonimos: e.sinonimos.join('\n'),
    componentes: e.componentes.join('\n'),
    modeloNotaAbaixo: e.modeloNotaAbaixo ?? '',
    modeloNotaAcima: e.modeloNotaAcima ?? '',
    faixas: e.faixas.map((f) => ({
      sexo: f.sexo ?? 'todos',
      idadeMin: texto(f.idadeMin),
      idadeMax: texto(f.idadeMax),
      aPartirDe: texto(f.aPartirDe),
      abaixoDe: texto(f.abaixoDe),
      categoria: f.categoria,
      fonte: f.fonte,
      atualizadaEm: f.atualizadaEm,
    })),
  };
}

/** As faixas do formulário (`faixas.<i>.<campo>`), na ordem dos índices, sem buracos. */
function faixasDe(entradas: Iterable<[string, string]>): FaixaDoFormulario[] {
  const porIndice = new Map<number, FaixaDoFormulario>();
  for (const [k, v] of entradas) {
    const m = FAIXA.exec(k);
    if (!m) continue;
    const i = Number(m[1]);
    const f = porIndice.get(i) ?? faixaVazia();
    f[m[2] as CampoDaFaixa] = v;
    porIndice.set(i, f);
  }
  return [...porIndice.entries()].sort(([a], [b]) => a - b).map(([, f]) => f);
}

const textos = (fd: FormData): [string, string][] => [...fd.entries()].filter((e): e is [string, string] => typeof e[1] === 'string');

/** O formulário enviado → a entrada de `salvarExameDoCatalogo` (os textos crus; a validação é do módulo). */
export function entradaDoExame(fd: FormData) {
  const v = Object.fromEntries(CAMPOS_DO_EXAME.map((c) => [c, fd.get(c)])) as Record<(typeof CAMPOS_DO_EXAME)[number], unknown>;
  return { ...v, faixas: faixasDe(textos(fd)) };
}

/** Os valores digitados (só textos do exame e das faixas), para o formulário voltar com eles depois de um erro. */
export function valoresDoExame(fd: FormData): Record<string, string> {
  return Object.fromEntries(textos(fd).filter(([k]) => (CAMPOS_DO_EXAME as readonly string[]).includes(k) || FAIXA.test(k)));
}

/** `valores` devolvidos pela action → o formulário (sem as datas `atualizadaEm`: a faixa ainda não foi gravada como está). */
export function formularioDosValores(v: Record<string, string>): ExameDoFormulario {
  return {
    nome: v.nome ?? '',
    unidade: v.unidade ?? '',
    sinonimos: v.sinonimos ?? '',
    componentes: v.componentes ?? '',
    modeloNotaAbaixo: v.modeloNotaAbaixo ?? '',
    modeloNotaAcima: v.modeloNotaAcima ?? '',
    faixas: faixasDe(Object.entries(v)),
  };
}

/** O catálogo para o diálogo "Buscar no catálogo": sem as faixas nem o id (o navegador não precisa deles). */
export const paraEscolher = (catalogo: { nome: string; unidade: string | null; sinonimos: string[]; componentes: string[] }[]) =>
  catalogo.map((e) => ({ nome: e.nome, unidade: e.unidade, sinonimos: e.sinonimos, componentes: e.componentes }));
