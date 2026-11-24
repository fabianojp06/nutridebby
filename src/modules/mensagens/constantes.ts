/**
 * Plano 25 (spec §6.2): textos de interface, limites e formatadores das Mensagens e dos Recados. Puro (sem banco nem
 * import de servidor): o painel e o portal (cliente) também usam. Os rótulos citados pelos guias do manual guiado ficam
 * aqui (src/modules/mensagens entra em TSX_FORA de src/modules/ajuda/conteudo.test.ts, T6a). Os rótulos do Histórico de
 * acessos ficam em src/modules/plataforma/audit.ts; os de `ROTULO_TIPO` das notificações, em src/modules/notificacoes (T4).
 */
import type { FormaTcle, RiscoChat } from '@/db/schema/mensagens';
import type { detectarRisco } from '@/modules/ia/nutri-paciente/sinais-risco';
import { partesNoFuso } from '@/modules/agenda/fuso';

// ——— Limites (RN-444, RN-447, RN-451, RN-454, RN-455, RN-458, RN-459, RN-462) ———
/** Texto da mensagem: 1 a 2.000 caracteres sem espaços nas pontas (CHECK chat_mensagens_texto_tamanho). */
export const TEXTO_MAX = 2000;
/** Texto do recado: 1 a 1.000 caracteres (CHECK recados_texto_tamanho). */
export const RECADO_MAX = 1000;
/** Anexo da nutricionista e foto do paciente. */
export const ANEXO_MAX_BYTES = 10 * 1024 * 1024;
export const ANEXO_NOME_MAX = 120;
/** Envio do paciente (RN-447), contado em chat_mensagens do próprio paciente. */
export const LIMITE_MENSAGENS_HORA = 30;
export const LIMITE_MENSAGENS_DIA = 200;
export const LIMITE_FOTOS_DIA = 20;
/** Anexos da nutricionista por dia, por consultório (sob a trava `chat-anexos-tenant`). */
export const LIMITE_ANEXOS_NUTRI_DIA = 100;
/** Recados (RN-462): por dia no fuso, destinatários e etiquetas por recado. */
export const LIMITE_RECADOS_DIA = 10;
export const RECADO_MAX_DESTINATARIOS = 500;
export const RECADO_MAX_ETIQUETAS = 10;
/** Mensagens por página da conversa ("Ver mensagens anteriores", RN-446) e pacientes por página da "Nova conversa" (CH-D66). */
export const MENSAGENS_POR_PAGINA = 50;
export const PACIENTES_POR_PAGINA = 50;
/** Horário de atendimento (RN-451): faixas por dia, passo do `<select>`, fim do dia ("24:00"). */
export const MAX_FAIXAS_POR_DIA = 3;
export const PASSO_FAIXA_MIN = 15;
export const FIM_DO_DIA_MIN = 24 * 60;
/** Aviso por e-mail à nutricionista (RN-458): no máximo um a cada 2 h. */
export const JANELA_AVISO_NUTRI_MS = 2 * 60 * 60 * 1000;
/** E-mail ao paciente (RN-456): 30 min depois do push. */
export const ATRASO_EMAIL_PACIENTE_MS = 30 * 60 * 1000;
/** "Há novas?" (RN-452) e contador do menu (RN-459). */
export const SITUACAO_INTERVALO_MS = 15_000;
export const SITUACAO_INTERVALO_OCIOSO_MS = 60_000;
export const SITUACAO_OCIOSO_APOS_MS = 5 * 60_000;
export const CONTADOR_INTERVALO_MS = 60_000;

// ——— Risco (RN-449) ———
export type CodigoTextoFixo = NonNullable<ReturnType<typeof detectarRisco>>['textoFixo'];
/**
 * A mensagem grava o risco pelo **texto fixo** de detectarRisco, não pelo grupo: o grupo junta sintoma agudo e autolesão
 * em `emergencia`, e o socorro mostrado ao paciente é diferente para cada um.
 */
