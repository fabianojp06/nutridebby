import { EXAME_MAX_BYTES } from './exames-constantes';

/** Plano 12 (F3-04). Sem banco e sem Node: o formulário do portal (cliente), o painel e o worker usam. Textos da spec C v0.3. */
export const ENVIO_PDF_MAX_BYTES = EXAME_MAX_BYTES; // D13 = b: o mesmo da US-015 (20 MB)
export const ENVIO_FOTO_MAX_BYTES = 10 * 1024 * 1024; // D13 = b: o teto da foto do diário
export const ENVIO_TOTAL_MAX_BYTES = 30 * 1024 * 1024;
export const ENVIO_MAX_FOTOS = 5;
export const ENVIO_MAX_PAGINAS = 10;
/** RN-161: JPEG/PNG acima disto recusados pelo cabeçalho na rota (como a digitalizada, RN-157); o HEIC, no worker. */
export const ENVIO_MAX_PIXELS = 40_000_000;
/** D1 do plano: imagem dentro do PDF acima disto (declarado) recusa o PDF antes de decodificar. */
export const MAX_PIXELS_IMAGEM_PDF = 20_000_000;
export const ENVIO_LADO_MAX = 2000;
export const ENVIO_QUALIDADE_JPEG = 85; // PM-9 (D2)
export const ENVIOS_PENDENTES_MAX = 10; // D14 = a
export const ENVIOS_POR_DIA_MAX = 5; // D14 = a
export const NOME_ENVIO_MAX = 120;
export const OBSERVACAO_ENVIO_MAX = 500;
export const MOTIVO_RECUSA_TEXTO_MAX = 300;
export const ENVIO_EXPIRA_DIAS = 90; // D15 = b
export const ENVIO_LEMBRETE_DIAS = 30; // US-165
export const AVISO_EXAMES_INTERVALO_MS = 6 * 3600_000; // D16 = a
/** A lista do portal (`meusEnvios`, `situacoesDosMeusEnvios`): os mais recentes, até este teto (o "No app" conta igual, RN-279). */
export const ENVIOS_NA_LISTA_DO_PORTAL = 50;

export const STATUS_ENVIO = ['processando', 'recebido', 'aceito', 'recusado', 'cancelado', 'expirado', 'falhou'] as const;
export type StatusEnvio = (typeof STATUS_ENVIO)[number];
export const MOTIVOS_RECUSA = ['ilegivel', 'nao_e_exame', 'outra_pessoa', 'repetido', 'outro'] as const;
export type MotivoRecusa = (typeof MOTIVOS_RECUSA)[number];
export const MOTIVOS_FALHA_ENVIO = ['conversao', 'paginas', 'cota', 'interrompido'] as const;
export type MotivoFalhaEnvio = (typeof MOTIVOS_FALHA_ENVIO)[number];

/** RN-165 (D20 = a): o motivo que o paciente vê. */
export const ROTULO_MOTIVO_RECUSA: Record<MotivoRecusa, string> = {
  ilegivel: 'Arquivo ilegível',
  nao_e_exame: 'Não é um exame',
  outra_pessoa: 'Exame de outra pessoa',
  repetido: 'Exame repetido',
  outro: 'Outro motivo',
};

/** US-160 / US-161 (textos novos marcados: Desvio 7). */
export const MSG_ENVIO = {
  enviado: 'Exame enviado. Sua nutricionista vai revisar.',
  arquivos: 'Envie 1 PDF de até 20 MB ou até 5 fotos (JPEG, PNG ou HEIC) de até 10 MB cada, somando até 30 MB.',
  dataObrigatoria: 'Informe a data da coleta', // novo (molde de MSG_EXAME.data)
  dataFutura: 'A data não pode ser no futuro',
  dataConfira: 'Confira a data da coleta',
  nome: 'Use no máximo 120 caracteres.', // novo
  observacao: 'Use no máximo 500 caracteres.', // novo
  dicaObservacao: 'Ex.: exame pedido na consulta de setembro.',
  pendentes: 'Você já tem 10 exames aguardando sua nutricionista. Aguarde a revisão antes de enviar outros.',
  porDia: 'Você já enviou 5 exames hoje. Tente amanhã.',
  cota: 'Não foi possível enviar agora: o espaço de arquivos do consultório acabou. Avise sua nutricionista.',
  ocupado: 'Tente novamente em alguns instantes.',
  indisponivel: 'Conta temporariamente indisponível', // o mesmo do diário (paciente fora de "ativo")
  formulario: 'Formulário inválido.',
  aguarde: 'Aguarde o processamento terminar.',
  confirmarCancelar: 'Cancelar este envio? O arquivo será apagado.',
  nenhum: 'Nenhum exame enviado ainda.', // novo
} as const;

