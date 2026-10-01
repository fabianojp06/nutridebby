import type { MedidaCaseira, MedidaDoItem } from '@/db/schema';
import type { Nutrientes100 } from '@/modules/alimentos/busca';
import type { MedidaDisponivel } from '@/modules/alimentos/medidas';

/** Só tipos: o editor (cliente) importa daqui sem puxar banco. */
export type StatusPlano = 'rascunho' | 'publicado' | 'arquivado';
export type { MedidaCaseira, MedidaDoItem };

export type ItemPlano = {
  id: string;
  foodId: string;
  nome: string;
  origem: 'TACO' | 'Meu alimento';
  porCem: Nutrientes100;
  /** Medidas disponíveis para trocar (só no rascunho; publicado = []). */
  medidas: MedidaDisponivel[];
  quantidadeG: number;
  medida: MedidaDoItem | null;
  medidaCaseiraTxt: string | null;
  substituiItemId: string | null;
};

export type RefeicaoPlano = { id: string; nome: string; horario: string; observacao: string; itens: ItemPlano[] };

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
  pdfPath: string | null;
  refeicoes: RefeicaoPlano[];
};

/** Corpo do PUT do salvamento automático (D7). Quantidade e meta vão como texto digitado. */
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
    itens: { id: string; foodId: string; quantidadeG: string; medida: MedidaDoItem | null; substituiItemId: string | null }[];
  }[];
};