export const RISCO_DO_TEXTO_FIXO = {
  risco_emergencia: 'emergencia',
  sintoma_agudo: 'sintoma_agudo',
  risco_transtorno: 'transtorno_alimentar',
} as const satisfies Record<CodigoTextoFixo, RiscoChat>;

/** §6.2 "Portal: socorro": o aviso do app logo abaixo da mensagem com risco (não é mensagem da nutricionista). */
export const SOCORRO_DO_RISCO: Record<RiscoChat, string> = {
  emergencia:
    'Se você está pensando em se machucar ou corre perigo agora, ligue para o CVV no 188 (gratuito, 24 horas; também há chat em cvv.org.br) ou para o SAMU no 192, ou vá ao pronto-socorro mais próximo. Sua nutricionista não acompanha as mensagens em tempo real.',
  sintoma_agudo:
    'Esses sinais precisam de atendimento médico agora. Ligue para o SAMU no 192 ou vá ao pronto-socorro mais próximo. Sua nutricionista não acompanha as mensagens em tempo real.',
  transtorno_alimentar:
    'Que bom que você contou. Sua mensagem foi enviada à sua nutricionista, que não acompanha as mensagens em tempo real. Se você sentir que está em perigo, ligue para o CVV no 188 (gratuito, 24 horas) ou para o SAMU no 192.',
};

/**
 * CH-D77 (revisão CFN da T7): o socorro junto ao campo quando o envio é RECUSADO (a mensagem não foi gravada). Nunca diz
 * "enviada": o de transtorno fica só com o trecho de perigo do texto aprovado; os de emergência e de sintoma agudo não falam
 * do envio e ficam iguais.
 */
export const SOCORRO_NA_RECUSA: Record<RiscoChat, string> = {
  emergencia: SOCORRO_DO_RISCO.emergencia,
  sintoma_agudo: SOCORRO_DO_RISCO.sintoma_agudo,
  transtorno_alimentar: 'Se você sentir que está em perigo, ligue para o CVV no 188 (gratuito, 24 horas) ou para o SAMU no 192.',
};

// ——— TCLE (RN-441, CH-D3) ———
/** As opções do diálogo de liberação, na ordem do `<select>` (sem a forma verbal: não deixa o comprovante). */
export const OPCOES_FORMA_TCLE: Record<FormaTcle, string> = {
  termo_assinado: 'Termo assinado (em papel ou digital)',
  aceite_escrito: 'Aceite por escrito (mensagem ou e-mail)',
};
/** A forma em "Liberada em {dd/mm/aaaa} ({forma})". */
export const ROTULO_FORMA_TCLE: Record<FormaTcle, string> = {
  termo_assinado: 'termo assinado',
  aceite_escrito: 'aceite por escrito',
};

// ——— Singulares ———
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);
const naoLidas = (n: number) => plural(n, '1 não lida', `${n} não lidas`);
const ariaMensagens = (n: number) => plural(n, 'Mensagens, 1 não lida', `Mensagens, ${n} não lidas`);
/** 1000 → "1.000" (sem depender do ICU do servidor). */
const milhar = (n: number) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** RN-471 (v0.4): `crn` já vem com o prefixo ("CRN-4 12345", `CRN_REGEX`): o modelo não repete "CRN". */
const carimbo = (nome: string, crn: string) => `${nome} · Nutricionista · ${crn}`;
const SEM_CARIMBO_ENVIO = 'Para enviar, preencha seu nome e seu CRN em Configurações.';
const FORMATO = 'Formato de arquivo não permitido.';
const TAMANHO = 'O arquivo passa de 10 MB.';
const FALHA = 'Não foi possível enviar. Tente de novo.';
const TEXTO_LONGO = 'A mensagem tem até 2.000 caracteres.';
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] as const;

