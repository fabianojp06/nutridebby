/**
 * RN-250/RN-251 (Plano 19, US-237/US-238): textos e limites de "Minhas refeições" e das listas de substituição. Sem
 * banco: o editor do plano, os formulários da biblioteca (cliente) e os módulos importam daqui. Texto exato da spec
 * (§5, §6.1) quando existe.
 */
import type { TipoDeRefeicao } from './tipos-de-refeicao';
import type { ModoPlano } from './tipos';

/** RN-250: até 40 itens por minha refeição e 200 refeições salvas por consultório; nome de 1 a 60. */
export const MAX_ITENS_MINHA_REFEICAO = 40;
export const MAX_MINHAS_REFEICOES = 200;
export const NOME_MINHA_REFEICAO_MAX = 60;
/** RN-251: nome de 1 a 80 (único), orientação até 1000, até 20 grupos (nome 1 a 60) × 30 itens, 100 listas por consultório. */
export const NOME_LISTA_MAX = 80;
export const ORIENTACAO_LISTA_MAX = 1000;
export const NOME_GRUPO_MAX = 60;
export const MAX_GRUPOS_LISTA = 20;
export const MAX_ITENS_GRUPO = 30;
export const MAX_LISTAS = 100;

export const MSG_MINHAS_REFEICOES = {
  titulo: 'Minhas refeições',
  descricao: 'Refeições prontas para carregar nos planos.',
  salvar: 'Salvar como minha refeição',
  /** US-237: o título do diálogo aberto por "Salvar como minha refeição". */
  dialogo: 'Salvar refeição',
  carregar: 'Carregar minha refeição',
  incluirObservacao: 'Incluir a observação',
  aviso: 'Confira o nome e os itens: retire dados do paciente antes de salvar.',
  avisoObservacao: 'A observação pode ter dados do paciente. Revise antes de salvar.',
  salva: 'Refeição salva em Minhas refeições.',
  vazio: 'Nenhuma refeição salva. Use "Salvar como minha refeição" no editor do plano.',
  /** Sem texto na spec: os erros e confirmações abaixo seguem o tom dos de perfis de referência. */
  nome: 'Informe o nome da refeição (até 60 caracteres).',
  tipo: 'Escolha o tipo da refeição.',
  vazia: 'A refeição está vazia: inclua alimentos (ou o texto, no plano em texto livre) antes de salvar.',
  limiteItens: 'A refeição pode ter até 40 itens.',
  limiteConsultorio: 'O consultório pode ter até 200 refeições salvas. Exclua alguma em Minhas refeições para salvar outra.',
  naoEncontrada: 'Refeição não encontrada.',
  /** Refeição em texto livre num plano com alimentos: os alimentos não saem do texto (o editor nem a oferece). */
  soNoLivre: 'Esta refeição é em texto livre: carregue-a num plano em texto livre.',
  alterada: 'Refeição salva.',
  excluir: 'Excluir esta refeição? Os planos em que ela já foi carregada não mudam.',
  todosOsTipos: 'Todos os tipos',
  textoLivre: 'Texto livre',
  /** US-237: "Cerca de {kcal} kcal" na lista (valores atuais dos alimentos, RN-11). */
  kcal: (kcal: string) => `Cerca de ${kcal} kcal`,
  /** No editor, depois de carregar ("Almoço leve" entra no fim do plano). */
  carregada: (nome: string) => `${nome} foi carregada no plano.`,
} as const;

export const MSG_LISTAS = {
  titulo: 'Listas de substituição',
  descricao: 'Grupos de alimentos que se trocam entre si.',
  nova: 'Nova lista',
  vazio: 'Nenhuma lista cadastrada. A plataforma não traz listas prontas: monte as que você usa.',
  nome: 'Informe o nome da lista (até 80 caracteres).',
  nomeRepetido: 'Já existe uma lista com este nome.',
  orientacao: 'A orientação pode ter até 1000 caracteres.',
  grupoNome: 'Informe o nome do grupo (até 60 caracteres).',
  semGrupo: 'Inclua pelo menos um grupo com um alimento.',
  grupoVazio: 'Inclua pelo menos um alimento neste grupo.',
  limite: 'A lista pode ter até 20 grupos e 30 itens por grupo.',
  limiteConsultorio: 'O consultório pode ter até 100 listas. Exclua alguma para criar outra.',
  naoEncontrada: 'Lista não encontrada.',
  salva: 'Lista salva.',
  excluir: 'Excluir esta lista? Os planos em que ela já foi ligada mantêm a cópia.',
  sugerir: 'Sugerir equivalentes',
  adicionarGrupo: 'Adicionar grupo',
  /** "2 grupos · 7 itens" na lista. */
  contagem: (grupos: number, itens: number) => `${grupos} ${grupos === 1 ? 'grupo' : 'grupos'} · ${itens} ${itens === 1 ? 'item' : 'itens'}`,
} as const;

/** Uma minha refeição na lista da biblioteca e no "Carregar minha refeição" do editor; `kcal` nula no texto livre. */
export type MinhaRefeicaoDaLista = { id: string; nome: string; tipo: TipoDeRefeicao; horario: string; modo: ModoPlano; kcal: number | null };
export type ListaDaBiblioteca = { id: string; nome: string; grupos: number; itens: number };

/**
 * Item de minha refeição ou de lista como os formulários mandam (o mesmo formato do item do PUT do editor, D7):
 * `quantidadeG` como texto digitado, `medida` com a quantidade da medida caseira. `id` é da tela (chave dos erros e
 * alvo de `substituiItemId`); o módulo grava ids novos.
 */
export type ItemDaBibliotecaEnviado = { id: string; foodId: string; quantidadeG: string | number; medida: { nome: string; plural: string; gramas: number; qtd: number } | null; substituiItemId?: string | null };

/** "Salvar como minha refeição" (editor) e "Salvar" na página da refeição. */
export type MinhaRefeicaoEnviada = {
  nome: string;
  tipo: string;
  horario: string;
  observacao: string;
  modo: ModoPlano;
  descricaoLivre: string | null;
  itens: ItemDaBibliotecaEnviado[];
};

export type ListaEnviada = { nome: string; orientacao: string; grupos: { id: string; nome: string; itens: ItemDaBibliotecaEnviado[] }[] };
