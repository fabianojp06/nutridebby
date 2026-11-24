import { z } from 'zod';
import { semInvalidosNoBanco } from '@/lib/texto-seguro';
import { DocumentoError } from './erros';
import type { CopiaDoDocumento } from './perfil-profissional';

/** US-142: rótulos exatos (também usados pelo formulário 'use client' — este arquivo não importa nada do servidor). */
export const TIPOS_ITEM = {
  suplemento: 'Suplemento alimentar',
  planta_cha: 'Planta medicinal ou droga vegetal (chá)',
  derivado_vegetal: 'Droga ou derivado vegetal classificado como alimento ou suplemento',
  fitoterapico: 'Fitoterápico (forma farmacêutica ou fórmula magistral)',
} as const;
export const CATEGORIAS = { nutriente: 'Nutriente', enzima: 'Enzima', probiotico: 'Probiótico', outro: 'Outro' } as const;
export const UNIDADES = ['g', 'mg', 'mcg', 'UI', 'U', 'UFC', 'mL'] as const;
/** RN-149: só oral e enteral (Res. CFN 656/2020, art. 1º, § 3º); nunca anorretal nem injetável. */
export const VIAS = { oral: 'Oral', sublingual: 'Sublingual', enteral: 'Enteral (sonda)' } as const;
/** RN-150: o chá só em água (Res. CFN 680/2021, art. 3º, I). */
export const MODOS_PREPARO = { infusao: 'Infusão', decoccao: 'Decocção', maceracao: 'Maceração em água' } as const;

export const MSG_PRESCRICAO = {
  probiotico: 'Probióticos são prescritos em UFC (Resolução CFN nº 656/2020, art. 3º, IX).',
  enzima: 'Enzimas são prescritas em Unidades (U) (Resolução CFN nº 656/2020, art. 3º, IX).',
  semHabilitacao:
    'Exige habilitação em Fitoterapia registrada no CRN (Resolução CFN nº 680/2021). Para produto vegetal classificado como alimento ou suplemento, use "Droga ou derivado vegetal classificado como alimento ou suplemento". Registre a habilitação no seu perfil.',
  justificativa: 'Escreva a justificativa de uso (fica no prontuário, não vai na receita).',
  semItens: 'Inclua ao menos um item na receita.',
  itensDemais: 'A receita pode ter até 20 itens.',
  componentes: 'Informe de 1 a 10 componentes.',
  quantidade: 'Informe uma quantidade maior que zero.',
  /** Revisão da T5 (I2): ponto só de milhar, como se escreve em pt-BR; "50.000" nunca vira 50. Texto novo, rascunho para a Debby. */
  quantidadeFormato: 'Use vírgula para decimais (até 3 casas) e ponto só para milhar (ex.: 2000, 2.000 ou 0,5).',
  /** Revisão da T5 (I1): teto só contra valor absurdo; probiótico em UFC vai a 10^10 ou mais. Texto novo, rascunho para a Debby. */
  quantidadeTeto: 'Use uma quantidade de até 10.000.000.000.000.',
  opcao: 'Escolha uma das opções.',
  orientacoes: 'Use no máximo 2000 caracteres.',
  /** Minor 11 da revisão de normas (texto novo, rascunho para a Debby): o extrato vegetal não é "Outro". */
  dicaOutro: 'Extrato ou produto vegetal não entra em "Outro": use "Droga ou derivado vegetal classificado como alimento ou suplemento" ou, com a habilitação, "Fitoterápico (forma farmacêutica ou fórmula magistral)".',
  /** Plano 22 (RN-392, §6.2; rascunho para a Debby): a fórmula magistral fitoterápica (o tipo entra em TIPOS_ITEM só na T9, EP-D48). */
  compostos: 'Informe de 2 a 10 compostos vegetais.',
  binomio: 'Use a nomenclatura botânica (Gênero espécie), como Matricaria chamomilla L.',
  naoVegetal: 'Fórmula fitoterápica não pode ter vitaminas, minerais, aminoácidos ou substâncias isoladas (Resolução CFN nº 680/2021, art. 9º, II).',
} as const;

/**
 * Plano 22 (RN-392, EP-D26, EP-D27; Res. CFN 680/2021, art. 9º, II): termos que a nomenclatura e o "Derivado ou
 * extração" de uma fórmula fitoterápica não podem ter. **Rascunho para a Debby** (e o CRN-3). Conferência de apoio, não
 * garantia: a responsabilidade pela composição é da nutricionista. A padronização fica de fora (cita o marcador
 * legitimamente, art. 12, I, "d"). "L-" no começo de palavra é conferido à parte (`temTermoNaoVegetal`).
 */