/** §6.2: textos do painel da nutricionista. */
export const MSG_MENSAGENS = {
  menu: {
    rotulo: 'Mensagens',
    comContador: (n: number) => `Mensagens (${n})`,
    aria: ariaMensagens,
    abaConversas: 'Conversas',
    abaConversasComContador: (n: number) => `Conversas (${n})`,
    abaDuvidas: 'Dúvidas da IA Nutri',
    abaDuvidasComContador: (n: number) => `Dúvidas da IA Nutri (${n})`,
    abaRecados: 'Recados',
    /** §4.1: o `<nav>` das abas (caixa, fila de dúvidas e recados). */
    rotuloDasAbas: 'Seções de Mensagens',
  },
  caixa: {
    titulo: 'Mensagens',
    filtroTodas: 'Todas',
    filtroNaoLidas: 'Não lidas',
    /** §4.1: o `<nav>` das pílulas "Todas"/"Não lidas". */
    rotuloDoFiltro: 'Filtro das conversas',
    buscarPaciente: 'Buscar paciente',
    buscar: 'Buscar',
    novaConversa: 'Nova conversa',
    tipos: { mensagemDoPaciente: 'Mensagem do paciente', voceEnviou: 'Você enviou', imagem: 'Imagem', pdf: 'Arquivo PDF', recado: 'Recado' },
    naoLidas,
    seloRisco: 'Sinal de risco',
    vazio: 'Nenhuma conversa ainda. Para começar, toque em "Nova conversa" ou abra a ficha do paciente.',
    vazioDoFiltro: 'Nenhuma mensagem não lida.',
    mostrarMais: 'Mostrar mais',
  },
  novaConversa: {
    titulo: 'Nova conversa',
    buscarPaciente: 'Buscar paciente',
    buscar: 'Buscar',
    nenhum: 'Nenhum paciente encontrado.',
    semAcessoAoApp: 'Sem acesso ao app',
    mostrarMais: 'Mostrar mais',
  },
  conversa: {
    abrirFicha: 'Abrir ficha',
    verAnteriores: 'Ver mensagens anteriores',
    hoje: 'Hoje',
    ontem: 'Ontem',
    voce: 'Você',
    carimbo,
    enviada: 'Enviada',
    lida: 'Lida',
    recado: 'Recado',
    respostaADuvida: (data: string) => `Resposta à dúvida enviada pela IA Nutri em ${data}`,
    seloRisco: 'Sinal de risco',
    campo: 'Mensagem',
    anexarArquivo: 'Anexar arquivo',
    ajudaAnexo: 'Imagem (JPG, PNG ou HEIC) ou PDF, até 10 MB. Receita, parecer e plano alimentar vão por Documentos, assinados, não por aqui.',
    removerAnexo: 'Remover anexo',
    enviar: 'Enviar',
    enviando: 'Enviando…',
    novaMensagemDe: (primeiroNome: string) => `Nova mensagem de ${primeiroNome}.`,
    mostrarNovas: 'Mostrar novas mensagens',
    abrirAnexo: 'Abrir',
    arquivoPdf: (nome: string, tamanho: string) => `Arquivo PDF · ${nome} · ${tamanho}`,
    imagemProcessando: 'Imagem em processamento…',
    imagemFalhou: 'Não foi possível processar a imagem.',
  },
  erros: {
    semConteudo: 'Escreva a mensagem ou anexe um arquivo.',
    textoLongo: TEXTO_LONGO,
    formato: FORMATO,
    tamanho: TAMANHO,
    cota: 'Espaço de armazenamento esgotado. Fale com o suporte.',
    limiteAnexos: 'Você chegou ao limite de anexos de hoje. Tente de novo amanhã.',
    conversaFechada: 'A conversa foi pausada ou não está liberada. Recarregue a página para ver a situação.',
    semCarimbo: SEM_CARIMBO_ENVIO,
    falha: FALHA,
  },
  estados: {
    naoLiberada: (nome: string) => `A conversa com ${nome} ainda não foi liberada.`,
    semAcesso: (nome: string) =>
      `${nome} ainda não tem acesso ao app. As mensagens ficam guardadas e aparecem quando o acesso for ativado; até lá, o paciente não recebe aviso.`,
    arquivado: 'Paciente arquivado: a conversa fica só para consulta.',
    bloqueado: 'Pedido de exclusão atendido: a conversa fica só para consulta.',
    anonimizado: 'Paciente anonimizado: a conversa foi apagada junto com os dados do paciente.',
    seloPausada: 'Conversa pausada',
    liberadaEm: (data: string, forma: string) => `Liberada em ${data} (${forma})`,
  },
  liberacao: {
    botao: 'Liberar conversa',
    titulo: (nome: string) => `Liberar a conversa com ${nome}?`,
    texto:
      'A conversa por mensagens é atendimento a distância (telenutrição). Antes de liberar, explique ao paciente as possibilidades, os limites e as fragilidades do atendimento por mensagens e que as mensagens ficam guardadas no prontuário, colha a ciência e a concordância dele com o TCLE de telenutrição, envie a ele o comprovante e guarde uma cópia.',
    /** O mesmo texto da RN-404 do Plano 23, sem o número da resolução até o DOU ser conferido. */
    avisoENutricionista: 'Antes do primeiro atendimento online, faça o cadastro no e-Nutricionista e colha o TCLE de telenutrição, guardando o comprovante.',
    perguntaForma: 'Como o paciente (ou o responsável legal) concordou?',
    opcaoInicial: 'Escolha',
    confirmacao: 'O paciente, ou o responsável legal, deu ciência e concordou com o TCLE de telenutrição, e enviei a ele o comprovante.',
    liberar: 'Liberar',
    cancelar: 'Cancelar',
    erro: 'Escolha como o paciente concordou e marque a confirmação.',
    sucesso: 'Conversa liberada.',
    semCarimbo: 'Para liberar a conversa, preencha seu nome e seu CRN em Configurações.',
    /** CH-D75: o erro genérico do ato (não o do envio). */
    falha: 'Não foi possível liberar a conversa. Tente de novo.',
  },
  pausa: {
    botao: 'Pausar conversa',
    confirmar: (nome: string) =>
      `Pausar a conversa com ${nome}? O paciente continua vendo as mensagens, mas não envia novas. Combine com o paciente como o acompanhamento continua.`,
    pausar: 'Pausar',
    cancelar: 'Cancelar',
    sucesso: 'Conversa pausada.',
    retomar: 'Retomar conversa',
    retomada: 'Conversa retomada.',
    /** CH-D75: a pausa grava o nome e o CRN (CH-D74); sem o carimbo, este texto com o link ao Perfil. */
    semCarimbo: 'Para pausar a conversa, preencha seu nome e seu CRN em Configurações.',
    falha: 'Não foi possível pausar a conversa. Tente de novo.',
    falhaRetomar: 'Não foi possível retomar a conversa. Tente de novo.',
  },
  duvida: {
    /** CH-D45: h1, aba e o "Voltar para…" com um nome só. */
    nomeDaFila: 'Dúvidas da IA Nutri',
    voltar: 'Voltar para Dúvidas da IA Nutri',
    responderNaConversa: 'Responder na conversa',
    libereAntes: (nome: string) => `Para responder por mensagem, libere a conversa com ${nome}.`,
    faixa: (data: string) => `Respondendo à dúvida de ${data}`,
    verAPergunta: 'Ver a pergunta',
    abreEmNovaAba: 'abre em nova aba',
    dica: 'Para o prontuário, retome na resposta o que o paciente perguntou.',
    cancelarResposta: 'Cancelar resposta',
    respostaEnviada: 'Resposta enviada. A dúvida saiu da fila.',
    jaTratada: 'Esta dúvida já foi tratada.',
    indisponivel: 'Esta dúvida não está mais disponível.',
    respondidaEmMensagens: 'Respondida em Mensagens',
  },
  configuracao: {
    hubTitulo: 'Atendimento por mensagens',
    hubDescricao: 'Horário das mensagens e avisos por e-mail.',
    titulo: 'Atendimento por mensagens',
    mostrarHorario: 'Mostrar horário de atendimento aos pacientes',
    /** 0 = domingo … 6 = sábado (chat_horarios.dia_semana). */
    dias: DIAS,
    das: 'Das',
    as: 'Às',
    rotuloDas: (dia: string, k: number) => `${dia}, faixa ${k}, das`,
    rotuloAs: (dia: string, k: number) => `${dia}, faixa ${k}, às`,
    acrescentarFaixa: 'Acrescentar faixa',
    removerFaixa: 'Remover faixa',
    rotuloRemover: (k: number, dia: string) => `Remover faixa ${k} de ${dia}`,
    avisoEmail: 'Avisar por e-mail quando chegar mensagem de paciente',
    ajudaAviso: 'No máximo um e-mail a cada 2 horas, sem nome de paciente nem o texto. Fora do horário de mensagens, não avisamos.',
    salvar: 'Salvar',
    salva: 'Configuração salva.',
    /** CH-D76 (molde da CH-D75): o erro inesperado ao salvar (o que foi escolhido volta para a tela). */
    falha: 'Não foi possível salvar. Tente de novo.',
    fimAntesDoInicio: 'O fim tem de ser depois do início.',
    sobreposicao: 'As faixas do mesmo dia não podem se sobrepor.',
    faixasDemais: 'No máximo 3 faixas por dia.',
  },
  ficha: {
    secao: 'Mensagens',
    naoLidas,
    mensagemDoPaciente: 'Mensagem do paciente',
    mensagemEnviada: 'Mensagem enviada',
    recado: 'Recado',
    sinalDeRisco: 'Sinal de risco',
    enviarMensagem: 'Enviar mensagem',
  },
} as const;

