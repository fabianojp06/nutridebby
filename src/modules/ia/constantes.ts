/**
 * Plano 11 (spec v0.3): constantes da IA usadas pelo app, pelo worker e pelos componentes 'use client'. Sem imports.
 * Textos com o texto exato da spec (US-101 a US-112, RN-112).
 */
export const MODELOS_IA = ['claude-opus-5-5', 'claude-sonnet-5-5'] as const;
export type ModeloIA = (typeof MODELOS_IA)[number];
export const GEOS_IA = ['us', 'global'] as const;
export type GeoIA = (typeof GEOS_IA)[number];

export const TIPOS_TAREFA = ['leitura_exame'] as const;
export type TipoTarefa = (typeof TIPOS_TAREFA)[number];
export const STATUS_TAREFA = ['na_fila', 'processando', 'pronta', 'falhou', 'aplicada', 'descartada', 'expirada', 'cancelada'] as const;
export type StatusTarefa = (typeof STATUS_TAREFA)[number];
export const EM_ANDAMENTO: readonly StatusTarefa[] = ['na_fila', 'processando'];

export const MOTIVOS_FALHA = [
  'provedor_indisponivel', 'resultado_incerto', 'recusa', 'resposta_invalida', 'documento_nao_reconhecido', 'nada_encontrado',
  'interrompida', 'cota', 'teto_plataforma', 'ia_desligada', 'credencial_invalida', 'paciente_indisponivel',
  'paciente_nao_informado', 'arquivo_invalido', 'laudo_longo', 'pdf_com_senha', 'exame_indisponivel',
] as const;
export type MotivoFalha = (typeof MOTIVOS_FALHA)[number];

/** A-D14 = (b). */
export const LIMITE_PAGINAS = 15;
/** §5.3 / exportação do titular (T15): para quem o laudo saiu. Em produção o único provedor é a Anthropic (A-D1, A-D5). */
export const PROVEDOR_IA_DESCRICAO = 'Anthropic (Claude), Estados Unidos';
/** A-D15 = (b): sugestão não aplicada vence em 7 dias (RN-106). */
export const PRAZO_SUGESTAO_DIAS = 7;
/** A-D10 = (a). */
export const COTA_PADRAO_USD = 15;
/** RN-111. */
export const MAX_LINHAS_SUGESTAO = 150;
/** US-015 / RN-114. */
export const MAX_VALORES_EXAME = 50;
/** D17 (RNF-101): tamanho máximo do laudo que vai à IA (o mesmo EXAME_MAX_BYTES; reduzir para 10 MB se o teste de memória da T5 falhar). */
export const IA_ARQUIVO_MAX_BYTES = 20 * 1024 * 1024;
/** RNF-100: o painel consulta o estado a cada 3 s. */
export const POLL_IA_MS = 3000;
/**
 * Revisão final: depois das primeiras 60 consultas (3 min), a leitura pode ainda estar na fila (um job por vez para todos
 * os consultórios) ou repetindo depois de 429/529 (RN-105). O painel segue consultando a cada 15 s até a tarefa não poder
 * mais estar em andamento: 30 min na fila + 15 min em processamento + 15 min até a varredura (`expirar-ia`) = 60 min.
 */
export const POLL_IA_RAPIDO_VEZES = 60;
export const POLL_IA_LENTO_MS = 15_000;
export const ACOMPANHAR_IA_MAX_MS = 60 * 60_000;

const PROVEDOR_FORA = 'Não foi possível ler o laudo agora. Tente de novo em alguns minutos ou lance os valores manualmente.';
const INDISPONIVEL = 'A IA está indisponível no momento. Você pode continuar sem ela.';
const NAO_CONSEGUIU = 'A IA não conseguiu ler este arquivo. Lance os valores manualmente.';