export const TERMOS_NAO_VEGETAIS: readonly string[] = [
  // nutrientes, sais e formas químicas
  'vitamina',
  'mineral',
  'aminoácido',
  'isolado',
  'ácido',
  'sulfato',
  'citrato',
  'quelato',
  'picolinato',
  'glicinato',
  'óxido',
  'carbonato',
  'cafeína',
  // substâncias isoladas comuns em nutrição
  'creatina',
  'glutamina',
  'carnitina',
  'taurina',
  'glutationa',
  'coenzima',
  'resveratrol',
  'curcumina',
  'berberina',
  'quercetina',
  'piperina',
  'melatonina',
  'colágeno',
  'whey',
  'proteína',
  'peptídeo',
  'ômega',
  'cloridrato',
  // revisão final do PR 1: de origem animal, de síntese ou carotenoides isolados
  'própolis',
  'geleia real',
  'quitosana',
  'glucosamina',
  'condroitina',
  'inositol',
  'ubiquinol',
  'licopeno',
  'luteína',
  // gêneros de probióticos e leveduras
  'Lactobacillus',
  'Lacticaseibacillus',
  'Bifidobacterium',
  'Saccharomyces',
  'Streptococcus',
  'Bacillus',
];

const semAcento = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
/** A palavra e o plural ("vitaminas", "minerais", "ácidos"); "isolado" também no feminino ("isolada", "isoladas"). */
const formas = (termo: string): string[] => {
  const t = semAcento(termo);
  const base = [t, `${t}s`, `${t}es`];
  if (t.endsWith('al')) base.push(`${t.slice(0, -2)}ais`);
  if (t.endsWith('o')) base.push(`${t.slice(0, -1)}a`, `${t.slice(0, -1)}as`);
  return base;
};
const PALAVRAS_BARRADAS = new Set(TERMOS_NAO_VEGETAIS.filter((t) => !t.includes(' ')).flatMap(formas));
/** Termos de mais de uma palavra ("geleia real"): a sequência inteira de palavras, sem acento. */
const EXPRESSOES_BARRADAS = TERMOS_NAO_VEGETAIS.filter((t) => t.includes(' ')).map((t) => ` ${semAcento(t)} `);

/** RN-392: palavra inteira, sem acento e sem diferença de maiúsculas; "L-" no começo de palavra (L-teanina, L-carnitina). */
export function temTermoNaoVegetal(texto: string): boolean {
  const t = semAcento(texto);
  if (/(?:^|[^a-z0-9])l-/.test(t)) return true;
  const palavras = t.split(/[^a-z0-9]+/).filter(Boolean);
  if (palavras.some((p) => PALAVRAS_BARRADAS.has(p))) return true;
  const corrido = ` ${palavras.join(' ')} `;
  return EXPRESSOES_BARRADAS.some((e) => corrido.includes(e));
}

/**
 * RN-392: "Gênero epíteto" — o gênero com inicial maiúscula e o resto minúsculo, o epíteto todo em minúsculas (hífen
 * vale: bursa-pastoris), ou "×" entre eles (híbrido: "Mentha × piperita", "Mentha ×piperita"); autor e categorias
 * abaixo de espécie depois ("L.", "var. amara"). Conferência de apoio, não garantia.
 */
export function binomioValido(nomenclatura: string): boolean {
  const [genero, segundo, terceiro] = nomenclatura.trim().split(/\s+/);
  if (!genero || !/^\p{Lu}\p{Ll}+$/u.test(genero)) return false;
  const epiteto = /^\p{Ll}+(?:-\p{Ll}+)*$/u;
  if (segundo === '×') return !!terceiro && epiteto.test(terceiro);
  if (segundo?.startsWith('×')) return epiteto.test(segundo.slice(1));
  return !!segundo && epiteto.test(segundo);
}

/** RN-392: a função única de "exige habilitação em Fitoterapia" — no Zod, no preparo e na assinatura. */
export function exigeHabilitacao(tipo: string): boolean {
  return tipo === 'fitoterapico' || tipo === 'formula_fitoterapica';
}

/** Uma linha: espaços repetidos viram um; sem NUL nem surrogate sem par (SUS-109: o jsonb recusaria e levaria o texto ao log). */
const esp = (s: string) => semInvalidosNoBanco(s).trim().replace(/\s+/g, ' ');
const obrig = (rotulo: string, min: number, max: number) =>
  z.string({ message: `Informe ${rotulo} (até ${max} caracteres).` }).transform(esp).pipe(z.string().min(min, `Informe ${rotulo} (até ${max} caracteres).`).max(max, `Informe ${rotulo} (até ${max} caracteres).`));