/** §6.2: textos dos recados (painel). */
export const MSG_RECADOS = {
  titulo: 'Recados',
  novoRecado: 'Novo recado',
  colunas: { data: 'Data', recado: 'Recado', para: 'Para', lidoPor: 'Lido por' },
  lidoPorDe: (l: number, n: number) => `Lido por ${l} de ${n}`,
  paraTodos: 'Todos os pacientes com app',
  paraEtiquetas: (lista: string) => `Etiquetas: ${lista}`,
  paraLocal: (nome: string) => `Local: ${nome}`,
  vazio: 'Nenhum recado enviado.',
  legenda: 'Recados enviados',
  mostrarMais: 'Mostrar mais',
  novo: {
    titulo: 'Novo recado',
    paraQuem: 'Para quem',
    opcoes: { todos: 'Todos os pacientes com app', etiquetas: 'Pacientes com as etiquetas', local: 'Pacientes atendidos no local' },
    etiquetas: 'Etiquetas',
    local: 'Local',
    campo: 'Recado',
    ajuda:
      'Use para avisos do consultório (horários, feriados, mudanças). O mesmo texto vai para todos, no app. Não escreva dado de saúde, nome de paciente nem orientação de dieta, e nada de preço, desconto, promoção, sorteio ou marca de produto.',
    contador: (n: number) => `${milhar(n)}/${milhar(RECADO_MAX)}`,
    revisar: 'Revisar',
    vaiPara: (n: number) => plural(n, 'Vai para 1 paciente no app.', `Vai para ${n} pacientes no app.`),
    semAcesso: (m: number) => plural(m, '1 paciente sem acesso ao app não recebe.', `${m} pacientes sem acesso ao app não recebem.`),
    naoPodeApagar: 'Depois de enviado, o recado não pode ser apagado.',
    enviar: 'Enviar recado',
    voltarEEditar: 'Voltar e editar',
    enviadoPara: (n: number) => plural(n, 'Recado enviado para 1 paciente.', `Recado enviado para ${n} pacientes.`),
  },
  erros: {
    vazio: 'Escreva o recado.',
    longo: 'O recado tem até 1.000 caracteres.',
    semEtiqueta: 'Escolha pelo menos uma etiqueta.',
    etiquetasDemais: 'Escolha no máximo 10 etiquetas.',
    ninguem: 'Nenhum paciente recebe este recado com esse filtro.',
    destinatariosDemais: 'Este recado passa de 500 pacientes. Use etiquetas para dividir.',
    limiteDiario: 'Você chegou ao limite de 10 recados por dia. Tente de novo amanhã.',
    semCarimbo: SEM_CARIMBO_ENVIO,
  },
} as const;

