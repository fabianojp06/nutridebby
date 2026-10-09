/**
 * Plano 11 (spec v0.3): constantes da IA usadas pelo app, pelo worker e pelos componentes 'use client'. Sem imports.
 * Textos com o texto exato da spec (US-101 a US-112, RN-112).
 */
export const MODELOS_IA = ['claude-opus-5-5', 'claude-sonnet-5-5'] as const;
export type ModeloIA = (typeof MODELOS_IA)[number];
export const GEOS_IA = ['us', 'global'] as const;
export type GeoIA = (typeof GEOS_IA)[number];
/** Plano 14A (§5.5, D5): a região efetiva da chamada — `us`/`global` na API direta (IA_INFERENCE_GEO), `eu` no perfil eu. do Bedrock. */
export const REGIOES_IA = ['us', 'global', 'eu'] as const;
export type RegiaoIA = (typeof REGIOES_IA)[number];

export const TIPOS_TAREFA = ['leitura_exame'] as const;
export type TipoTarefa = (typeof TIPOS_TAREFA)[number];
export const STATUS_TAREFA = ['na_fila', 'processando', 'pronta', 'falhou', 'aplicada', 'descartada', 'expirada', 'cancelada'] as const;
export type StatusTarefa = (typeof STATUS_TAREFA)[number];
export const EM_ANDAMENTO: readonly StatusTarefa[] = ['na_fila', 'processando'];

/**
 * Plano 14A (RN-107, A-D24): os usos que a coluna `usos` aceita (o CHECK do banco já prevê os da 14B). F2 (§18.5): a
 * versão 0.1 do texto autoriza só `leitura_laudos` (AUTORIZACAO_IA_USOS, em textos-legais.ts); resumo e rascunho entram
 * com a 14B, numa versão nova do texto que pede autorização nova (RN-109).
 */
export const USOS_IA = ['leitura_laudos', 'resumo_historico', 'rascunho_plano'] as const;
export type UsoIA = (typeof USOS_IA)[number];
/** O uso que cada tipo de tarefa pede na RN-100 (a 14B acrescenta resumo e rascunho). */
export const USO_DA_TAREFA: Record<TipoTarefa, UsoIA> = { leitura_exame: 'leitura_laudos' };

/** Plano 14A (RN-109): o destino em código estável (o banco guarda o código; telas, textos e exportação, o rótulo). */
export const DESTINOS_IA = ['anthropic-us', 'bedrock-eu', 'teste'] as const;
export type DestinoIA = (typeof DESTINOS_IA)[number];
export const DESTINO_ROTULO: Record<DestinoIA, string> = {
  'anthropic-us': 'Anthropic (Claude), Estados Unidos',
  'bedrock-eu': 'Amazon Web Services (Claude), União Europeia',
  teste: 'Provedor de teste',
};
/** US-113: a tarefa antiga com `saiu_em` e sem `destino` saiu pelo único provedor do Plano 11. */
export const ROTULO_DESTINO_LEGADO = DESTINO_ROTULO['anthropic-us'];
/** IA_PROVEDOR (spec §12). `sandbox` e `fake` têm o destino de teste (RNF-107): autorização dada com eles não vale em outro. */
export const PROVEDORES_IA = ['anthropic', 'bedrock-eu', 'sandbox', 'fake'] as const;
export type ProvedorConfigurado = (typeof PROVEDORES_IA)[number];
export const DESTINO_DO_PROVEDOR: Record<ProvedorConfigurado, DestinoIA> = { anthropic: 'anthropic-us', 'bedrock-eu': 'bedrock-eu', sandbox: 'teste', fake: 'teste' };
/** INT-08 / D3: modelos do perfil `eu.` liberados (o Haiku 5.5 só entra com avaliação). */
export const MODELOS_BEDROCK_EU: readonly ModeloIA[] = ['claude-sonnet-5-5'];
/** INT-08: regiões da UE para o cliente do Bedrock (Londres, eu-west-2, e Zurique, eu-central-2, não são UE). */
export const REGIOES_BEDROCK_EU = ['eu-central-1', 'eu-west-1', 'eu-west-3', 'eu-north-1', 'eu-south-1', 'eu-south-2'] as const;
export type RegiaoBedrock = (typeof REGIOES_BEDROCK_EU)[number];