const opc = (max: number) => z.string().optional().transform((s) => (s ? esp(s) : '')).pipe(z.string().max(max, `Use no máximo ${max} caracteres.`));
const escolha = <T extends Record<string, string>>(o: T) => z.enum(Object.keys(o) as [keyof T & string, ...(keyof T & string)[]], { message: MSG_PRESCRICAO.opcao });
/** Revisão da T5 (I1): 10^13 cobre a dose de probiótico em UFC (10^8 a 10^12) e ainda barra o absurdo. */
const TETO_QUANTIDADE = 10_000_000_000_000;
/** Revisão da T5 (I2): só formatos sem ambiguidade — "2000", "0,5", "2.000", "2.000,5". Nada de ponto decimal, exponencial ou hexadecimal. */
const QTD_SIMPLES = /^\d+(,\d{1,3})?$/;
const QTD_MILHAR = /^[1-9]\d{0,2}(\.\d{3})+(,\d{1,3})?$/;
const numero = z.union([z.number(), z.string()], { message: MSG_PRESCRICAO.quantidade }).transform((v, c) => {
  const falha = (message: string) => {
    c.addIssue({ code: 'custom', message });
    return z.NEVER;
  };
  let n = v as number;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return falha(MSG_PRESCRICAO.quantidade);
    if (!QTD_SIMPLES.test(t) && !QTD_MILHAR.test(t)) return falha(MSG_PRESCRICAO.quantidadeFormato);
    n = Number(t.replace(/\./g, '').replace(',', '.'));
  }
  if (!Number.isFinite(n)) return falha(MSG_PRESCRICAO.quantidade);
  const arredondado = Math.round(n * 1000) / 1000;
  if (arredondado <= 0) return falha(MSG_PRESCRICAO.quantidade); // depois do arredondamento: "0,0004" nunca vira 0 gravado
  if (arredondado > TETO_QUANTIDADE) return falha(MSG_PRESCRICAO.quantidadeTeto);
  return arredondado;
});

const componente = z.object({ nome: obrig('o componente', 1, 120), quantidade: numero, unidade: z.enum(UNIDADES, { message: MSG_PRESCRICAO.opcao }) });
const botanica = { nomenclatura: obrig('a nomenclatura botânica', 2, 120), parte: obrig('a parte utilizada', 1, 60), nomePopular: opc(60), duracao: opc(100) };

const suplemento = z
  .object({
    tipo: z.literal('suplemento'),
    categoria: escolha(CATEGORIAS),
    composicao: z.array(componente).min(1, MSG_PRESCRICAO.componentes).max(10, MSG_PRESCRICAO.componentes),
    forma: obrig('a forma de apresentação', 1, 60),
    via: escolha(VIAS),
    posologia: obrig('a posologia', 1, 300),
    duracao: opc(100),
    manipulado: z.union([z.boolean(), z.literal('on'), z.literal('')]).optional().transform((v) => v === true || v === 'on'),
  })
  .superRefine((s, c) => {
    s.composicao.forEach((k, i) => {
      if (s.categoria === 'probiotico' && k.unidade !== 'UFC') c.addIssue({ code: 'custom', path: ['composicao', i, 'unidade'], message: MSG_PRESCRICAO.probiotico });
      if (s.categoria === 'enzima' && k.unidade !== 'U') c.addIssue({ code: 'custom', path: ['composicao', i, 'unidade'], message: MSG_PRESCRICAO.enzima });
    });
  });
const plantaCha = z.object({ tipo: z.literal('planta_cha'), ...botanica, modoPreparo: escolha(MODOS_PREPARO), formaUso: obrig('a forma de utilização e o preparo', 1, 300), posologia: obrig('a posologia', 1, 300) });
const derivadoVegetal = z.object({
  tipo: z.literal('derivado_vegetal'),
  ...botanica,
  formaFarmaceutica: obrig('a forma farmacêutica', 1, 60),
  dose: obrig('a dose', 1, 120),
  via: escolha(VIAS),
  posologia: obrig('a posologia', 1, 300),
  padronizacao: opc(120),
  extracao: opc(120),
});
/** Revisão final do PR 1: a vedação do art. 9º, II (Res. CFN 680/2021) vale também para o fitoterápico de uma planta
 * só. A vedação é sobre a COMPOSIÇÃO: só a nomenclatura passa pela conferência de apoio da fórmula (/code-review do PR 1).
 * A extração e a padronização ficam de fora — o marcador de padronização é legítimo ("Extrato seco padronizado a 95% de
 * curcumina") e barrá-lo travaria rascunhos e retificações já salvos. */