/** §6.2: textos do portal do paciente. */
export const MSG_PORTAL_MENSAGENS = {
  entrada: {
    rotulo: 'Mensagens',
    comContador: (n: number) => `Mensagens (${n})`,
    aria: ariaMensagens,
  },
  titulo: 'Mensagens',
  conversaCom: (nome: string, crn: string) => `Conversa com ${nome}, nutricionista, ${crn}`,
  /** RN-450: sempre no topo da conversa. */
  avisoUrgencia: 'Este canal não é para urgências. Em caso de urgência, ligue para o SAMU no 192 ou vá ao pronto-socorro mais próximo.',
  horario: (resumo: string) => `Horário de atendimento por mensagens: ${resumo}.`,
  /** CH-D73: sem prometer prazo de leitura. */
  foraDoHorario: 'Agora é fora do horário de atendimento por mensagens. Sua mensagem fica guardada e será lida quando sua nutricionista voltar ao atendimento por mensagens.',
  semHorario: 'Sua nutricionista ainda não definiu o horário de atendimento por mensagens.',
  campo: 'Escreva sua mensagem',
  enviar: 'Enviar',
  enviarFoto: 'Enviar foto',
  ajudaFoto: 'Foto (JPG, PNG ou HEIC), até 10 MB. Para enviar um exame em PDF, use Exames.',
  /** Sem a entrada "Exames" visível no portal. */
  ajudaFotoSemExames: 'Foto (JPG, PNG ou HEIC), até 10 MB. Para enviar um exame em PDF, fale com o consultório.',
  removerFoto: 'Remover foto',
  voce: 'Você',
  carimbo,
  carimboRecado: (nome: string, crn: string) => `Recado do consultório · ${nome} · ${crn}`,
  enviada: 'Enviada',
  lida: 'Lida',
  foto: 'Foto',
  enviandoFoto: 'Enviando foto…',
  fotoFalhou: 'Não foi possível processar a foto. Tente outra.',
  novaMensagem: 'Nova mensagem da sua nutricionista.',
  mostrarNovas: 'Mostrar novas mensagens',
  verAnteriores: 'Ver mensagens anteriores',
  vazio: 'Nenhuma mensagem ainda. Escreva para sua nutricionista quando precisar.',
  soRecados: 'Por enquanto, sua nutricionista só envia recados por aqui. Para falar com o consultório, use os canais de sempre.',
  pausada: 'A conversa por mensagens está pausada pelo consultório. Para falar com sua nutricionista, use os canais de sempre.',
  erros: {
    semConteudo: 'Escreva a mensagem ou escolha uma foto.',
    textoLongo: TEXTO_LONGO,
    muitas: 'Você enviou muitas mensagens seguidas. Espere alguns minutos e tente de novo.',
    limiteFotos: 'Você chegou ao limite de fotos de hoje. Tente de novo amanhã.',
    formato: FORMATO,
    tamanho: TAMANHO,
    /** v0.3: a cota do consultório esgotada (o paciente não fala com o suporte). */
    cota: 'Não foi possível enviar a foto agora. Fale com o consultório.',
    falha: FALHA,
    pausadaNoEnvio: 'A conversa por mensagens está pausada. Use os canais de sempre.',
    semInternet: 'Sem conexão. Escreva quando voltar.',
  },
  iaNutri: {
    respondeuEmMensagens: 'Sua nutricionista respondeu em Mensagens.',
    abrirMensagens: 'Abrir Mensagens',
  },
  /** v0.3: item novo em "Perguntas comuns" do guia `portal-novidades`. */
  ajuda: {
    pergunta: 'Posso usar as Mensagens numa urgência?',
    resposta:
      'Não. Em caso de urgência, ligue para o SAMU no 192 ou vá ao pronto-socorro mais próximo. Sua nutricionista lê as mensagens no horário de atendimento por mensagens, não em tempo real, e a conversa fica guardada no seu prontuário.',
  },
} as const;

