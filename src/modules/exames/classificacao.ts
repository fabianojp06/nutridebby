import type { FaixaDoConsultorio } from '@/db/schema/exames-catalogo';
import { formatarDecimal, casasDecimais, lerDecimal } from '@/lib/numero';
import { normalizarNome, normUnidade } from '@/modules/ia/correspondencia';
import { formatarData, idadeEm } from '@/modules/pacientes/datas';
import { MSG_EXAMES } from './constantes';

/**
 * Plano 22 (RN-376, RN-377, RN-379, RN-380, RN-385; EP-D11 a EP-D17): classificação neutra pela faixa do laudo, categoria
 * pelas faixas do consultório, sugestão da faixa a partir do texto e o "fora" do app. PURO (sem import do servidor; guarda
 * em `puros.test.ts`): roda no formulário e na leitura. **Nada daqui é gravado** — a classificação e a categoria são
 * calculadas na leitura, com o catálogo atual (EP-D11).
 */

export type Neutra = 'abaixo' | 'dentro' | 'acima';
export const ROTULO_NEUTRA: Record<Neutra, string> = {
  abaixo: MSG_EXAMES.classificacao.abaixo,
  dentro: MSG_EXAMES.classificacao.dentro,
  acima: MSG_EXAMES.classificacao.acima,
};

const temLimite = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

/** RN-379: limites do laudo inclusivos; sem limite nenhum → null (nada a mostrar). */
export function classificarNeutra(valor: number, refMin?: number | null, refMax?: number | null): Neutra | null {
  const min = temLimite(refMin);
  const max = temLimite(refMax);
  if (!min && !max) return null;
  if (min && valor < refMin) return 'abaixo';
  if (max && valor > refMax) return 'acima';
  return 'dentro';
}

export type ExameParaCasar = { id: string; nome: string; unidade: string | null; sinonimos: string[]; componentes: string[]; faixas: FaixaDoConsultorio[] };
/** Nome normalizado (o nome e cada outro nome) → exames do catálogo com esse nome. Montado uma vez por leitura (RNF-371). */
export type IndiceDoCatalogo = Map<string, ExameParaCasar[]>;

export function indiceDoCatalogo<E extends ExameParaCasar>(itens: E[]): Map<string, E[]> {
  const indice = new Map<string, E[]>();
  for (const e of itens) {
    for (const chave of new Set([e.nome, ...e.sinonimos].map(normalizarNome))) {
      if (!chave) continue;
      const lista = indice.get(chave);
      if (lista) lista.push(e);
      else indice.set(chave, [e]);
    }
  }
  return indice;
}

/**
 * RN-380 (a), (b), EP-D14: o exame do catálogo cujo nome ou outro nome normalizado é o da linha. Dois exames → null
 * (casamento ambíguo nunca escolhe um). `mesmaUnidade` só com as duas unidades preenchidas e iguais (`normUnidade`).
 */
export function casarComCatalogo(nome: string, unidade: string | null, indice: IndiceDoCatalogo): { exame: ExameParaCasar; mesmaUnidade: boolean } | null {
  const achados = indice.get(normalizarNome(nome));
  if (!achados || achados.length !== 1) return null;
  const [exame] = achados;
  const u = normUnidade(unidade);
  return { exame, mesmaUnidade: u !== '' && u === normUnidade(exame.unidade) };
}

const contem = (f: FaixaDoConsultorio, valor: number, idade: number, sexo: string) =>
  (f.sexo === null || f.sexo === sexo) &&
  (f.idadeMin === null || idade >= f.idadeMin) &&
  (f.idadeMax === null || idade <= f.idadeMax) &&
  (f.aPartirDe === null || valor >= f.aPartirDe) &&
  (f.abaixoDe === null || valor < f.abaixoDe);

/**
 * RN-380 (a)–(e): a categoria do consultório só com casamento único, a mesma unidade, sexo e nascimento do cadastro
 * (`patients.sexo`, nunca a identidade de gênero de `patient_cadastro`, EP-D13), idade ≥ 1 ano completo **na data do
 * exame** (`idadeEm`, EP-D46) e uma faixa que contém o valor ("A partir de" ≤ valor < "Abaixo de").
 */
