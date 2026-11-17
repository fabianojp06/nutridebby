import { semValorNa } from '@/modules/alimentos/fontes';
import { rotuloDosDiasPorExtenso, type DiaDaSemana } from './dias';

export const QUANTIDADE_MIN = 0.1;
export const QUANTIDADE_MAX = 5000;
export const META_MIN = 500;
export const META_MAX = 10000;
/** RN-249 (Plano 19, D18): limites do editor e do salvamento (`estado.ts`, `rascunho.ts`). */
export const MAX_REFEICOES = 50;
export const MAX_ITENS = 400;
/** RN-249: todo o caminho da IA (formulário, validação da saída, ferramenta de cálculo) fica nos limites de antes. */
export const MAX_REFEICOES_RASCUNHO_IA = 15;
export const MAX_ITENS_RASCUNHO_IA = 200;
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
  limite: 'O plano pode ter até 50 refeições e 400 itens.',
  limiteRascunhoIa: 'O rascunho da IA pode ter até 15 refeições e 200 itens.',
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
  /** RN-237 (code review do PR #57): a versão da tabela congela no publicado; sem ela, o item não é publicado. Texto fora da spec. */
  publicarSemVersao: 'A versão da tabela da USDA ainda não foi registrada. Tire os alimentos da USDA para publicar.',
  /** RN-230: "Sem valor na {sigla}" pela fonte do item ou do ingrediente ("Sem valor na USDA"). */
  semValor: semValorNa,
  semPeso: 'Registre a antropometria para ver g/kg',
  /** RN-256: na tela "Salvar como modelo" (o modelo leva as observações e o texto livre, RNF-08). */
  modeloComTextos: 'Observações e textos das refeições vão para o modelo. Retire dados do paciente antes de salvar.',
  /** Plano 14B (RN-117, A-D13): o selo do plano publicado que nasceu da IA (PDF e portal) e a marca no editor. */
  seloIa: 'Elaborado com apoio de IA e revisado pela nutricionista',
  marcaIa: 'Criado com apoio de IA',
} as const;

/** RN-243–RN-245 (Plano 19, D15/D16): plano em texto livre. */
export const MSG_TEXTO_LIVRE = {
  macros: 'A soma de proteína, carboidrato e lipídio precisa dar 100%.',
  semTexto: (nome: string) => `A refeição "${nome}" está sem texto.`,
  /** Sem texto na spec para o modo livre ("Inclua pelo menos uma refeição com um alimento" fala de alimento). */
  publicarVazio: 'Inclua pelo menos uma refeição para publicar.',
  /** D31: aviso (não erro) na publicação sem VET; a nutricionista publica com "Publicar mesmo assim". */
  semVet: 'Registre o VET, a distribuição de macro e micronutrientes e as quantidades da prescrição no plano ou no atendimento.',
  /** RN-245 (US-235): o `confirm` da troca de modo no editor, só quando há o que perder. */
  paraLivre: 'Os alimentos de cada refeição viram texto e saem do plano. Continuar?',
  paraCalculado: 'O texto das refeições será apagado. Continuar?',
  /** RN-254: abaixo do rótulo da observação, do texto livre e da orientação da lista ligada. */
  apareceNoApp: 'Aparece para o paciente no app.',
} as const;

/** RN-246 (Plano 19, D17): dias da semana da refeição. */
export const MSG_DIAS = {
  nenhum: 'Escolha ao menos um dia da semana.',
  /** D31: aviso na publicação, na ordem seg…dom ("Domingo não tem refeições.", "Sábado e domingo não têm refeições."). */
  semRefeicao: (dias: readonly DiaDaSemana[]) => `${rotuloDosDiasPorExtenso(dias)} ${dias.length > 1 ? 'não têm' : 'não tem'} refeições.`,
  publicarMesmoAssim: 'Publicar mesmo assim',
  /** RN-247 (a): legenda do filtro de dias ("dom: sem refeições") e o painel em "Todos" com perfis diferentes. */
  semRefeicoes: (dias: string) => `${dias}: sem refeições`,
  escolhaUmDia: 'Escolha um dia para ver os detalhes.',
  /** RN-244: o fracionamento no PDF, por perfil de dia ("5 refeições por dia"). */
  refeicoesPorDia: (n: number) => `${n} ${n === 1 ? 'refeição' : 'refeições'} por dia`,
  /** Editor: a refeição que perdeu o dia do filtro fica na tela até o filtro mudar (o foco e o erro ao lado ficam). */
  foraDoFiltro: (dia: string) => `Não vale em ${dia}. Sai desta lista quando você trocar o filtro.`,
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