/** RN-457 e RN-458 (CS-440): corpos fixos, sem nome de paciente (no e-mail à nutricionista), sem texto, sem nome de anexo. */
export const TEXTOS_AVISO = {
  push: { titulo: 'NutriDebby', mensagem: 'Você tem uma nova mensagem.', recado: 'Você tem um novo recado.' },
  emailPaciente: {
    assunto: 'Você tem uma nova mensagem',
    corpo: (primeiroNome: string, nutricionista: string, link: string) =>
      `Olá, ${primeiroNome}! Você tem uma nova mensagem de ${nutricionista} no app. Para ler, entre no app: ${link}`,
  },
  emailNutri: {
    assunto: 'Mensagens novas de pacientes',
    corpo: (link: string) => `Você tem mensagens novas de pacientes no NutriDebby. Para ler, entre no painel: ${link}`,
  },
} as const;

/** §6.2 v0.3: `?erro=` do upload sem JS no painel — códigos fechados. */
export const ERROS_DO_UPLOAD_PAINEL = {
  formato: FORMATO,
  tamanho: TAMANHO,
  cota: MSG_MENSAGENS.erros.cota,
  limite: MSG_MENSAGENS.erros.limiteAnexos,
  conversa: MSG_MENSAGENS.erros.conversaFechada,
  carimbo: SEM_CARIMBO_ENVIO,
  falha: FALHA,
} as const;
/** §6.2 v0.3: `?erro=` do envio sem JS no portal — códigos fechados (`conversa` = o texto da pausa no envio). */
export const ERROS_DO_UPLOAD_PORTAL = {
  formato: FORMATO,
  tamanho: TAMANHO,
  cota: MSG_PORTAL_MENSAGENS.erros.cota,
  limite: MSG_PORTAL_MENSAGENS.erros.limiteFotos,
  muitas: MSG_PORTAL_MENSAGENS.erros.muitas,
  conversa: MSG_PORTAL_MENSAGENS.erros.pausadaNoEnvio,
  falha: FALHA,
} as const;

