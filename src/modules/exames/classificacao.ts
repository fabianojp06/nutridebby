import type { FaixaDoConsultorio } from '@/db/schema/exames-catalogo';
import { formatarDecimal, casasDecimais } from '@/lib/numero';
import { normalizarNome, normUnidade } from '@/modules/ia/correspondencia';
import { idadeEm } from '@/modules/pacientes/datas';
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

export function indiceDoCatalogo(itens: ExameParaCasar[]): IndiceDoCatalogo {
  const indice: IndiceDoCatalogo = new Map();
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
  const casado = casarComCatalogo(linha.nome, linha.unidade, indice);
  if (!casado?.mesmaUnidade) return null;
  if (!paciente.sexo || !paciente.dataNascimento) return null;
  const idade = idadeEm(paciente.dataNascimento, dataDoExame);
  if (!(idade >= 1)) return null;
  const faixa = casado.exame.faixas.find((f) => contem(f, linha.valor, idade, paciente.sexo!));
  return faixa ? { categoria: faixa.categoria, faixa } : null;
}

const NUMERO = String.raw`\d+(?:[.,]\d+)?`;
const PADRAO_FAIXA = new RegExp(`(${NUMERO})\\s*(?:-|–|\\s+a\\s+)\\s*(${NUMERO})`, 'giu');
const SEM_SUGESTAO = /[<>≤≥;]|\b(?:ate|acima|abaixo)\b/;
const lerNumero = (s: string) => Number(s.replace(',', '.'));

/**
 * RN-377: só um padrão "a a b", "a - b" ou "a – b" (vírgula ou ponto decimal, unidade opcional depois), e nada de `<`,
 * `>`, `≤`, `≥`, "até", "acima", "abaixo", ";" ou segunda faixa. Nunca preenche sozinha: a tela oferece "Usar a a b".
 */
export function sugerirFaixa(texto: string | null): { refMin: number; refMax: number } | null {
  if (!texto?.trim()) return null;
  const semAcento = texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (SEM_SUGESTAO.test(semAcento)) return null;
  const achados = [...texto.matchAll(PADRAO_FAIXA)];
  if (achados.length !== 1) return null;
  const refMin = lerNumero(achados[0][1]);
  const refMax = lerNumero(achados[0][2]);
  if (!Number.isFinite(refMin) || !Number.isFinite(refMax) || refMin > refMax) return null;
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
