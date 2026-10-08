import { z } from 'zod';
import { DocumentoError } from './erros';
import type { CopiaDoDocumento } from './perfil-profissional';
import type { ConteudoReceita } from './prescricao';

/**
 * Plano 13 — parecer nutricional (F3-05, US-141, RN-148). Sem imports do servidor: o formulário 'use client' e o PDF do
 * worker leem daqui (como prescricao.ts). A cópia dos exames (RN-154) é refeita a cada salvamento do rascunho e no preparo;
 * do preparo em diante o `conteudo` inteiro é fixo (gatilho, RN-140).
 */
export const PARECER_MAX_EXAMES = 20;
export const AVALIACAO_MAX = 5000;
export const CONDUTA_MAX = 5000;
export const ENCAMINHAMENTOS_MAX = 1000;

/** US-141 (texto exato da spec v0.5; os marcados "proposto" na spec vão à Debby). */
export const MSG_PARECER = {
  semExame: 'Selecione ao menos um exame.',
  examesDemais: 'Selecione no máximo 20 exames.',
  avaliacao: 'Escreva a avaliação nutricional (até 5000 caracteres).',
  conduta: 'Use no máximo 5000 caracteres.',
  encaminhamentos: 'Use no máximo 1000 caracteres.',
  /** proposto na spec v0.5 (exame excluído na seleção de um rascunho) */
  exameExcluido: 'Um dos exames selecionados foi excluído. Revise a seleção.',
  semValores: 'laudo no prontuário, sem valores lançados',
  valoresMudaram: 'Os valores deste exame mudaram depois do parecer.',
  /** proposto na spec v0.5 */
  exameExcluidoDepois: (exame: string) => `O exame ${exame} foi excluído depois do parecer.`,
} as const;
/** Texto novo (cabeçalho da tabela dos valores no PDF; vai à Debby). */
export const CABECALHO_VALORES = 'Marcador · Valor · Unidade · Referência';

/** Uma linha de `exams.valores` como estava (US-015). `iaTarefaId` (Plano 11) fica só na cópia e na exportação (Q13-2 ★). */
export type ValorCopiado = { nome: string; valor: number; unidade: string | null; referencia: string | null; iaTarefaId?: string };
/** O exame na cópia: nunca o arquivo do laudo (RN-148). `enviadoPeloPaciente`: veio de um envio aceito (Plano 12; Q13-2 ★). */
export type ExameCopiado = { id: string; data: string; titulo: string; valores: ValorCopiado[]; enviadoPeloPaciente?: true };
export type ConteudoParecer = {
  versao: 1;
  tipo: 'parecer';
  exames: ExameCopiado[];
  avaliacao: string;
  conduta: string;
  encaminhamentos: string;
  /** RN-154: a cópia congelada no preparo. */
  copia?: CopiaDoDocumento;
  /** D5: o texto da declaração confirmada no preparo. */
  declaracao?: string;
};
export type ConteudoDocumento = ConteudoReceita | ConteudoParecer;

/** O navegador manda a quebra de linha do <textarea> como \r\n: normalizar antes de contar (o maxLength da tela conta 1). */
const texto = (max: number, msg: string) =>
  z.string().optional().transform((s) => (s ?? '').replace(/\r\n?/g, '\n').trim()).pipe(z.string().max(max, msg));
const rascunho = z.object({
  // G5: z.guid() aceita o mesmo formato do tipo uuid do Postgres (z.uuid() exige a versão RFC), como src/app/admin/actions.ts:19
  exameIds: z.array(z.guid({ message: MSG_PARECER.exameExcluido }), { message: MSG_PARECER.exameExcluido }).max(PARECER_MAX_EXAMES, MSG_PARECER.examesDemais).default([]),
  avaliacao: texto(AVALIACAO_MAX, MSG_PARECER.avaliacao),
  conduta: texto(CONDUTA_MAX, MSG_PARECER.conduta),
  encaminhamentos: texto(ENCAMINHAMENTOS_MAX, MSG_PARECER.encaminhamentos),
});
export type RascunhoParecer = z.output<typeof rascunho>;

/** D-P4: o rascunho aceita 0 exames e avaliação vazia; os máximos valem já no salvar. Erros de `exameIds.*` vão para `exames`. */
export function validarRascunhoParecer(input: unknown): RascunhoParecer {
  const p = rascunho.safeParse(input ?? {});
  if (!p.success) {
    const e: Record<string, string> = {};
    for (const i of p.error.issues) e[i.path[0] === 'exameIds' ? 'exames' : String(i.path[0] ?? 'geral')] ??= i.message;
    throw new DocumentoError(e);
  }
  return { ...p.data, exameIds: [...new Set(p.data.exameIds)] };
}

/** US-141 / RN-148: para preparar, 1 a 20 exames e a avaliação. */
export function validarParecerParaPreparar(c: ConteudoParecer): void {
  const e: Record<string, string> = {};
  if (!c.exames.length) e.exames = MSG_PARECER.semExame;
  else if (c.exames.length > PARECER_MAX_EXAMES) e.exames = MSG_PARECER.examesDemais;
  if (!c.avaliacao.trim()) e.avaliacao = MSG_PARECER.avaliacao;
  if (Object.keys(e).length) throw new DocumentoError(e);
}

const linhas = (vs: readonly ValorCopiado[]) => JSON.stringify(vs.map((v) => [v.nome, v.valor, v.unidade ?? null, v.referencia ?? null]));
/** RN-148 v0.5: "o exame mudou" = título, data ou linhas diferentes (linhas da IA acrescentadas, data trocada); a origem não conta. */
export function mesmoExame(copia: Pick<ExameCopiado, 'data' | 'titulo' | 'valores'>, atual: Pick<ExameCopiado, 'data' | 'titulo' | 'valores'>): boolean {
  return copia.titulo === atual.titulo && copia.data === atual.data && linhas(copia.valores) === linhas(atual.valores);
}

const dataBr = (iso: string) => {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
};
/** "Hemograma — 01/09/2026" (US-141). */
export const rotuloDoExame = (e: { titulo: string; data: string }): string => `${e.titulo} — ${dataBr(e.data)}`;
/** A linha da tabela do PDF e do painel: marcador · valor · unidade · referência (vírgula decimal; "—" no que falta). */
export const linhaDoValor = (v: ValorCopiado): string => [v.nome, String(v.valor).replace('.', ','), v.unidade ?? '—', v.referencia ?? '—'].join(' · ');