export const MSG_IA = {
  faixaLeitura:
    'Sugestão gerada por inteligência artificial. Ela pode errar: confira com o laudo antes de salvar. A responsabilidade pelas informações do prontuário é da nutricionista.',
  indisponivel: INDISPONIVEL,
  lendo: 'Lendo o laudo… isso leva até 1 minuto.',
  emAndamento: 'A leitura deste laudo já está em andamento.',
  muitosPedidos: 'Muitos pedidos à IA em pouco tempo. Tente de novo em alguns minutos.',
  cotaAcabou: 'O limite de uso da IA deste mês acabou. Ele renova no dia 1º ou quando o suporte ampliar o limite.',
  aviso80: 'Você já usou 80% do limite de IA deste mês.',
  semCiencia: 'Antes de usar a IA, informe o paciente (Privacidade > Uso de IA).',
  recusou: 'Este paciente pediu para não usar IA com os dados dele.',
  aditivoDesatualizado: 'Para continuar usando a IA, aceite a versão atual do aditivo de inteligência artificial.',
  naoLiberada: 'A IA ainda não foi liberada para o seu consultório.',
  iaAtivada: 'IA ativada.',
  usoDoMes: (p: number) => `Uso da IA neste mês: ${p}% do limite`,
  naoInformado: 'Este paciente ainda não foi informado sobre o uso de IA.',
  avisoEnviado: 'Aviso enviado. A IA fica liberada para este paciente quando o e-mail for entregue.',
  aguardandoEntrega: (data: string) => `Aviso enviado em ${data}; aguardando a entrega.`,
  informado: (data: string, canal: string, versao: string) => `Informado em ${data} (${canal}, versão ${versao}).`,
  valoresSalvos: 'Valores salvos.',
  naoNumerico: 'Valor não numérico: edite ou deixe desmarcado',
  ambiguo: 'Confira o valor: o ponto pode ser de milhar ou decimal. Edite o valor.',
  jaLancado: 'Já lançado neste exame',
  nomeAjustado: 'Nome ajustado para a série existente — confira',
  dataColeta: (data: string) => `A data da coleta no laudo é ${data}.`,
  usarData: 'Usar esta data ao salvar',
  limiteLinhas: (n: number) => `Um exame pode ter no máximo 50 valores. Desmarque ${n} linhas.`,
  indisponivelSugestao: 'Esta sugestão não está mais disponível.',
  nadaMarcado: 'Marque ao menos uma linha para salvar.',
  dataInvalida: 'A data da coleta do laudo não pode ser usada.',
  descartadas: (n: number) => `${n} linhas foram descartadas por estarem fora do formato.`,
} as const;

/** RN-112: o texto de cada motivo de falha (texto da US-112, US-110, US-102 e US-104). */
export const MSG_FALHA: Record<MotivoFalha, string> = {
  provedor_indisponivel: PROVEDOR_FORA,
  resultado_incerto: PROVEDOR_FORA,
  interrompida: PROVEDOR_FORA,
  credencial_invalida: PROVEDOR_FORA,
  recusa: NAO_CONSEGUIU,
  resposta_invalida: NAO_CONSEGUIU,
  documento_nao_reconhecido: 'Este arquivo não parece um laudo de exame.',
  nada_encontrado: 'A IA não encontrou valores neste laudo. Lance os valores manualmente.',
  arquivo_invalido: 'Não foi possível preparar este arquivo para a IA. Lance os valores manualmente.',
  laudo_longo: `O laudo tem mais de ${LIMITE_PAGINAS} páginas. Envie só as páginas com os resultados.`,
  pdf_com_senha: 'Este PDF está protegido por senha. Envie uma cópia sem senha.',
  cota: MSG_IA.cotaAcabou,
  teto_plataforma: INDISPONIVEL,
  ia_desligada: INDISPONIVEL,
  paciente_nao_informado: MSG_IA.semCiencia,
  paciente_indisponivel: 'Este paciente não pode usar a IA agora (bloqueado, arquivado ou com recusa de IA).',
  exame_indisponivel: 'Este exame não está mais disponível.',
};
