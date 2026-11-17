import type { MacrosPrescritos, MedidaCaseira, MedidaDoItem, ReferenciaCongelada } from '@/db/schema';
import type { Nutrientes100 } from '@/modules/alimentos/busca';
import type { Fonte, SeloDaFonte } from '@/modules/alimentos/fontes';
import type { MedidaDisponivel } from '@/modules/alimentos/medidas';
import type { ChaveNutriente } from '@/modules/alimentos/nutrientes';
import type { TipoConteudo } from '@/modules/conteudo/constantes';
import type { MicrosPorCem } from './calculo';
import type { DiaDaSemana } from './dias';

/** Só tipos: o editor (cliente) importa daqui sem puxar banco. */
export type StatusPlano = 'rascunho' | 'publicado' | 'arquivado';
/** O formato gravado em `meal_items.nutrientes` fica no schema e só se lê por `lerCongelados` (RN-237, guarda em `congelados.test.ts`). */
export type { MacrosPrescritos, MedidaCaseira, MedidaDoItem };
/** RN-243 (Plano 19, D15): com alimentos e quantidades, ou texto livre por refeição. */
export type ModoPlano = 'calculado' | 'livre';

export type ItemPlano = {
  id: string;
  foodId: string;
  nome: string;
  /** RN-230: de `foods.fonte` no rascunho; da cópia congelada no publicado. */
  fonte: Fonte;
  /** O selo da fonte (`seloDaFonte`). */
  origem: SeloDaFonte;
  /**
   * RN-233: a tabela pública de onde o "Meu alimento" foi duplicado, da cópia congelada (rodapé "Fontes:" do PDF). Só no
   * publicado; ausente ou nulo no rascunho e no formato antigo.
   */
  fonteOrigem?: Fonte | null;
  porCem: Nutrientes100;
  /**
   * RN-235/RN-237: micros por 100 g — no rascunho, os de `foods.micros`; no publicado, a cópia congelada. Nulo = plano
   * publicado antes do Plano 19 ("Micronutrientes não registrados nesta versão do plano."). Só no painel: o portal
   * projeta o plano com as chaves dele (RN-240).
   */
  micros: MicrosPorCem | null;
  /** Medidas disponíveis para trocar (só no rascunho; publicado = []). */
  medidas: MedidaDisponivel[];
  quantidadeG: number;
  medida: MedidaDoItem | null;
  medidaCaseiraTxt: string | null;
  substituiItemId: string | null;
};

/** US-054 (D13): receita sugerida na refeição — `disponivel` = publicada (a despublicada fica gravada como "Receita indisponível"). */
export type ReceitaDaRefeicao = { id: string; titulo: string; disponivel: boolean };

/**
 * RN-252 (Plano 19, D23): item da lista de substituição ligada ao plano — a cópia congelada na ligação (nome, gramas,
 * medida caseira, fonte, versão da tabela, fonte de origem do "Meu alimento" duplicado e valores por 100 g). Não muda
 * quando a biblioteca muda; formato conferido por `lerCopiaDaLista` (`ligados.ts`).
 */
export type ItemDaListaLigada = {
  nome: string;
  quantidadeG: number;
  medidaCaseiraTxt: string | null;
  fonte: Fonte;
  fonteVersao: string | null;
  fonteOrigem: Fonte | null;
  porCem: Nutrientes100;
};
export type GrupoDaListaLigada = { nome: string; itens: ItemDaListaLigada[] };
/** RN-252: a lista ligada (`plano_listas_substituicao`). `listaOrigemId` = de qual lista da biblioteca veio ("Atualizar da biblioteca"). */
export type ListaLigada = { id: string; listaOrigemId: string | null; nome: string; orientacao: string; copiadaEm: string; grupos: GrupoDaListaLigada[] };
/**
 * RN-253 (D24): `publicado`; `nao_publicado` (rascunho, ou que a sessão não enxerga: "Não publicado — o paciente não
 * vê"); `excluido` (a ligação ficou com `content_id` nulo e o título copiado: "{título} (excluído)").
 */
export type SituacaoDoLigado = 'publicado' | 'nao_publicado' | 'excluido';
/**
 * RN-253: receita, orientação ou vídeo ligado ao plano (`plano_conteudos`). `titulo` é o atual do conteúdo, ou a cópia
 * feita na ligação quando a sessão não o enxerga ou ele foi excluído; `tipo` nulo nesses casos. A projeção do portal
 * só mostra os `publicado` (RN-240: a cópia do título nunca sai de conteúdo despublicado).
 */
export type ConteudoLigado = { id: string; contentId: string | null; titulo: string; tipo: TipoConteudo | null; situacao: SituacaoDoLigado };

export type RefeicaoPlano = {
  id: string;
  nome: string;
  horario: string;
  observacao: string;
  /** RN-246: dias em que a refeição vale (0 = domingo), em ordem. */
  diasSemana: DiaDaSemana[];
  /** RN-243: o texto da refeição no plano em texto livre (nulo no calculado ou ainda sem texto). */
  descricaoLivre: string | null;
  itens: ItemPlano[];
  receita?: ReceitaDaRefeicao;
};

