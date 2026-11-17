import { z } from 'zod';
import type { ExameDaLista, FaixaDoConsultorio } from '@/db/schema/exames-catalogo';
import { lerDecimal } from '@/lib/numero';
import { normalizarNome } from '@/modules/ia/correspondencia';
import { casarComCatalogo, type IndiceDoCatalogo } from './classificacao';
import {
  CATEGORIAS_DO_CONSULTORIO,
  COMPONENTES_MAX,
  COMPONENTES_MIN,
  FAIXAS_MAX,
  FONTE_MAX,
  FONTE_MIN,
  IDADE_MAX,
  LIMITE_ABSOLUTO,
  MODELO_NOTA_MAX,
  MSG_EXAMES,
  NOME_MAX,
  SINONIMOS_MAX,
  UNIDADE_MAX,
} from './constantes';

/**
 * Plano 22 (RN-371, RN-373, RN-374, RN-375; EP-D47): as regras do exame do catálogo que o formulário também roda no
 * cliente — Zod, sobreposição de faixas e a expansão do painel para a análise. PURO (guarda em `puros.test.ts`); o que lê
 * o banco (unicidade entre exames sob trava, teto de 500, unidade com faixas gravadas) fica em `catalogo.ts` (T3).
 * Números só por `lerDecimal` (RNF-374).
 */
export { validarListaDeExames } from '@/modules/documentos/solicitacao';

export class CatalogoError extends Error {
  override name = 'CatalogoError';
  constructor(readonly erros: Record<string, string>) {
    super(Object.values(erros)[0] ?? 'Exame do catálogo inválido.');
  }
}

export type FaixaEntrada = Omit<FaixaDoConsultorio, 'atualizadaEm'>;
export type ExameDoCatalogoEntrada = {
  nome: string;
  unidade: string | null;
  sinonimos: string[];
  componentes: string[];
  faixas: FaixaEntrada[];
  modeloNotaAbaixo: string | null;
  modeloNotaAcima: string | null;
};

const E = MSG_EXAMES.erros;
const umaLinha = (s: string) => s.replace(/\u0000/g, '').trim().replace(/\s+/g, ' ');
const textoLivre = (s: string) => s.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
/** Lista de nomes: array de textos ou um texto com um por linha (o formulário); vazios somem. */
const linhas = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\r?\n/) : []).map((x) => (typeof x === 'string' ? umaLinha(x) : '')).filter(Boolean);
const opcional = (v: unknown): string | null => (typeof v === 'string' && textoLivre(v) ? textoLivre(v) : null);

const limite = z.unknown().optional().transform((v, c): number | null => {
  const n = lerDecimal(v);
  if (n === null) return null;
  if (Number.isNaN(n) || Math.abs(n) >= LIMITE_ABSOLUTO) {
    c.addIssue({ code: 'custom', message: MSG_EXAMES.lancamentoErros.faixaInvalida });
    return z.NEVER;
  }
  return n;
});
const idade = z.unknown().optional().transform((v, c): number | null => {
  const n = lerDecimal(v);
  if (n === null) return null;
  if (!Number.isInteger(n) || n < 0 || n > IDADE_MAX) {
    c.addIssue({ code: 'custom', message: E.idade });
    return z.NEVER;
  }
  return n;
});
const sexo = z.unknown().optional().transform((v, c): 'F' | 'M' | null => {
  if (v === null || v === undefined || v === '' || v === 'todos') return null;
  if (v === 'F' || v === 'M') return v;
  c.addIssue({ code: 'custom', message: E.sexo });
  return z.NEVER;
});

const faixa = z
  .object({
    sexo,
    idadeMin: idade,
    idadeMax: idade,
    aPartirDe: limite,
    abaixoDe: limite,
    categoria: z.enum(CATEGORIAS_DO_CONSULTORIO, { message: E.categoria }),
    fonte: z
      .unknown()
      .optional()
      .transform((v) => (typeof v === 'string' ? umaLinha(v) : ''))
      .pipe(z.string().min(FONTE_MIN, E.fonte).max(FONTE_MAX, E.fonte)),
  })
  .superRefine((f, c) => {
    if (f.aPartirDe === null && f.abaixoDe === null) c.addIssue({ code: 'custom', path: ['aPartirDe'], message: E.semLimite });
    else if (f.aPartirDe !== null && f.abaixoDe !== null && f.aPartirDe >= f.abaixoDe) c.addIssue({ code: 'custom', path: ['abaixoDe'], message: E.limites });
    if (f.idadeMin !== null && f.idadeMax !== null && f.idadeMin > f.idadeMax) c.addIssue({ code: 'custom', path: ['idadeMax'], message: E.idades });
  });

const modeloNota = z
  .unknown()
  .optional()
  .transform(opcional)
  .pipe(z.string().max(MODELO_NOTA_MAX, E.modeloNota).nullable());

