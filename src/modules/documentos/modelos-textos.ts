/**
 * Plano 22 (T10a, US-379, RN-393, RN-394, §6.2): os textos e os grupos dos itens salvos e dos modelos de prescrição. Arquivo
 * puro, sem import: as telas e os diálogos da receita ('use client', T10b) o leem sem levar o servidor ao bundle; o módulo
 * do banco (`modelos.ts`) o reexporta.
 */

export const ITENS_SALVOS_MAX = 300;
export const MODELOS_PRESCRICAO_MAX = 100;
export const NOME_DO_ITEM_MAX = 80;

/** RN-393: "Suplementos" = `suplemento`; "Fitoterápicos" = os quatro tipos vegetais. */
export type GrupoDeItens = 'suplementos' | 'fitoterapicos';
export const TIPOS_DO_GRUPO = {
  suplementos: ['suplemento'],
  fitoterapicos: ['planta_cha', 'derivado_vegetal', 'fitoterapico', 'formula_fitoterapica'],
} as const satisfies Record<GrupoDeItens, readonly string[]>;

/** §6.2, linha "Itens salvos e modelos" (texto exato da spec); `erros` com as mensagens do módulo. */
export const MSG_MODELOS = {
  titulo: 'Itens salvos',
  secoes: { suplementos: 'Suplementos', fitoterapicos: 'Fitoterápicos', modelos: 'Modelos de prescrição' },
  novoItem: 'Novo item salvo',
  nomeDoItem: 'Nome do item salvo',
  itemSalvo: 'Item salvo.',
  salvarItem: 'Salvar item',
  adicionarItem: 'Adicionar item salvo',
  salvarComoModelo: 'Salvar como modelo',
  nomeDoModelo: 'Nome do modelo',
  avisoModelo: 'Retire dados do paciente antes de salvar. A justificativa de uso não vai para o modelo.',
  avisoItem: 'Retire dados do paciente antes de salvar.',
  modeloSalvo: 'Modelo salvo.',
  carregarModelo: 'Carregar modelo',
  acrescentar: 'Acrescentar aos itens',
  substituir: 'Substituir os itens',
  confirmarSubstituir: (n: number) => `Substituir os ${n} itens da receita pelos do modelo?`,
  passaDe20: 'Com este modelo a receita passaria de 20 itens. Use Substituir ou retire itens.',
  itemExcluido: 'Item excluído.',
  modeloExcluido: 'Modelo excluído.',
  confirmarExcluir: (nome: string) => `Excluir ${nome}? As receitas já emitidas não mudam.`,
  excluir: 'Excluir',
  cancelar: 'Cancelar',
  vazioItens: 'Nenhum item salvo. Salve um item da receita com Salvar item.',
  vazioModelos: 'Nenhum modelo de prescrição ainda. Salve um a partir de uma receita, com Salvar como modelo.',
  erros: {
    /** O mesmo texto do nome no catálogo (§6.2, "Catálogo: erros"). */
    nome: 'O nome tem de 1 a 80 caracteres.',
    itemRepetido: 'Já existe um item salvo com este nome.',
    modeloRepetido: 'Já existe um modelo com este nome.',
    /** Texto novo (rascunho para a Debby): o teto de 300 itens salvos por consultório (RN-393), no molde do catálogo cheio. */
    itensCheio: 'Os itens salvos chegaram ao limite de 300.',
    /** Texto novo (rascunho para a Debby): o teto de 100 modelos de prescrição por consultório (RN-394). */
    modelosCheio: 'Os modelos de prescrição chegaram ao limite de 100.',
    /** Texto novo (rascunho para a Debby), no molde de "Modelo não encontrado.". */
    itemNaoEncontrado: 'Item salvo não encontrado.',
    modeloNaoEncontrado: 'Modelo não encontrado.',
  },
} as const;
