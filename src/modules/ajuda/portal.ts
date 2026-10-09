import type { Guia } from './conteudo';

/**
 * Plano 16 (RN-212, US-199): o manual guiado do portal, no modelo do painel (P08-10). Fora de GUIAS: aqueles casam por rota
 * do painel; este só abre em Hoje. Texto RASCUNHO até a Debby revisar (G-D10 ★). Sobe a versão quando o texto mudar de
 * verdade (o aviso volta uma vez).
 */
export const GUIA_PORTAL: Guia = {
  id: 'portal-novidades',
  versao: 1,
  padrao: /^\/p\/inicio$/,
  titulo: 'Como usar o app',
  ajuda: {
    resumo: 'O app do seu acompanhamento tem cinco partes, no topo: Hoje, Jornada, Plano, Exames e Eu.',
    secoes: [
      {
        titulo: 'Onde fica cada coisa',
        itens: [
          'Hoje: o que importa no dia — a próxima refeição, o que você registrou, os comentários da sua nutricionista e os avisos do consultório. O diário completo fica em "Ver todo o diário".',
          // RN-203/RN-214: igual para todos e sem a palavra "peso" (quem tem o peso oculto não pode ler aqui que ele existe)
          'Jornada: suas consultas, as medidas e as orientações de cada atendimento, "Todas as medidas" e "Minhas consultas".',
          'Plano: as refeições do dia, o PDF, a lista de compras e os conteúdos.',
          'Exames: enviar um exame e acompanhar os que você enviou (quando o consultório recebe exames pelo app).',
          'Eu: sua conta, documentos, notificações, privacidade, este manual e o Sair.',
        ],
      },
      {
        titulo: 'Perguntas comuns',
        itens: [
          'Seus registros do diário ficam visíveis para sua nutricionista, que pode comentar quando os ler. Este app não é um canal de conversa e não tem prazo de resposta: dúvidas, anote para a consulta ou use os contatos do consultório. Em emergência, ligue 192.',
          '"Comi assim" registra a refeição no seu diário, sem escrever. Você tem 10 segundos para desfazer.',
          'Sem internet, o app mostra a última versão do seu plano.',
        ],
      },
    ],
  },
  passos: [
    { alvo: 'faixa', titulo: 'Seu acompanhamento', texto: 'No topo ficam o nome do consultório e as partes do app. Em Hoje, um resumo da sua jornada leva à Jornada.' },
    { alvo: 'mural', titulo: 'Hoje', texto: 'Aqui aparecem a próxima refeição, o que você registrou, os comentários da sua nutricionista e os avisos do consultório.' },
    // o alvo só existe com uma refeição na janela de 90 min: o texto não depende de haver uma na tela (sem alvo, o passo aparece centralizado)
    { alvo: 'respostas', titulo: 'Responder à refeição', texto: 'Quando uma refeição estiver perto do horário, ela aparece em Hoje. Toque em "Comi assim" para registrar no diário sem escrever. Se comeu outra coisa, abra a refeição e toque em "Comi outra coisa".' },
    { alvo: 'acoes', titulo: 'Atalhos', texto: 'Aqui embaixo: foto da refeição, enviar exame e agendar consulta.' },
    { alvo: 'secao-eu', titulo: 'Eu', texto: 'Sua conta, documentos, notificações, privacidade, este passeio e o Sair ficam em Eu.' },
  ],
};

/** US-199. G-D17 = a (R7): `boasVindas` para quem não tem acesso ao app antes de hoje (`jaUsavaOApp`); `pergunta` para quem já usava. */
export const AVISO_PORTAL = {
  pergunta: 'O app mudou. Quer ver onde ficou cada coisa?',
  boasVindas: 'Boas-vindas ao app do seu acompanhamento. Quer ver como funciona?',
  ver: 'Ver como funciona',
  agoraNao: 'Agora não',
  reverTour: 'Ver o tour de novo',
  comoUsar: 'Como usar o app',
} as const;