/** RN-107: eventos e canais da autorização. */
export const EVENTOS_AUTORIZACAO = ['autorizou', 'retirou', 'pedido_email'] as const;
export type EventoAutorizacao = (typeof EVENTOS_AUTORIZACAO)[number];
export const CANAIS_AUTORIZACAO = ['app', 'link', 'papel', 'nutricionista'] as const;
export type CanalAutorizacao = (typeof CANAIS_AUTORIZACAO)[number];
/** US-105: como o canal aparece na tela. */
export const CANAL_ROTULO: Record<CanalAutorizacao, string> = { app: 'app', link: 'link por e-mail', papel: 'termo em papel', nutricionista: 'a pedido, pela nutricionista' };
/** US-107: o link do pedido vale 7 dias; US-105: o alerta de e-mail trocado olha os pedidos dos 30 dias anteriores. */
export const VALIDADE_PEDIDO_MS = 7 * 86_400_000;
export const JANELA_EMAIL_TROCADO_MS = 30 * 86_400_000;
/** US-108: a foto ou o PDF do termo assinado, até 20 MB (como o laudo, EXAME_MAX_BYTES). */
export const TERMO_MAX_BYTES = 20 * 1024 * 1024;

export const MOTIVOS_FALHA = [
  'provedor_indisponivel', 'resultado_incerto', 'recusa', 'resposta_invalida', 'documento_nao_reconhecido', 'nada_encontrado',
  'interrompida', 'cota', 'teto_plataforma', 'ia_desligada', 'credencial_invalida', 'paciente_indisponivel',
  'paciente_nao_informado', 'arquivo_invalido', 'laudo_longo', 'pdf_com_senha', 'exame_indisponivel', 'sem_autorizacao',
] as const;
export type MotivoFalha = (typeof MOTIVOS_FALHA)[number];

/** A-D14 = (b). */
export const LIMITE_PAGINAS = 15;
/** A-D15 = (b): sugestão não aplicada vence em 7 dias (RN-106). */
export const PRAZO_SUGESTAO_DIAS = 7;
/** A-D10 = (a). */
export const COTA_PADRAO_USD = 15;
/** RN-104 / D3: os valores em US$ viram micro-dólares inteiros (cota, teto da plataforma, custo). */
export const MICRO = 1_000_000;
export const usdParaMicro = (usd: number) => Math.round(usd * MICRO);
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
  jaTemSugestao: 'Este exame já tem uma sugestão da IA. Confira ou descarte a sugestão antes de pedir outra leitura.',
  muitosPedidos: 'Muitos pedidos à IA em pouco tempo. Tente de novo em alguns minutos.',
  cotaAcabou: 'O limite de uso da IA deste mês acabou. Ele renova no dia 1º ou quando o suporte ampliar o limite.',
  aviso80: 'Você já usou 80% do limite de IA deste mês.',
  semCiencia: 'Antes de usar a IA, informe o paciente (Privacidade > Uso de IA).',
  recusou: 'Este paciente pediu para não usar IA com os dados dele.',
  // Plano 14A (US-105, US-110): os botões de IA do paciente sem autorização vigente
  semAutorizacao: 'Antes de usar a IA, peça a autorização do paciente (Privacidade > Uso de IA).',
  retirouAutorizacao: 'Este paciente retirou a autorização para o uso de IA.',
  aditivoDesatualizado: 'Para continuar usando a IA, aceite a versão atual do aditivo de inteligência artificial.',
  naoLiberada: 'A IA ainda não foi liberada para o seu consultório.',
  iaAtivada: 'IA ativada.',
  usoDoMes: (p: number) => `Uso da IA neste mês: ${p}% do limite`,
  naoInformado: 'Este paciente ainda não foi informado sobre o uso de IA.',
  // decisão do dono (07/10/2026): a ciência vale quando o provedor de e-mail aceita o envio (não há confirmação de entrega)
  avisoEnviado: 'Aviso enviado. A IA fica liberada para este paciente quando o e-mail for enviado.',
  aguardandoEnvio: (data: string) => `Aviso pedido em ${data}; aguardando o envio do e-mail.`,
  informado: (data: string, canal: string, versao: string) => `Informado em ${data} (${canal}, versão ${versao}).`,
  valoresSalvos: 'Valores salvos.',
  naoNumerico: 'Valor não numérico: edite ou deixe desmarcado',
  ambiguo: 'Confira o valor: o ponto ou a vírgula pode ser de milhar ou decimal. Edite o valor.',
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
  // RN-112 (Plano 14A): o texto novo (a recusa virou a retirada da autorização) e o motivo novo
  paciente_indisponivel: 'Este paciente não pode usar a IA agora (bloqueado, arquivado ou anonimizado).',
  sem_autorizacao: 'A autorização do paciente para o uso de IA não está em vigor.',
  exame_indisponivel: 'Este exame não está mais disponível.',
};

