/**
 * Plano 15 (IA Nutri do paciente): constantes sem imports de banco (só deste arquivo). A T4 criou as três que o texto do
 * consentimento e o aditivo 1.2 citam; a T6 completa o arquivo (autores, situações, listas fechadas, limites, prazos e os
 * textos de tela `MSG_IA_NUTRI`). As listas fechadas são as mesmas dos CHECK de `ia_nutri_mensagens` (0115).
 */

/** D28: a Debby escolhe o nome; até lá, "IA Nutri" (★ DO-4). Um lugar só: trocar o nome sobe a versão do consentimento (DP-2). */
export const NOME_IA_NUTRI = 'IA Nutri';
export const AUTORES = ['paciente', 'ia', 'sistema'] as const;
export type Autor = (typeof AUTORES)[number];
export const STATUS_PERGUNTA = ['na_fila', 'processando', 'respondida', 'falhou', 'cancelada'] as const;
export type StatusPergunta = (typeof STATUS_PERGUNTA)[number];
export const CATEGORIAS_CONVERSA = ['plano', 'fora_do_escopo', 'mudanca_plano', 'sintoma_ou_exame', 'suplemento_ou_remedio', 'peso_ou_dieta_restritiva', 'risco'] as const;
export type CategoriaConversa = (typeof CATEGORIAS_CONVERSA)[number];
export const TIPOS_RESPOSTA = ['quantidade', 'substituicao', 'horario', 'refeicao', 'orientacao'] as const;
export type TipoResposta = (typeof TIPOS_RESPOSTA)[number];
export const GRUPOS_RISCO = ['emergencia', 'transtorno_alimentar'] as const;
export type GrupoRisco = (typeof GRUPOS_RISCO)[number];
export const RISCOS = [...GRUPOS_RISCO, 'modelo'] as const;
export const PRAZO_CONVERSA_MS = 45_000; // RN-180
export const MOTIVOS_TECNICOS = ['invalida_fonte', 'invalida_tipo', 'invalida_termo', 'invalida_formato', 'recusa', 'interrompida', 'cota', 'teto_plataforma', 'provedor_indisponivel', 'resultado_incerto', 'limite_custo', 'indisponivel', 'condicao'] as const;
export type MotivoTecnico = (typeof MOTIVOS_TECNICOS)[number];
export const RESOLUCOES = ['vista', 'encerrada'] as const;
export const AVALIACOES = ['ajudou', 'nao_ajudou'] as const;
export const LIMITE_DIA = 10;
export const LIMITE_MES = 100;
export const LIMITE_DUVIDAS_ABERTAS = 3;
export const LIMITE_RISCO_NA_FILA_DIA = 10;
export const LIMITE_RISCO_GRAVADO_DIA = 50; // acima disso, o texto fixo aparece, mas nada é gravado nem enfileirado (0117)
export const MAX_PERGUNTA = 500;
export const SESSAO_MS = 30 * 60_000;
export const PERGUNTA_PRESA_MS = 3 * 60_000;
/** D8 = (b): as conversas ficam guardadas na plataforma por 180 dias e depois são apagadas. */
export const RETENCAO_DIAS = 180;
/** D22 (teto proposto, a confirmar com o advogado): a mensagem com sinal de risco de quem desativou, até a nutricionista ler. */
export const RISCO_REVOGADO_MAX_DIAS = 30;
export const ULTIMAS_MENSAGENS_DA_SESSAO = 6;
export const ATENDIMENTOS_NO_CONTEXTO = 5; // D9 = (a)
export const CONSULTA_RAPIDA_MS = 5_000;
export const CONSULTA_LENTA_MS = 30_000;
export type CodigoPergunta = 'ok' | 'limite_dia' | 'limite_mes' | 'em_andamento' | 'indisponivel' | 'sem_plano' | 'risco';

