import { z } from 'zod';
import type { ExameDaLista } from '@/db/schema/exames-catalogo';
import { normalizarNome } from '@/modules/ia/correspondencia';
import { LISTA_DE_EXAMES_MAX, MSG_EXAMES, NOME_MAX } from '@/modules/exames/constantes';
import { DocumentoError } from './erros';
import type { CopiaDoDocumento } from './perfil-profissional';

/**
 * Plano 22 (RN-388, RN-389, EP-D1 a EP-D7, EP-D47): a solicitação de exames laboratoriais — conteúdo, Zod e textos.
 * PURO (sem import do servidor; guarda em `src/modules/exames/puros.test.ts`): o editor valida no cliente. O tipo só
 * ganha rótulo, união de tipos e telas na T7/T8 (PR 4, EP-D49). Sem campo de laboratório, link ou data livre (EP-D2):
 * o Zod **não** usa `.strict()` (strip, como `validarRascunho` da receita), então `laboratorio` some da saída.
 */
export { DECLARACAO_SOLICITACAO } from './constantes';

/** Spec §6.2, linhas "Solicitação" e "Solicitação: erros" (rascunho para a Debby e o `revisor-interface`). */
export const MSG_SOLICITACAO = {
  nova: 'Nova solicitação de exames',
  titulo: 'Solicitação de exames laboratoriais',
  exames: 'Exames',
  adicionarDoCatalogo: 'Adicionar do catálogo',
  adicionarForaDoCatalogo: 'Adicionar exame fora do catálogo',
  ajudaForaDoCatalogo: 'Só exames laboratoriais (Lei nº 8.234/1991, art. 4º, VIII).',
  carregarModelo: 'Carregar modelo',
  acrescentar: 'Acrescentar',
  substituir: 'Substituir',
  confirmarSubstituir: (n: number) => `Substituir os ${n} exames da solicitação pelos do modelo?`,
  removerTodos: 'Remover todos',
  indicacao: 'Indicação clínica (opcional)',
  indicacaoLinhaFixa: 'Descreva a finalidade nutricional; não afirme doença.',
  orientacoes: 'Orientações ao paciente (opcional)',
  ajudaOrientacoes: 'Preparo, jejum, horário. Aparecem no pedido.',
  avisoPlanos: 'Planos de saúde podem recusar pedido de exame feito por nutricionista.',
  lancarResultados: 'Lançar resultados',
  examesSolicitadosEm: (data: string) => `Exames solicitados em ${data}`,
  erros: {
    semExames: 'Inclua ao menos um exame.',
    max: 'A solicitação pode ter até 40 exames.',
    nome: 'O nome do exame tem de 1 a 80 caracteres.',
    repetido: 'Este exame já está na lista.',
    indicacao: 'A indicação clínica tem no máximo 500 caracteres.',
    orientacoes: 'As orientações têm no máximo 1000 caracteres.',
  },
} as const;

export const INDICACAO_MAX = 500;
export const ORIENTACOES_SOLICITACAO_MAX = 1000;

export type ConteudoSolicitacao = {
  versao: 1;
  tipo: 'solicitacao_exames';
  exames: ExameDaLista[];
  indicacaoClinica: string | null;
  orientacoes: string;
  /** RN-395: conteúdo novo sempre em marcação mínima (`lerMarcacao`), nunca HTML. */
  orientacoesFormato: 'marcacao';
  /** RN-154: a cópia congelada no preparo. */
  copia?: CopiaDoDocumento;
  /** O texto da declaração confirmada no preparo (`DECLARACAO_SOLICITACAO`). */
  declaracao?: string;
};

/** Espaços repetidos viram um (o nome do exame é uma linha). */
const umaLinha = (s: string) => s.replace(/\u0000/g, '').trim().replace(/\s+/g, ' ');
/** Texto de várias linhas: sem NUL (o Postgres recusa), `\r\n` → `\n`, sem espaços nas pontas; as quebras ficam (marcação). */
export const textoLivre = (s: string) => s.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();