export function categoriaDoConsultorio(
  linha: { nome: string; valor: number; unidade: string | null },
  indice: IndiceDoCatalogo,
  paciente: { sexo: string | null; dataNascimento: string | null },
  dataDoExame: string,
): { categoria: string; faixa: FaixaDoConsultorio } | null {
  return categoriaDoCasado(casarComCatalogo(linha.nome, linha.unidade, indice), linha.valor, paciente, dataDoExame);
}

function categoriaDoCasado(
  casado: ReturnType<typeof casarComCatalogo>,
  valor: number,
  paciente: { sexo: string | null; dataNascimento: string | null },
  dataDoExame: string,
): { categoria: string; faixa: FaixaDoConsultorio } | null {
  if (!casado?.mesmaUnidade) return null;
  if (!paciente.sexo || !paciente.dataNascimento) return null;
  const idade = idadeEm(paciente.dataNascimento, dataDoExame);
  if (!(idade >= 1)) return null;
  const faixa = casado.exame.faixas.find((f) => contem(f, valor, idade, paciente.sexo!));
  return faixa ? { categoria: faixa.categoria, faixa } : null;
}

/** A classificação de uma linha na leitura (aba Exames e detalhe): a neutra, a categoria e o exame do catálogo que casou. */
export type LinhaClassificadaNaLeitura<E extends ExameParaCasar = ExameParaCasar> = {
  neutra: Neutra | null;
  categoria: { nome: string; faixa: FaixaDoConsultorio } | null;
  /** O exame do catálogo com casamento único pelo nome (RN-380 a, b); `null` sem casamento. */
  casado: E | null;
};

/**
 * Plano 22 (T5b, RNF-371): a neutra (faixa do laudo), a categoria do consultório e o exame do catálogo que casou, com um
 * casamento só por linha — o índice é montado uma vez por leitura e a aba classifica todas as linhas em memória.
 */
export function classificarLinha<E extends ExameParaCasar>(
  linha: { nome: string; valor: number; unidade: string | null; refMin?: number; refMax?: number },
  indice: Map<string, E[]>,
  paciente: { sexo: string | null; dataNascimento: string | null },
  dataDoExame: string,
): LinhaClassificadaNaLeitura<E> {
  const casado = casarComCatalogo(linha.nome, linha.unidade, indice);
  const categoria = categoriaDoCasado(casado, linha.valor, paciente, dataDoExame);
  return {
    neutra: classificarNeutra(linha.valor, linha.refMin, linha.refMax),
    categoria: categoria ? { nome: categoria.categoria, faixa: categoria.faixa } : null,
    casado: (casado?.exame as E | undefined) ?? null,
  };
}

// Número com sinal opcional e todos os grupos "[.,]ddd" (para o milhar não ser cortado no meio); o lookbehind impede que o
// número comece no meio de outro. O '-' entre dois números continua sendo o separador (o separador é obrigatório).
const NUMERO = String.raw`(?<![\d.,])-?\d+(?:[.,]\d+)*`;
const PADRAO_FAIXA = new RegExp(`(${NUMERO})\\s*(?:-|–|\\s+a\\s+)\\s*(${NUMERO})`, 'giu');
const SEM_SUGESTAO = /[<>≤≥;]|\b(?:ate|acima|abaixo)\b/;
/** Ponto de milhar dos laudos ("4.000", "150.000", "1.005"): ambíguo com o ponto decimal, então não sugere (RN-377). */
const PONTO_DE_MILHAR = /^-?\d{1,3}(?:\.\d{3})+$/;

/**
 * RN-377: só um padrão "a a b", "a - b" ou "a – b" (vírgula ou ponto decimal, sinal opcional, unidade opcional depois), e
 * nada de `<`, `>`, `≤`, `≥`, "até", "acima", "abaixo", ";" ou segunda faixa. Número com cara de ponto de milhar
 * ("4.000 a 11.000", "1.005 a 1.030") não sugere: na dúvida, nada. Nunca preenche sozinha: a tela oferece "Usar a a b".
 */