const exameDoCatalogo = z.object({
  nome: z
    .unknown()
    .optional()
    .transform((v) => (typeof v === 'string' ? umaLinha(v) : ''))
    .pipe(z.string().min(1, E.nome).max(NOME_MAX, E.nome)),
  unidade: z
    .unknown()
    .optional()
    .transform((v) => (typeof v === 'string' && umaLinha(v) ? umaLinha(v) : null))
    .pipe(z.string().max(UNIDADE_MAX, E.unidade).nullable()),
  sinonimos: z.unknown().optional().transform(linhas).pipe(z.array(z.string().max(NOME_MAX, E.nome)).max(SINONIMOS_MAX, E.sinonimos)),
  componentes: z.unknown().optional().transform(linhas).pipe(z.array(z.string().max(NOME_MAX, E.nome)).max(COMPONENTES_MAX, E.painel)),
  faixas: z
    .unknown()
    .optional()
    .transform((v) => (Array.isArray(v) ? v : []))
    .pipe(z.array(faixa).max(FAIXAS_MAX, E.faixasDemais)),
  modeloNotaAbaixo: modeloNota,
  modeloNotaAcima: modeloNota,
});

/** RN-374: sexo coincide (nulo = "Todos" coincide com tudo), idades se cruzam (inclusivas) e valores se cruzam ([de, abaixo de)). */
export function faixasSeSobrepoem(a: FaixaEntrada, b: FaixaEntrada): boolean {
  const sexo = a.sexo === null || b.sexo === null || a.sexo === b.sexo;
  const idades = (a.idadeMin ?? 0) <= (b.idadeMax ?? Infinity) && (b.idadeMin ?? 0) <= (a.idadeMax ?? Infinity);
  const valores = (a.aPartirDe ?? -Infinity) < (b.abaixoDe ?? Infinity) && (b.aPartirDe ?? -Infinity) < (a.abaixoDe ?? Infinity);
  return sexo && idades && valores;
}

/**
 * RN-371, RN-373 a RN-375 (mensagens da linha "Catálogo: erros" da §6.2). Outros nomes repetidos (ou iguais ao nome),
 * sem diferença de acento e maiúsculas, somem; componente repetido é erro. Lança `CatalogoError` com as chaves do
 * formulário (`nome`, `sinonimos`, `componentes`, `faixas`, `faixas.<i>.<campo>`, `modeloNotaAbaixo`…).
 */
export function validarExameDoCatalogo(input: unknown): ExameDoCatalogoEntrada {
  const p = exameDoCatalogo.safeParse(input ?? {});
  if (!p.success) {
    const e: Record<string, string> = {};
    for (const i of p.error.issues) e[i.path.join('.') || 'geral'] ??= i.message;
    throw new CatalogoError(e);
  }
  const d = p.data;
  const nomeNorm = normalizarNome(d.nome);
  const vistos = new Set([nomeNorm]);
  const sinonimos = d.sinonimos.filter((s) => {
    const n = normalizarNome(s);
    if (!n || vistos.has(n)) return false;
    vistos.add(n);
    return true;
  });

  const e: Record<string, string> = {};
  if (d.componentes.length) {
    const normalizados = d.componentes.map(normalizarNome);
    if (d.componentes.length < COMPONENTES_MIN) e.componentes = E.painel;
    else if (new Set(normalizados).size !== normalizados.length) e.componentes = E.componenteRepetido;
    else if (d.unidade !== null || d.faixas.length || d.modeloNotaAbaixo !== null || d.modeloNotaAcima !== null) e.componentes = E.painelSemFaixa;
  } else if (d.faixas.length && d.unidade === null) {
    e.faixas = E.semUnidade;
  } else {
    d.faixas.forEach((f, i) => {
      if (d.faixas.slice(0, i).some((anterior) => faixasSeSobrepoem(anterior, f))) e[`faixas.${i}.abaixoDe`] ??= E.sobreposicao;
    });
  }
  if (Object.keys(e).length) throw new CatalogoError(e);
  return { nome: d.nome, unidade: d.unidade, sinonimos, componentes: d.componentes, faixas: d.faixas, modeloNotaAbaixo: d.modeloNotaAbaixo, modeloNotaAcima: d.modeloNotaAcima };
}

/**
 * RN-373: a lista para a análise (US-371, "Lançar resultados", "Carregar modelo de solicitação") — um exame que casa com
 * um painel do catálogo vira uma linha por componente; cada linha com a unidade do exame do catálogo que casar com o
 * nome (sem unidade se não casar, ou se casar com outro painel: um nível só).
 */
export function expandirParaAnalise(exames: ExameDaLista[], indice: IndiceDoCatalogo): { nome: string; unidade: string | null }[] {
  const linha = (nome: string) => ({ nome, unidade: casarComCatalogo(nome, null, indice)?.exame.unidade ?? null });
  return exames.flatMap((x) => {
    const painel = casarComCatalogo(x.nome, null, indice)?.exame;
    return painel?.componentes.length ? painel.componentes.map(linha) : [linha(x.nome)];
  });
}