/** §6.2: o que o paciente vê de cada situação. */
export const SITUACAO = {
  processando: 'Processando…',
  recebido: 'Aguardando sua nutricionista',
  aceito: 'Recebido no seu prontuário',
  recusado: (motivo: string) => `Não aceito: ${motivo}`,
  expirado: 'Não revisado a tempo. Se ainda for útil, envie de novo.',
  falhou: 'Não conseguimos processar o arquivo. Tente enviar de novo.',
  falhouPaginas: 'O PDF tem mais de 10 páginas. Envie só as páginas com os resultados.',
  falhouCota: 'Não foi possível enviar agora: o espaço de arquivos do consultório acabou. Avise sua nutricionista.',
} as const;

/** US-162 a US-165 (lado da nutricionista; novos marcados). */
export const MSG_REVISAO = {
  jaRevisado: 'Este envio já foi revisado.',
  cancelado: 'Este envio foi cancelado pelo paciente.',
  naoEncontrado: 'Envio não encontrado.', // novo
  salvo: 'Exame salvo no prontuário.',
  escolhaMotivo: 'Escolha o motivo.', // novo
  motivoObrigatorio: 'Escreva o motivo para o paciente',
  recusado: 'Envio recusado.', // novo
  filaVazia: 'Nenhum exame aguardando revisão.', // novo
  selo: 'Enviado pelo paciente',
  noProntuario: (n: number) => `Exames enviados pelo paciente (${n})`,
  avisoEmail: 'Você tem exames novos enviados por pacientes para revisar.',
  lembrete30: 'Há exames enviados por pacientes aguardando revisão há mais de 30 dias.',
  pushNeutro: 'Há uma atualização para você no app.',
  configuracao: 'Receber exames enviados pelos pacientes pelo app',
  configuracaoSalva: 'Configuração salva.', // novo
} as const;

export function situacaoParaPaciente(e: { status: string; motivoRecusa: string | null; motivoRecusaTexto: string | null; motivoFalha: string | null }): string {
  switch (e.status) {
    case 'processando':
      return SITUACAO.processando;
    case 'recebido':
      return SITUACAO.recebido;
    case 'aceito':
      return SITUACAO.aceito;
    case 'recusado':
      return SITUACAO.recusado(
        e.motivoRecusa === 'outro' && e.motivoRecusaTexto ? e.motivoRecusaTexto : (ROTULO_MOTIVO_RECUSA[e.motivoRecusa as MotivoRecusa] ?? ROTULO_MOTIVO_RECUSA.outro),
      );
    case 'expirado':
      return SITUACAO.expirado;
    case 'falhou':
      return e.motivoFalha === 'paginas' ? SITUACAO.falhouPaginas : e.motivoFalha === 'cota' ? SITUACAO.falhouCota : SITUACAO.falhou;
    default:
      return '';
  }
}

/** §6.1: sem nome, o envio aparece como "Exame enviado em {data}" (`enviadoEm` já formatado, dd/mm/aaaa). */
export const nomeDoEnvio = (nome: string | null, enviadoEm: string): string => nome ?? `Exame enviado em ${enviadoEm}`;

/** Dias de calendário entre duas datas AAAA-MM-DD (no fuso de quem chamou). */
export const diasEntre = (de: string, ate: string): number => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);

/** US-162: "há {n} dias" (0 = "hoje", novo; 1 = "há 1 dia"). */
export const haDias = (n: number): string => (n <= 0 ? 'hoje' : n === 1 ? 'há 1 dia' : `há ${n} dias`);
