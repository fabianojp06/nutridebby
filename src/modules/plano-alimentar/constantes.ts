export const QUANTIDADE_MIN = 0.1;
export const QUANTIDADE_MAX = 5000;
export const META_MIN = 500;
export const META_MAX = 10000;
export const MAX_REFEICOES = 15;
export const MAX_ITENS = 200;
export const MAX_TEXTO = 2000;
/** D7: envios sem resposta confirmada que o editor manda em `enviosIncertos`. */
export const MAX_ENVIOS_INCERTOS = 20;

export const MSG_PLANO = {
  quantidade: 'Quantidade deve estar entre 0,1 e 5000 g',
  meta: 'Meta deve estar entre 500 e 10000 kcal',
  calculo: 'Cálculo de gasto energético não encontrado.',
  titulo: 'Informe o título do plano (até 120 caracteres)',
  refeicaoNome: 'Informe o nome da refeição (até 60 caracteres)',
  horario: 'Horário inválido (use HH:MM)',
  alimento: 'Alimento não encontrado.',
  receita: 'Receita não encontrada.',
  substituicao: 'A substituição precisa estar ligada a um alimento principal da mesma refeição.',
  limite: 'O plano pode ter até 15 refeições e 200 itens.',
  texto: 'Texto muito longo (até 2000 caracteres).',
  conflito: 'Este plano foi alterado em outra aba. Recarregue a página para continuar.',
  invalido: 'Não foi possível salvar estes dados. Recarregue a página.',
  naoEncontrado: 'Plano não encontrado.',
  grande: 'Plano grande demais.',
  naoEditavel: 'Este plano já foi publicado e não pode ser alterado. Use "Editar" para criar uma nova versão.',
  naoPublicado: 'Esta versão não está mais publicada. Recarregue a página.',
  pdfPreparando: 'O PDF já está sendo preparado.',
  rascunhoExiste: 'Já existe um rascunho para este paciente.',
  publicarVazio: 'Inclua pelo menos uma refeição com um alimento para publicar.',
  publicarHorario: 'Informe o horário de todas as refeições.',
  publicarRefeicaoVazia: (nome: string) => `A refeição "${nome}" não tem alimentos.`,
  semValor: 'Sem valor na TACO',
  semPeso: 'Registre a antropometria para ver g/kg',
} as const;

/** Plano 14B (US-123, RN-125): textos do modelo sugerido (os mesmos de MSG_MODELOS_IA; repetidos aqui para o editor, que não importa o módulo da IA). */
export const MSG_MODELO_IA = {
  aprove: 'Aprove o modelo antes de usá-lo com pacientes.',
  marca: 'Sugestão da IA — revise',
  faixa: 'Modelo sugerido por inteligência artificial. Revise alimentos, quantidades e textos antes de aprovar. Depois de aprovado, o modelo é seu.',
  aprovar: 'Aprovar modelo',
  confirmarAprovar: 'Aprovar este modelo? Ele poderá ser usado com pacientes.',
  aprovadoEm: (data: string) => `Aprovado em ${data}`,
  descartados: (n: number) => `${n} itens sugeridos foram descartados por serem inválidos.`,
} as const;