/** O texto do `?erro=`; código fora da lista (ou que não é texto) não mostra nada. */
export function erroDoUpload(lado: 'painel' | 'portal', codigo: unknown): string | null {
  const lista: Record<string, string> = lado === 'painel' ? ERROS_DO_UPLOAD_PAINEL : ERROS_DO_UPLOAD_PORTAL;
  return typeof codigo === 'string' && Object.hasOwn(lista, codigo) ? lista[codigo] : null;
}

const p2 = (n: number) => String(n).padStart(2, '0');
/** 'AAAA-MM-DD' do dia anterior (calendário puro). */
function diaAnterior(data: string): string {
  const [a, m, d] = data.split('-').map(Number);
  const x = new Date(Date.UTC(a, m - 1, d - 1));
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}`;
}

/**
 * §6.2 "Caixa", quando: "agora" · "há {n} min" · "há {n} h" (mesmo dia) · "ontem" · "{dd/mm}" (mesmo ano) · "{dd/mm/aaaa}".
 * Dias no fuso do consultório (RN-06), nunca o dia UTC do servidor. Instante no futuro (relógios diferentes) = "agora".
 */
export function rotuloDoQuando(instante: Date, agora: Date, fuso: string): string {
  const ms = agora.getTime() - instante.getTime();
  if (ms < 60_000) return 'agora';
  if (ms < 3_600_000) return `há ${Math.floor(ms / 60_000)} min`;
  const dia = partesNoFuso(instante, fuso).data;
  const hoje = partesNoFuso(agora, fuso).data;
  if (dia === hoje) return `há ${Math.floor(ms / 3_600_000)} h`;
  if (dia === diaAnterior(hoje)) return 'ontem';
  const [a, m, d] = dia.split('-');
  return a === hoje.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${a}`;
}
