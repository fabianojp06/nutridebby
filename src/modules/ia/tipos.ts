/**
 * Plano 11 (spec v0.3, RN-111): a sugestão da leitura de laudo, como fica em `ia_tarefas.resultado` (dado de saúde, só
 * até ser aplicada, descartada, cancelada ou vencer — RN-106). Sem imports: o schema do banco e os componentes do painel
 * importam daqui.
 */
export type LinhaSugerida = {
  /** `nome_no_laudo`, limpo (sem URL nem caractere de controle), ≤ 80. */
  nome: string;
  /** Exatamente como impresso (≤ 40); o número sai de `lerValorLaudo`, nunca do modelo. */
  valorTexto: string;
  unidade: string | null;
  referencia: string | null;
  /** Página do laudo (1…n) ou null quando o modelo devolveu uma página que não existe. */
  pagina: number | null;
};

export type ResultadoLeitura = {
  versao: 1;
  /** AAAA-MM-DD, só se o laudo trouxer a data da coleta e ela for uma data válida. */
  dataColeta: string | null;
  linhas: LinhaSugerida[];
  /** Linhas que vieram fora do formato (tamanho, campo vazio) e foram descartadas no worker. */
  descartadas: number;
};

/** Plano 14B (US-120, D13): as seções do resumo, na ordem da tela. */
export const SECOES_RESUMO = ['evolucao', 'exames', 'habitos', 'condutas'] as const;
export type SecaoResumo = (typeof SECOES_RESUMO)[number];
/** '#3' → 'antropometria de 01/09/2026' (sem id do banco). Reexportado por `resumo-dados.ts`. */
export type Fonte = { indice: string; rotulo: string };
/** 'Peso' → '82,4 kg em 01/06/2026 → 78,9 kg em 01/09/2026 (−3,5 kg)'. Reexportado por `resumo-dados.ts`. */
export type LinhaDadosUsados = { rotulo: string; texto: string };

/** O resumo como fica em ia_tarefas.resultado (dado de saúde, só até descartar, cancelar ou vencer — RN-106). */
export type ResultadoResumo = {
  tipo: 'resumo';
  versao: 1;
  secoes: { secao: SecaoResumo; frases: { texto: string; fontes: string[] }[] }[];
  /** Frases sem fonte, com fonte não enviada ou com interpretação de exame (D13), retiradas pelo worker. */
  retiradas: number;
  /** '#3' → 'antropometria de 01/09/2026' (sem id do banco). */
  fontes: Fonte[];
  /** "Dados usados": as variações calculadas pelo sistema (US-120). */
  tabela: LinhaDadosUsados[];
};

/**
 * Plano 14B (RN-121, RN-124, D14): o plano que a IA sugere, já revalidado por `validarPlanoIa` (reexportados por
 * `plano-ia.ts`). Só ids REAIS de alimento e gramas — nunca nome nem número do modelo; totais, indicador e macros são
 * sempre do calculo.ts. `medida` tem a forma de `MedidaDoItem` (schema do plano), declarada aqui para o arquivo seguir
 * sem imports.
 */
export type ItemIa = { foodId: string; quantidadeG: number; medida: { nome: string; plural: string; gramas: number; qtd: number } | null; substitui: number | null };
export type RefeicaoIa = { nome: string; horario: string; itens: ItemIa[] };
export type PlanoIa = { titulo: string; metaKcal: number | null; orientacoes: string; refeicoes: RefeicaoIa[]; descartados: number };
/** O rascunho como fica em ia_tarefas.resultado (dado de saúde, só até usar, descartar, cancelar ou vencer — RN-106). */
export type ResultadoRascunho = { tipo: 'rascunho'; versao: 1; plano: PlanoIa };

/** O que `ia_tarefas.resultado` guarda: a leitura (Plano 11, sem `tipo`) ou o resumo/rascunho (Plano 14B, com `tipo`). */
export type ResultadoIa = ResultadoLeitura | ResultadoResumo | ResultadoRascunho;
/** A leitura de laudo só lê o resultado da leitura (o resumo e o rascunho têm `tipo`). */
export const ehLeitura = (r: ResultadoIa | null): r is ResultadoLeitura => !!r && !('tipo' in r);