/**
 * Textos de tela da IA Nutri: os da spec (US-170 a US-177), literais; os novos, marcados `// novo` (desvio 5: revisão de
 * interface e Debby). Todo texto ao paciente que cita o nome o monta por `NOME_IA_NUTRI`; os do painel usam o nome de
 * trabalho (desvio 6). `protocoloRisco` e `comoFuncionaTexto` são listas de parágrafos (um `<p>` por item).
 * `autorizo` é o mesmo texto de `BOTAO_AUTORIZO_IA_NUTRI` (`textos-legais.ts`, que importa este arquivo — por isso a
 * igualdade é conferida em `textos.test.ts`, não por import).
 */
export const MSG_IA_NUTRI = {
  // portal
  avisoInicio: `Olá! Eu sou a ${NOME_IA_NUTRI}, uma inteligência artificial — não sou a sua nutricionista. Respondo dúvidas sobre o seu plano alimentar e as orientações que ela publicou para você. Não faço diagnóstico, não mudo o seu plano e não indico suplementos ou remédios. Se precisar, eu encaminho sua dúvida para ela.`,
  rodapeResposta: 'Resposta da IA com base no seu plano. Na dúvida, fale com sua nutricionista.',
  autorPaciente: 'Você',
  autorIa: `${NOME_IA_NUTRI} — inteligência artificial`,
  campo: 'Sua dúvida',
  contador: (n: number) => `${n} de ${MAX_PERGUNTA} caracteres`,
  enviar: 'Perguntar', // novo
  pensando: 'Pensando…',
  semPlano: `A ${NOME_IA_NUTRI} fica disponível quando sua nutricionista publicar o seu plano alimentar.`,
  naoDisponivel: `A ${NOME_IA_NUTRI} não está disponível no momento.`,
  longa: 'Escreva sua dúvida em até 500 caracteres.',
  semConexao: 'Sem conexão. Pergunte quando voltar.',
  emAndamento: 'Aguarde a resposta anterior.',
  limiteDia: 'Você chegou ao limite de 10 perguntas por hoje. Amanhã você pode perguntar de novo, ou envie sua dúvida para sua nutricionista.',
  limiteMes: 'Você chegou ao limite de 100 perguntas neste mês. No mês que vem você pode perguntar de novo, ou envie sua dúvida para sua nutricionista.', // novo
  ajudou: 'Ajudou',
  naoAjudou: 'Não ajudou',
  avaliado: 'Obrigado pela avaliação.', // novo
  encaminhar: 'Enviar para minha nutricionista',
  enviarDireto: 'Enviar direto para minha nutricionista', // novo (DP-16): o segundo botão do formulário — rótulo próprio, para não repetir o "Enviar para minha nutricionista" das respostas (dois botões iguais com efeitos diferentes)
  encaminhada: 'Pronto! Sua pergunta foi enviada ao consultório. Quando houver novidade, ela aparece aqui.',
  limiteDuvidas: 'Você já tem 3 dúvidas aguardando o consultório. Aguarde antes de enviar outra.',
  duvidaVista: 'Sua dúvida foi vista no consultório.',
  respostaChegou: 'A resposta chegou.', // novo (região de status, RNF-167)
  autorSistema: 'Aviso do app',
  apagada: 'Mensagem apagada.', // novo
  mostrarAnteriores: 'Mostrar mensagens anteriores', // novo (revisão da T12, I4: a conversa mostra as 20 últimas; à Debby)
  emergencia: 'Em emergência: SAMU 192 · CVV 188',
  linkPlano: 'Tirar dúvida sobre o plano',
  linkRefeicao: 'Perguntar sobre esta refeição',
  convite: `A ${NOME_IA_NUTRI} está disponível para você.`,
  agoraNao: 'Agora não',
  lerEDecidir: 'Ler e decidir',
  autorizo: `Autorizo o uso da ${NOME_IA_NUTRI}`,
  textoMudou: 'O texto mudou. Leia e decida de novo.',
  textoMudouNoToque: 'O texto mudou. Leia de novo antes de decidir.',
  desativar: `Desativar a ${NOME_IA_NUTRI} e apagar as conversas`,
  confirmarDesativar: `As suas conversas com a ${NOME_IA_NUTRI} serão apagadas. Continuar?`,
  desativada: `${NOME_IA_NUTRI} desativada.`,
  lerConversas: 'Ler as conversas', // novo
  comoFunciona: `Como a ${NOME_IA_NUTRI} funciona`,
  // novo (§7.8: a explicação fica na própria tela; à Debby, D11)
  comoFuncionaTexto: [
    `A ${NOME_IA_NUTRI} é uma inteligência artificial. Ela procura a resposta no seu plano alimentar publicado e nas orientações que a sua nutricionista escreveu, e mostra o trecho como está escrito, com a fonte.`,
    'Ela não faz diagnóstico, não muda o seu plano, não indica suplementos ou remédios e não fala de peso. Quando não encontra a resposta, ela oferece enviar a sua pergunta para a sua nutricionista.',
    'Sua nutricionista pode ler as conversas. O consultório não acompanha as mensagens em tempo real e não atende emergências.',
    'Em emergência, ligue para o SAMU (192) ou o CVV (188).',
  ],
  situacaoVigente: (data: string) => `Você autorizou em ${data}.`, // novo
  situacaoNunca: `Você ainda não autorizou a ${NOME_IA_NUTRI}.`, // novo
  situacaoDesativada: (data: string) => `Você desativou em ${data}.`, // novo
  // painel (a equipe: nome de trabalho, desvio 6)
  ativar: 'Ativar a IA Nutri para pacientes',
  avisoAtivar: 'A IA Nutri responde dúvidas dos pacientes sobre o plano publicado e as suas orientações. Ela não faz diagnóstico, não muda o plano e não indica suplementos ou remédios. Libere paciente por paciente.',
  // novo (US-170, D7, D11): o que a ativação liga e o que se espera da nutricionista — mostrado antes do botão de ativar
  avisoAtivacaoFila: 'Ao ativar: a ficha de cada paciente liberado ganha a aba "IA Nutri", onde você lê as conversas dele; as dúvidas que os pacientes enviarem e as mensagens com sinal de risco chegam à fila "Dúvidas da IA Nutri", com as de risco no topo e um e-mail de aviso; o consultório não precisa responder em tempo real, mas deve abrir a fila com frequência e seguir o protocolo do "Sinal de risco".',
  // novo — texto FINAL a partir da D11, publicado pelo dono sem a psicóloga (DP-18, ★ DO-2 trocada, D37); quando ela
  // reescrever, um PR curto troca as linhas (texto da equipe: não muda a versão do consentimento)
  protocoloRisco: [
    'Protocolo do "Sinal de risco":',
    '1. Leia a mensagem e entre em contato com o paciente pelo canal que você já usa com ele, o quanto antes.',
    '2. Se houver risco à vida, oriente a procurar o SAMU (192), o pronto-socorro ou o CVV (188, 24 horas). Para acompanhamento, indique o CAPS da região ou um psicólogo.',
    '3. Registre no prontuário o que foi feito.',
    '4. Toque em "Marcar como vista" só depois do contato.',
  ],
  // novo (revisão da T11, I2; à Debby): na aba da ficha, a pergunta com sinal de risco de quem desativou a IA Nutri não
  // mostra o texto — ele é lido uma vez, pela fila (D22)
  riscoRevogadoNaFicha: 'O paciente desativou a IA Nutri. Abra a dúvida para ler esta mensagem: ela é mostrada uma vez e depois apagada.',
  riscoApagadoAoAbrir: 'O paciente desativou a IA Nutri. Esta mensagem foi mostrada agora e já foi apagada: anote o que for preciso antes de sair da página.', // novo (D22)
  desativarPelaNutri: 'Registrar desativação a pedido do paciente', // novo (DP-17)
  confirmarDesativarPelaNutri: 'Registrar que o paciente pediu para desativar a IA Nutri? As conversas dele com a IA Nutri serão apagadas (uma mensagem com sinal de risco ainda não aberta fica até ser aberta, por no máximo 30 dias).', // novo
  desativadaPelaNutri: 'Desativação registrada. As conversas do paciente com a IA Nutri foram apagadas.', // novo
  vejaOQueOPacienteLe: 'Veja o que o paciente lê',
  ativada: 'IA Nutri ativada. Libere os pacientes na ficha de cada um.',
  desativarConsultorio: 'Desativar a IA Nutri para pacientes',
  desativadaConsultorio: 'IA Nutri desativada para pacientes. As dúvidas já enviadas continuam na fila.', // novo
  aditivoNovo: 'Para usar a IA Nutri, leia e aceite a nova versão do aditivo de IA.',
  // novo (revisão da T11, I1; à Debby), como MSG_IA.perfilIncompleto da 14A: sem nome completo, CRN ou e-mail de contato a
  // entrada do paciente fica em "nenhuma" (o consentimento cita a responsável) — a nutricionista precisa saber por quê
  perfilIncompleto: 'Complete seu perfil profissional (nome completo, CRN e e-mail de contato) em Configurações › Perfil e marca: sem isso, a IA Nutri não aparece para os pacientes.',
  completarPerfil: 'Completar perfil', // como o link dos documentos (parecer e receita)
  pausada: 'A IA Nutri está pausada pelo suporte.', // novo (DP-1: só na pausa de emergência da plataforma)
  usoDoMes: (p: number) => `Uso da IA Nutri neste mês: ${p}% do limite`,
  cotaAcabou: 'O limite da IA Nutri deste mês acabou. Ele renova no dia 1º ou quando o suporte ampliar o limite.',
  aviso80: 'Os pacientes já usaram 80% do limite da IA Nutri deste mês.', // novo (o assunto do e-mail de 80%, T5)
  confirmarDesativarConsultorio: 'Desativar a IA Nutri para pacientes? A fila de dúvidas continua.',
  liberar: 'Liberar a IA Nutri para este paciente',
  // D33 e D25 (a frase dos termos é nova, à Debby): a IA Nutri mostra os trechos do plano como estão
  pesoOculto: 'Este paciente está com o peso oculto no app. A IA Nutri não fala de peso, mas mostra os trechos do plano como estão escritos, inclusive termos como "jejum". Confirme se ela é adequada para ele.',
  liberadaAguardando: 'IA Nutri: liberada — aguardando o aceite do paciente',
  liberadaEmUso: 'IA Nutri: liberada e em uso', // novo
  bloqueada: 'IA Nutri: bloqueada', // novo
  fila: 'Dúvidas da IA Nutri', // Plano 25 (CH-D45): um nome só para a fila (era "Dúvidas dos pacientes")
  seloRisco: 'Sinal de risco',
  seloRiscoRevogado: 'Sinal de risco — o paciente desativou a IA Nutri',
  avisoMinimoRisco: 'Aviso: houve sinal de risco', // novo (D22 b)
  haHoras: (n: number) => (n < 1 ? 'há menos de 1 hora' : n === 1 ? 'há 1 hora' : `há ${n} horas`), // singular e "menos de 1": confirmar com a Debby
  marcarVista: 'Marcar como vista',
  naoAjudouSelo: 'O paciente marcou: não ajudou',
  ajudouSelo: 'O paciente marcou: ajudou', // novo (US-175: a nutricionista vê as duas avaliações; revisão final)
  filaVazia: 'Nenhuma dúvida aguardando.', // novo
  vista: 'Dúvida marcada como vista.', // novo
} as const;

/** §13.1 (projeção) e §7.6 (exportação): o rótulo legível da categoria (novo, vai à Debby). */
export const ROTULO_CATEGORIA: Record<CategoriaConversa, string> = {
  plano: 'Dúvida sobre o plano',
  fora_do_escopo: 'Fora do que a IA responde',
  mudanca_plano: 'Pedido de mudança no plano',
  sintoma_ou_exame: 'Sintoma ou exame',
  suplemento_ou_remedio: 'Suplemento ou remédio',
  peso_ou_dieta_restritiva: 'Assunto para a consulta',
  risco: 'Sinal de risco',
};