const fitoterapico = z
  .object({
    tipo: z.literal('fitoterapico'),
    ...botanica,
    extracao: obrig('a forma ou meio de extração', 1, 120),
    formaFarmaceutica: obrig('a forma farmacêutica', 1, 60),
    dose: obrig('a dose', 1, 120),
    via: escolha(VIAS),
    posologia: obrig('a posologia', 1, 300),
    padronizacao: opc(120),
  })
  .superRefine((f, c) => {
    if (temTermoNaoVegetal(f.nomenclatura)) c.addIssue({ code: 'custom', path: ['nomenclatura'], message: MSG_PRESCRICAO.naoVegetal });
  });
const item = z.discriminatedUnion('tipo', [suplemento, plantaCha, derivadoVegetal, fitoterapico], { message: MSG_PRESCRICAO.opcao });
export type ItemPrescricao = z.output<typeof item>;

const rascunho = z.object({ itens: z.array(item).max(20, MSG_PRESCRICAO.itensDemais).default([]), orientacoes: opc(2000) });

export type ConteudoReceita = {
  versao: 1;
  tipo: 'receita';
  itens: ItemPrescricao[];
  orientacoes: string;
  /** RN-154: a cópia congelada no preparo. */
  copia?: CopiaDoDocumento;
  /** D5 da spec: o texto da declaração confirmada no preparo. */
  declaracao?: string;
};

function erros(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of error.issues) out[i.path.join('.') || 'geral'] ??= i.message;
  return out;
}

function conferirHabilitacao(itens: ItemPrescricao[], habilitada: boolean): void {
  const e: Record<string, string> = {};
  itens.forEach((it, i) => {
    if (exigeHabilitacao(it.tipo) && !habilitada) e[`itens.${i}.tipo`] = MSG_PRESCRICAO.semHabilitacao;
  });
  if (Object.keys(e).length) throw new DocumentoError(e);
}

/** US-142: o que o rascunho aceita (itens completos; 0 itens vale no rascunho). Habilitação conferida no servidor (RN-150). */
export function validarRascunho(input: unknown, o: { habilitada: boolean }): ConteudoReceita {
  const p = rascunho.safeParse(input ?? {});
  if (!p.success) throw new DocumentoError(erros(p.error));
  conferirHabilitacao(p.data.itens, o.habilitada);
  return { versao: 1, tipo: 'receita', itens: p.data.itens, orientacoes: p.data.orientacoes };
}

/** US-142/US-143: para preparar, 1 a 20 itens e a justificativa; a habilitação de novo (pode ter sido retirada depois do salvar). */
export function validarParaPreparar(c: ConteudoReceita, justificativa: string | null, o: { habilitada: boolean }): void {
  if (!c.itens.length) throw new DocumentoError({ itens: MSG_PRESCRICAO.semItens });
  const j = (justificativa ?? '').trim();
  if (!j || j.length > 2000) throw new DocumentoError({ justificativa: MSG_PRESCRICAO.justificativa });
  conferirHabilitacao(c.itens, o.habilitada);
}

const qtd = (n: number) => String(n).replace('.', ',');
/** Texto do item no PDF, no portal e no painel (nunca a justificativa). */
export function descreverItem(it: ItemPrescricao): { titulo: string; linhas: string[] } {
  const comum = (via?: keyof typeof VIAS) => [...(via ? [`Via: ${VIAS[via]}`] : []), `Posologia: ${it.posologia}`, ...('duracao' in it && it.duracao ? [`Duração: ${it.duracao}`] : [])];
  switch (it.tipo) {
    case 'suplemento':
      return {
        titulo: it.composicao.map((k) => `${k.nome} ${qtd(k.quantidade)} ${k.unidade}`).join(' + '),
        linhas: [`${TIPOS_ITEM.suplemento} (${CATEGORIAS[it.categoria]}) · ${it.forma}${it.manipulado ? ' · manipulado' : ''}`, ...comum(it.via)],
      };
    case 'planta_cha':
      return { titulo: `${it.nomenclatura}${it.nomePopular ? ` (${it.nomePopular})` : ''}`, linhas: [`Parte utilizada: ${it.parte}`, `${MODOS_PREPARO[it.modoPreparo]}: ${it.formaUso}`, ...comum()] };
    case 'derivado_vegetal':
    case 'fitoterapico':
      return {
        titulo: `${it.nomenclatura}${it.nomePopular ? ` (${it.nomePopular})` : ''}`,
        linhas: [
          `Parte utilizada: ${it.parte} · ${it.formaFarmaceutica} · ${it.dose}`,
          ...(it.extracao ? [`Extração: ${it.extracao}`] : []),
          ...(it.padronizacao ? [`Padronização: ${it.padronizacao}`] : []),
          ...comum(it.via),
        ],
      };
  }
}