/**
 * A lista de exames da solicitação (RN-388) e do modelo de solicitação (RN-391): cada um com o nome (1 a 80, uma linha) e
 * `painel: true` só quando veio de um painel do catálogo; sem repetição normalizada (`normalizarNome`); de `min` a `max`.
 * Chaves a mais somem. Lança `DocumentoError` com a chave `exames` (ou `exames.<i>.nome`) e os textos da solicitação
 * (`para: 'solicitacao'`, padrão) ou do modelo (`para: 'modelo'`, `MSG_EXAMES.modelosSolicitacao.erros`).
 * `src/modules/exames/catalogo-regras.ts` reexporta.
 */
export function validarListaDeExames(input: unknown, o: { max: typeof LISTA_DE_EXAMES_MAX; min?: 0 | 1; para?: 'solicitacao' | 'modelo' }): ExameDaLista[] {
  const msg =
    o.para === 'modelo'
      ? { semExames: MSG_EXAMES.modelosSolicitacao.erros.semExames, max: MSG_EXAMES.modelosSolicitacao.erros.max, repetido: MSG_EXAMES.modelosSolicitacao.erros.exameRepetido }
      : MSG_SOLICITACAO.erros;
  const lista = Array.isArray(input) ? input : input == null ? [] : null;
  if (!lista) throw new DocumentoError({ exames: msg.semExames });
  if (lista.length < (o.min ?? 1)) throw new DocumentoError({ exames: msg.semExames });
  if (lista.length > o.max) throw new DocumentoError({ exames: msg.max });
  const vistos = new Set<string>();
  return lista.map((bruto, i) => {
    const b = (bruto ?? {}) as { nome?: unknown; painel?: unknown };
    const nome = typeof b.nome === 'string' ? umaLinha(b.nome) : '';
    if (!nome || nome.length > NOME_MAX) throw new DocumentoError({ [`exames.${i}.nome`]: MSG_SOLICITACAO.erros.nome });
    const chave = normalizarNome(nome) || nome.toLowerCase();
    if (vistos.has(chave)) throw new DocumentoError({ [`exames.${i}.nome`]: msg.repetido });
    vistos.add(chave);
    return b.painel === true ? { nome, painel: true } : { nome };
  });
}

const texto = (max: number, mensagem: string) =>
  z
    .unknown()
    .optional()
    .transform((v) => (typeof v === 'string' ? textoLivre(v) : ''))
    .pipe(z.string().max(max, mensagem));

const rascunho = z.object({
  exames: z.unknown().optional(),
  indicacaoClinica: texto(INDICACAO_MAX, MSG_SOLICITACAO.erros.indicacao),
  orientacoes: texto(ORIENTACOES_SOLICITACAO_MAX, MSG_SOLICITACAO.erros.orientacoes),
});

/** RN-388: o que o rascunho aceita (0 exames vale no rascunho). Indicação vazia vira `null`; formato sempre `'marcacao'`. */
export function validarRascunhoSolicitacao(input: unknown): ConteudoSolicitacao {
  const p = rascunho.safeParse(input ?? {});
  if (!p.success) {
    const e: Record<string, string> = {};
    for (const i of p.error.issues) e[i.path.join('.') || 'geral'] ??= i.message;
    throw new DocumentoError(e);
  }
  const exames = validarListaDeExames(p.data.exames, { max: LISTA_DE_EXAMES_MAX, min: 0 });
  return {
    versao: 1,
    tipo: 'solicitacao_exames',
    exames,
    indicacaoClinica: p.data.indicacaoClinica || null,
    orientacoes: p.data.orientacoes,
    orientacoesFormato: 'marcacao',
  };
}

/** RN-389: para preparar, ao menos um exame (o resto já foi conferido no rascunho). */
export function validarSolicitacaoParaPreparar(c: ConteudoSolicitacao): void {
  if (!c.exames.length) throw new DocumentoError({ exames: MSG_SOLICITACAO.erros.semExames });
  if (c.exames.length > LISTA_DE_EXAMES_MAX) throw new DocumentoError({ exames: MSG_SOLICITACAO.erros.max });
}