export function sugerirFaixa(texto: string | null): { refMin: number; refMax: number } | null {
  if (!texto?.trim()) return null;
  const semAcento = texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (SEM_SUGESTAO.test(semAcento)) return null;
  const achados = [...texto.matchAll(PADRAO_FAIXA)];
  if (achados.length !== 1) return null;
  const [, textoMin, textoMax] = achados[0];
  if (PONTO_DE_MILHAR.test(textoMin) || PONTO_DE_MILHAR.test(textoMax)) return null;
  const refMin = lerDecimal(textoMin);
  const refMax = lerDecimal(textoMax);
  if (refMin === null || refMax === null || !Number.isFinite(refMin) || !Number.isFinite(refMax) || refMin > refMax) return null;
  return { refMin, refMax };
}

/** Número com vírgula decimal e as casas que tinha ("4,5", "6", "0,25"), sem milhar. */
export const formatarLimite = (n: number): string => formatarDecimal(n, casasDecimais(n));

/** RN-376: o texto da faixa para quem só lê `referencia` — "70 a 99", "até 200", "a partir de 30". */
export function referenciaDaFaixa(refMin?: number | null, refMax?: number | null): string | null {
  const min = temLimite(refMin);
  const max = temLimite(refMax);
  if (min && max) return `${formatarLimite(refMin)} a ${formatarLimite(refMax)}`;
  if (max) return `até ${formatarLimite(refMax)}`;
  if (min) return `a partir de ${formatarLimite(refMin)}`;
  return null;
}

/**
 * RN-376 (aviso sem bloquear) e N22-07: há texto, há faixa numérica e a faixa que o texto sugere é outra. Texto sem
 * sugestão ("até 200", "Negativo") não diverge: não há com o que comparar.
 */
export function faixaDiverge(l: { referencia: string | null; refMin?: number; refMax?: number }): boolean {
  if (!temLimite(l.refMin) && !temLimite(l.refMax)) return false;
  const s = sugerirFaixa(l.referencia);
  if (!s) return false;
  return s.refMin !== (l.refMin ?? null) || s.refMax !== (l.refMax ?? null);
}

/**
 * RN-385: o "Fora da referência" do app — `true` com a neutra "Abaixo" ou "Acima", `false` com "Dentro"; null sem faixa
 * ou quando a faixa diverge do texto do laudo (o app não contradiz o texto que mostra).
 */
export function foraParaOApp(l: { valor: number; referencia: string | null; refMin?: number; refMax?: number }): boolean | null {
  const neutra = classificarNeutra(l.valor, l.refMin, l.refMax);
  if (neutra === null || faixaDiverge(l)) return null;
  return neutra !== 'dentro';
}

/**
 * RN-382 (REF): uma faixa do consultório como o diálogo "Ver referência" a mostra — "{Feminino|Masculino|Todos},
 * {idade}: {limites} — {categoria}" (os limites com a unidade do exame do catálogo) e "Fonte: {fonte} · atualizada em
 * {dd/mm/aaaa}".
 */
export function textoDaFaixaDoConsultorio(f: FaixaDoConsultorio, unidade: string | null): { linha: string; fonte: string } {
  const S = MSG_EXAMES.faixas.sexos;
  const R = MSG_EXAMES.ref;
  const publico = f.sexo === 'F' ? S.F : f.sexo === 'M' ? S.M : S.todos;
  const idade = f.idadeMin === null && f.idadeMax === null ? R.qualquerIdade : R.idade(f.idadeMin, f.idadeMax);
  const limite = (n: number | null) => (n === null ? null : formatarLimite(n));
  const limites = `${R.limites(limite(f.aPartirDe), limite(f.abaixoDe))}${unidade ? ` ${unidade}` : ''}`;
  return { linha: R.linhaFaixa(publico, idade, limites, f.categoria), fonte: R.fonte(f.fonte, formatarData(f.atualizadaEm)) };
}
