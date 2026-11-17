/**
 * RN-238/RN-239 (Plano 19, US-232/US-233): textos e limites dos perfis de referência. Sem banco: o formulário, o editor
 * do plano (cliente) e o salvamento importam daqui. Texto exato da spec (§5, §6.1) quando existe.
 */
import type { ValoresDaReferencia } from '../../db/schema/biblioteca-plano';

/** RN-238: nome de 1 a 80, fonte de 2 a 300; meta e máximo de 0 a 100000 (a faixa de `foods.micros`, MICRO_MAX). */
export const NOME_REFERENCIA_MAX = 80;
export const FONTE_REFERENCIA_MIN = 2;
export const FONTE_REFERENCIA_MAX = 300;
/** RN-239: nutrientes que o plano mostra no resumo ("Nutrientes do paciente"). */
export const MAX_NUTRIENTES_EXIBIDOS = 12;

export const MSG_REFERENCIAS = {
  titulo: 'Perfis de referência',
  descricao: 'Metas de nutrientes, com a fonte, para comparar nos planos.',
  novo: 'Novo perfil',
  vazio: 'Nenhum perfil cadastrado. A plataforma não traz valores de referência prontos: cadastre os que você usa, com a fonte.',
  nome: 'Informe o nome do perfil (até 80 caracteres).',
  nomeRepetido: 'Já existe um perfil com este nome.',
  fonte: 'Informe a fonte dos valores (ex.: DRI/IOM 2006, IN 75/2020 da ANVISA).',
  fonteLonga: 'A fonte pode ter até 300 caracteres.',
  semValor: 'Informe a meta ou o máximo de pelo menos um nutriente.',
  valor: 'Use um número de 0 a 100000.',
  metaAcimaDoMaximo: 'A meta não pode passar do máximo.',
  excluir: 'Excluir este perfil? Os rascunhos e modelos que o usam ficam sem perfil; os planos publicados mantêm a cópia.',
  naoEncontrado: 'Perfil não encontrado.',
  salvo: 'Perfil salvo.',
  /** US-232: "1 nutriente", "3 nutrientes" na lista. */
  contagem: (n: number) => `${n} ${n === 1 ? 'nutriente' : 'nutrientes'}`,
} as const;

/** O perfil como o editor do plano usa (lista do consultório no rascunho; a cópia congelada no publicado). */
export type ReferenciaParaPlano = { id: string; nome: string; fonte: string; valores: ValoresDaReferencia };

/** O `name` dos campos do formulário do perfil ("meta.ferro_mg", "maximo.ferro_mg"): o formulário e a action usam o mesmo. */
export const nomeDoCampoDaReferencia = (campo: 'meta' | 'maximo', chave: string) => `${campo}.${chave}`;