/** Plano 14A (US-105 a US-109): textos da autorização no painel, no app e no link (texto exato da spec v0.5.1). */
export const MSG_AUTORIZACAO = {
  // US-105 (painel, aba Privacidade, seção "Uso de IA")
  naoAutorizou: 'Ainda não autorizou.',
  explicacao: 'A IA só pode ser usada com os dados deste paciente depois que ele autorizar. Recusar não muda nada no atendimento.',
  enviarPedido: 'Enviar pedido de autorização por e-mail',
  registrarPapel: 'Registrar termo em papel',
  verTexto: 'Ver o texto da autorização',
  dicaApp: 'O paciente também pode autorizar no app, em Eu › Privacidade.',
  autorizou: (data: string, canal: string, versao: string) => `Autorizou em ${data} (${canal}, versão ${versao}).`,
  verTermo: 'Ver termo assinado',
  registrarRetirada: 'Registrar retirada a pedido do paciente',
  retirou: (data: string) => `Retirou em ${data}.`,
  registros: 'Registros',
  registroAutorizou: (data: string, canal: string, versao: string) => `${data} — Autorizou (${canal}, versão ${versao})`,
  registroRetirou: (data: string, canal: string) => `${data} — Retirou (${canal})`,
  registroPedido: (data: string) => `${data} — Pedido enviado por e-mail`,
  versaoAntiga: (versao: string) => `Autorizou a versão ${versao}, que não vale mais. Peça uma nova autorização.`,
  destinoTrocado: (destino: string) => `Autorizou o envio para ${destino}. O destino mudou: peça uma nova autorização.`,
  pedidoEnviado: 'Pedido enviado. O link vale por 7 dias.',
  semEmail: 'Cadastre o e-mail do paciente para enviar o pedido.',
  pedidoAberto: (data: string) => `Já há um pedido por e-mail válido até ${data}. Aguarde a resposta do paciente ou registre o termo em papel.`,
  emailTrocado: 'Atenção: o e-mail do paciente mudou pouco antes desta autorização. Confirme com ele que foi ele quem autorizou.',
  confirmarRetiradaNutri: 'Registrar que o paciente retirou a autorização? A IA deixa de ser usada com os dados dele na hora.',
  /** Desvio 7 (texto novo): o texto da autorização cita o nome, o CRN e o contato da nutricionista. */
  perfilIncompleto: 'Complete seu perfil profissional (nome completo, CRN e e-mail de contato) em Configurações antes de pedir a autorização de IA.',
  // US-108 (termo em papel)
  imprimir: 'Imprimir termo',
  dataAssinatura: 'Data da assinatura',
  arquivoTermo: 'Foto ou PDF do termo assinado',
  codigoReferencia: (codigo: string) => `Código de referência: ${codigo}`,
  /** F5 (§18.5): o rodapé de todas as páginas do termo impresso (o número da página vem do CSS de impressão). */
  rodapeTermo: (codigo: string) => `Código de referência: ${codigo} — Página`,
  /** F5: a confirmação cobre todas as páginas. */
  confirmacaoPapel: (versao: string) => `Confirmo que o paciente assinou este termo, na versão ${versao}, e que o arquivo mostra todas as páginas e a assinatura.`,
  /** F5: a dica do campo do arquivo e a recomendação de guardar o original. */
  dicaArquivoTermo: 'Fotografe ou digitalize todas as páginas do termo, num arquivo só.',
  guardarOriginal: 'Guarde o original em papel na pasta do paciente até a anonimização dele e entregue ao paciente uma via.',
  /** F5: a linha da via do paciente, no fim do termo, acima da assinatura. */
  recebiVia: 'Recebi uma via deste termo.',
  salvar: 'Salvar',
  termoRegistrado: 'Termo registrado. Entregue ao paciente uma via do termo assinado.',
  faltouArquivo: 'Envie a foto ou o PDF do termo assinado.',
  faltouConfirmacao: 'Confirme que o paciente assinou o termo.',
  dataInvalida: 'Informe a data em que o paciente assinou o termo.',
  /**
   * Desvio 12 (texto novo, revisão da T5): a retirada registrada no dia da assinatura ou depois — um termo assinado antes
   * não desfaz a retirada (LGPD art. 8º, § 5º). Entra como cenário da US-108; vai à Debby e à revisão de interface.
   */
  retiradaDepoisDaData: 'O paciente retirou a autorização depois desta data. Imprima o termo de novo e peça uma nova assinatura.',
  /** Desvio 9 (texto novo): arquivo fora do formato ou do tamanho. */
  arquivoInvalido: 'Envie um arquivo JPEG, PNG ou PDF de até 20 MB.',
  nomePaciente: (nome: string) => `Nome do paciente: ${nome}`,
  campoData: 'Data: ____/____/______',
  campoAssinatura: 'Assinatura do paciente: ______________________',
  // US-106 (app, Eu › Privacidade e /p/perfil/ia)
  blocoTitulo: 'Uso de inteligência artificial (IA)',
  voceNaoAutorizou: 'Você ainda não autorizou.',
  lerEDecidir: 'Ler e decidir',
  autorizo: 'Autorizo o envio para fora do Brasil',
  agoraNao: 'Agora não',
  registradaApp: 'Autorização registrada. Você pode retirar quando quiser.',
  voceAutorizou: (data: string, versao: string) => `Você autorizou em ${data} (versão ${versao}).`,
  retirarAutorizacao: 'Retirar autorização',
  tudoBem: 'Tudo bem. Nada muda no seu atendimento.',
  textoMudou: 'O texto da autorização mudou. Leia e decida de novo.',
  // US-107 (link do e-mail)
  emailAssunto: (consultorio: string) => `${consultorio}: autorização para uso de inteligência artificial`,
  /** F4 (§18.5): na página do link, abaixo do título, e no e-mail do pedido. */
  autorizacaoPessoal: 'Esta autorização é pessoal. Se você recebeu este e-mail por engano, não toque em Autorizo.',
  /** F4: no e-mail de confirmação, acima do botão "Retirar a autorização". */
  seNaoFoiVoce: 'Se não foi você quem autorizou, toque em Retirar a autorização e avise sua nutricionista.',
  registradaLink: 'Autorização registrada. Você pode retirar quando quiser, pelo link do e-mail de confirmação, pelo app ou pedindo à sua nutricionista.',
  confirmacaoAssunto: 'Você autorizou o uso de inteligência artificial',
  retirarALink: 'Retirar a autorização',
  jaAutorizou: (data: string) => `Você já autorizou em ${data}.`,
  linkExpirado: 'Este link expirou. Peça um novo à sua nutricionista.',
  linkInvalido: 'Este link não é mais válido. Fale com sua nutricionista.',
  robo: 'Confirme que você não é um robô.',
  muitasTentativas: 'Muitas tentativas. Tente de novo em alguns minutos.',
  turnstileFora: 'Tente novamente em alguns minutos',
  /**
   * Texto novo (revisão da T6, I1; vai à Debby e à revisão de interface): o texto da autorização mudou entre a abertura da
   * página do link e o toque em "Autorizo" (deploy com outro provedor, versão ou usos). Nada é gravado.
   */
  textoMudouLink: 'O texto da autorização mudou. Recarregue a página e leia de novo.',
  // US-109 (retirada)
  confirmarRetirada: 'Retirar a autorização? A partir de agora, nenhum dado seu será enviado à IA. Isso não muda nada no seu atendimento.',
  retirada: 'Autorização retirada.',
  voceRetirou: (data: string) => `Você retirou a autorização em ${data}.`,
  naoVigente: 'Esta autorização já não está em vigor.',
} as const;
