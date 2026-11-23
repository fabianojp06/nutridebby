import { NOME_IA_NUTRI } from '@/modules/ia/nutri-paciente/constantes';
import type { ProgressoGuia } from '@/modules/plataforma/preferencias-tipos';
import { MSG_MURAL } from '@/modules/portal/mural-regras';
import type { Guia } from './conteudo';

/**
 * Plano 16 (RN-212, US-199): o manual guiado do portal, no modelo do painel (P08-10). Fora de GUIAS: aqueles casam por rota
 * do painel; este só abre em Hoje. Texto RASCUNHO até a Debby revisar (G-D10 ★). Sobe a versão quando o texto mudar de
 * verdade (o aviso volta uma vez, com `avisoDoGuia`). Versão 2 (Plano 15, ★ DO-6 ajustada à DO-1 = não): a IA Nutri vai ao
 * ar ligada pela nutricionista e o guia muda para todos — mural, privacidade e "Onde fica cada coisa" (emendas à spec G,
 * C-191, C-192, C-197, RN-193, RN-194, RN-209; os textos já dizem "quando liberada"). Versão 3 (Plano 17, Tarefa 6): os
 * lembretes de rotina em "Perguntas comuns" (com a ressalva "se a sua nutricionista configurou": o guia é o mesmo para
 * todos); o tour não muda. A subida mostra "O manual do app foi atualizado" uma vez a quem já viu a versão 2.
 * Plano 22: versão 4 (T6, EP-D52) — Exames também mostra os resultados que a nutricionista liberar no app ("Mostrar no app",
 * US-375); o menu passa a ter "Exames" com eles, mesmo sem o recebimento ligado. O tour não muda.
 */
export const GUIA_PORTAL: Guia = {
  id: 'portal-novidades',
  versao: 4,
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
          `Plano: as refeições do dia, o PDF, a lista de compras, os conteúdos e, quando liberada, a ${NOME_IA_NUTRI}.`,
          // Plano 22 (T6): os resultados liberados pela nutricionista ("Mostrar no app")
          'Exames: enviar um exame (quando o consultório recebe exames pelo app), acompanhar os que você enviou e ver os resultados que a sua nutricionista liberar.',
          'Eu: sua conta, documentos, notificações, privacidade, este manual e o Sair.',
        ],
      },
      {
        titulo: 'Perguntas comuns',
        itens: [
          // Plano 15 (D34): a mesma redação do rodapé do mural (um lugar só)
          MSG_MURAL.rodape,
          '"Comi assim" registra a refeição no seu diário, sem escrever. Você tem 10 segundos para desfazer.',
          'Sem internet, o app mostra a última versão do seu plano.',
          // Plano 14A (desvio 11) e Plano 15 (§7.8): dois pedidos separados — a autorização dos exames e o consentimento da IA Nutri
          `Se o seu consultório usar IA, você pode receber dois pedidos separados: um para os exames (em Eu › Privacidade) e outro para a ${NOME_IA_NUTRI} (em Plano). Cada um é opcional. Recusar ou retirar não muda nada no seu atendimento.`,
          // Plano 17: depende da nutricionista ter configurado (o guia é o mesmo para todos os pacientes)
          'Se a sua nutricionista configurou lembretes, eles ficam em Eu › Lembretes, e você pode desligar qualquer um.',
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

/**
 * US-199. G-D17 = a (R7): `boasVindas` para quem não tem acesso ao app antes de hoje (`jaUsavaOApp`); `pergunta` para quem já
 * usava. Plano 15 (§7.8): `atualizado` para quem já viu uma versão anterior do guia (novo, à Debby).
 */
export const AVISO_PORTAL = {
  pergunta: 'O app mudou. Quer ver onde ficou cada coisa?',
  boasVindas: 'Boas-vindas ao app do seu acompanhamento. Quer ver como funciona?',
  atualizado: 'O manual do app foi atualizado. Quer ver o que há de novo?',
  ver: 'Ver como funciona',
  agoraNao: 'Agora não',
  reverTour: 'Ver o tour de novo',
  comoUsar: 'Como usar o app',
} as const;

/**
 * §7.8 (Plano 15): quem já viu uma versão ANTERIOR do guia recebe "atualizado" (em qualquer consultório: as frases do mural,
 * da privacidade e de "Onde fica cada coisa" mudaram para todos); "O app mudou" só para quem já usava o app e nunca viu o
 * guia (Plano 16, G-D17). `v` = a versão vista, o mesmo campo que `precisaDoGuia` lê.
 */
export function avisoDoGuia(progresso: ProgressoGuia, jaUsava: boolean, guia: { id: string; versao: number } = GUIA_PORTAL): string {
  const visto = progresso[guia.id]?.v ?? 0;
  if (visto > 0 && visto < guia.versao) return AVISO_PORTAL.atualizado;
  return jaUsava ? AVISO_PORTAL.pergunta : AVISO_PORTAL.boasVindas;
}
