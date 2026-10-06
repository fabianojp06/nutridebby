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
