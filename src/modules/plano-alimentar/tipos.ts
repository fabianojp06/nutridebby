import type { MedidaCaseira, MedidaDoItem, NutrientesCongelados } from '@/db/schema';
import type { Nutrientes100 } from '@/modules/alimentos/busca';
import type { Fonte, SeloDaFonte } from '@/modules/alimentos/fontes';
import type { MedidaDisponivel } from '@/modules/alimentos/medidas';

/** Só tipos: o editor (cliente) importa daqui sem puxar banco. */
export type StatusPlano = 'rascunho' | 'publicado' | 'arquivado';
/** `NutrientesCongelados` é o formato gravado em `meal_items.nutrientes`; para ler, `lerCongelados` (RN-237). */
export type { MedidaCaseira, MedidaDoItem, NutrientesCongelados };

export type ItemPlano = {
  id: string;
  foodId: string;
  nome: string;
  /** RN-230: de `foods.fonte` no rascunho; da cópia congelada no publicado. */
  fonte: Fonte;
  /** O selo da fonte (`seloDaFonte`). */
  origem: SeloDaFonte;
  porCem: Nutrientes100;
  /** Medidas disponíveis para trocar (só no rascunho; publicado = []). */
  medidas: MedidaDisponivel[];
  quantidadeG: number;
  medida: MedidaDoItem | null;
  medidaCaseiraTxt: string | null;
  substituiItemId: string | null;
};

/** US-054 (D13): receita sugerida na refeição — `disponivel` = publicada (a despublicada fica gravada como "Receita indisponível"). */
export type ReceitaDaRefeicao = { id: string; titulo: string; disponivel: boolean };

export type RefeicaoPlano = { id: string; nome: string; horario: string; observacao: string; itens: ItemPlano[]; receita?: ReceitaDaRefeicao };

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
  pdfStatus: 'pendente' | 'pronto' | 'falhou' | null;
  /** Caminho interno do arquivo: só no servidor (download por signFileUrl); nunca vai ao cliente (`PlanoDoCliente`). */
  pdfPath: string | null;
  refeicoes: RefeicaoPlano[];
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
  refeicoes: {
    id: string;
    nome: string;
    horario: string;
    observacao: string;
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