export type PlanoCompleto = {
  id: string;
  patientId: string | null;
  isTemplate: boolean;
  titulo: string;
  metaKcal: number | null;
  energyCalcId: string | null;
  status: StatusPlano;
  versao: number;
  revisao: number;
  publicadoEm: string | null;
  mostrarCalorias: boolean;
  orientacoes: string;
  /** RN-243: `livre` = texto por refeição, sem itens. */
  modo: ModoPlano;
  /** RN-244: distribuição de macros em % do VET (só no modo livre). */
  macrosPrescritos: MacrosPrescritos | null;
  /** RN-238: perfil de referência do rascunho ou do modelo (a publicação zera; o publicado tem `referenciaCongelada`). */
  referenciaId: string | null;
  /** RN-238: a cópia do perfil feita na publicação (nula no rascunho e no publicado sem perfil). */
  referenciaCongelada: ReferenciaCongelada | null;
  /** RN-239: até 12 chaves do catálogo, mostradas em "Nutrientes do paciente". */
  nutrientesExibidos: ChaveNutriente[];
  /** RN-239 (D12): o PDF mostra os nutrientes escolhidos (só com `mostrarCalorias`). */
  mostrarMicrosPdf: boolean;
  pdfStatus: 'pendente' | 'pronto' | 'falhou' | null;
  /** Caminho interno do arquivo: só no servidor (download por signFileUrl); nunca vai ao cliente (`PlanoDoCliente`). */
  pdfPath: string | null;
  refeicoes: RefeicaoPlano[];
  /** RN-252 (Plano 19): as listas de substituição ligadas (cópias), na ordem em que foram ligadas. */
  listas: ListaLigada[];
  /** RN-253 (Plano 19): as receitas e materiais ligados, na ordem em que foram ligados. */
  conteudos: ConteudoLigado[];
  /**
   * Plano 14B (US-123): modelo sugerido pela IA — `sugestao` enquanto não aprovado ("Sugestão da IA — revise"),
   * a data da aprovação e os itens descartados do pacote (desvio 12). Nulo em modelo feito à mão e em plano de paciente.
   */
  origemIa: OrigemIaDoModelo | null;
  /**
   * Plano 14B (RN-117, D16): quando o rascunho do paciente nasceu de "Usar como rascunho" (ISO). O editor mostra "Criado
   * com apoio de IA"; publicado, o PDF e o portal mostram o selo. "Editar" o copia; modelos nunca o têm.
   */
  iaOrigemEm: string | null;
};

export type OrigemIaDoModelo = { sugestao: boolean; aprovadoEm: string | null; descartados: number };

/** O que o editor (cliente) e o JSON da API recebem: sem o caminho interno do PDF (`paraCliente`, carregar.ts). */
export type PlanoDoCliente = Omit<PlanoCompleto, 'pdfPath'> & { pdfPath?: never };

/** Conteúdo do rascunho no PUT do salvamento automático (D7). Quantidade e meta vão como texto digitado. */
export type RascunhoEnviado = {
  revisao: number;
  titulo: string;
  metaKcal: string;
  /** "Usar como meta do plano" (US-014 → P04-05): cálculo de gasto energético de onde veio a meta; null se digitada. */
  energyCalcId?: string | null;
  mostrarCalorias: boolean;
  orientacoes: string;
  /**
   * Plano 19 (RN-243/RN-244): ausentes = ficam como estão no banco (o editor de antes do Plano 19, numa aba aberta
   * durante o deploy, não os manda). `macrosPrescritos` com os três vazios = sem distribuição.
   */
  modo?: ModoPlano;
  macrosPrescritos?: { proteina: string | number; carboidrato: string | number; lipidio: string | number } | null;
  /** RN-238/RN-239: ausentes = ficam como estão. `referenciaId` nulo = "Sem perfil". */
  referenciaId?: string | null;
  nutrientesExibidos?: string[];
  mostrarMicrosPdf?: boolean;
  refeicoes: {
    id: string;
    nome: string;
    horario: string;
    observacao: string;
    /** RN-246: ausente = fica como está (refeição nova: os 7 dias). */
    diasSemana?: number[];
    /** RN-243: só no modo livre; ausente = fica como está. */
    descricaoLivre?: string | null;
    /** US-054: receita sugerida (id de conteúdo); ausente = sem sugestão. */
    recipeContentId?: string | null;
    itens: { id: string; foodId: string; quantidadeG: string; medida: MedidaDoItem | null; substituiItemId: string | null }[];
  }[];
};

/** Corpo do PUT do salvamento automático (D7): o conteúdo do rascunho e a chave de idempotência do envio. */
export type CorpoSalvamento = RascunhoEnviado & {
  /** uuid novo a cada PUT; o salvamento que dá certo o grava em `meal_plans.ultimo_envio`. */
  envio: string;
  /** Os `envio` sem resposta confirmada (rede, 5xx) desde a última confirmada, no máximo 20: se o último gravado no
   * plano é um deles, a revisão antiga da tela ainda vale. */
  enviosIncertos?: string[];
};
