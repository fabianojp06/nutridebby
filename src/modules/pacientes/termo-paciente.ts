/**
 * US-011 / RNF-08. Termo de Uso e Privacidade do paciente. P08-06 (15/10/2026): a 1.0 definitiva substitui a 0.1
 * provisória, publicada pelo dono sem a revisão do advogado (na linha da A-D27). Mudar a versão obriga o novo aceite, uma
 * vez por consultório (US-011 "Nova versão do termo": `requirePaciente` leva a /p/termo). Aceite gravado em `consents`
 * (`termo-paciente-<versão>`, uma linha por versão; só INSERT).
 */
export const TERMO_PACIENTE_VERSAO = '1.0';
/** A data impressa no fim da versão em vigor. */
export const TERMO_PACIENTE_VERSAO_DATA = '2026-10-15';
export const TERMO_PACIENTE = `termo-paciente-${TERMO_PACIENTE_VERSAO}`;
export const TERMO_PACIENTE_TITULO = 'Termo de Uso e Privacidade';
export const TERMO_PACIENTE_ROTULO = `Li e aceito o Termo de Uso e Privacidade (versão ${TERMO_PACIENTE_VERSAO})`;
export const MSG_TERMO_NAO_ACEITO = 'Para continuar, aceite o Termo de Uso e Privacidade.';

export type TextoVersionado = { data: string; paragrafos: readonly string[] };
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * As versões do termo, como em `textos-legais.ts` da IA: a antiga fica para mostrar o que quem aceitou nela leu (a linha
 * de `consents` guarda só a versão). Só a versão em vigor é mostrada e aceita.
 */
export const TERMO_PACIENTE_TEXTOS: Readonly<Record<string, TextoVersionado>> = {
  '0.1-provisorio': {
    data: '2026-09-30',
    paragrafos: [
      'Versão provisória, a ser substituída pelo texto revisado por advogado antes do uso com pacientes reais.',
      'Quem cuida dos seus dados é a sua nutricionista (controladora). O NutriDebby é a plataforma que ela usa para guardar o prontuário e falar com você (operadora).',
      'Seus dados de saúde (anamnese, medidas, exames, plano alimentar e diário) são usados só no seu acompanhamento nutricional. Cada acesso ao seu prontuário fica registrado.',
      'Você pode pedir a qualquer momento uma cópia dos seus dados ou a exclusão deles. Por obrigação legal, o prontuário clínico fica guardado de forma bloqueada pelo prazo exigido e depois é anonimizado.',
      'Mensagens por WhatsApp só são enviadas se você autorizar, e você pode desistir quando quiser. Os lembretes continuam por e-mail.',
    ],
  },
  '1.0': {
    data: TERMO_PACIENTE_VERSAO_DATA,
    paragrafos: [
      'Este termo explica como funciona o app NutriDebby e como os seus dados são tratados. Leia tudo antes de aceitar. Se o termo mudar, você verá a nova versão e o aceite será pedido de novo.',
      'Em resumo: seus dados ficam com a sua nutricionista; o app só guarda e protege; você pode baixar uma cópia ou pedir a exclusão em Eu › Privacidade; nada é vendido nem usado para propaganda.',
      'A responsável pelos seus dados é a sua nutricionista (a controladora: quem decide como os dados são usados). O NutriDebby é a plataforma que ela usa, mantida por WEB SMART SISTEMAS+13 LTDA, CNPJ 66.657.250/0001-07 (a operadora). A operadora trata os dados do seu atendimento só em nome dela e segundo as instruções dela. A sua conta de acesso (e-mail, senha e registros de uso do app) é da plataforma, que responde por ela.',
      'Seus dados são usados no seu acompanhamento nutricional: cadastro, anamnese (as perguntas da primeira consulta), medidas, exames, plano alimentar, orientações, diário com fotos e comentários, e documentos como receitas e pareceres nutricionais.',
      'Também são usados para a agenda, os lembretes e o funcionamento do app. O app registra os dias em que você o abriu e guarda esse registro por 400 dias. O app é só para maiores de 18 anos.',
      'O prontuário existe porque a nutricionista precisa registrar e guardar o seu atendimento, para cuidar da sua saúde e cumprir as normas da profissão (LGPD, art. 11, II, "a" e "f"). Ele continua mesmo que você não aceite este termo, e fica guardado pelo prazo das normas do CFN. Sem o aceite, não é possível usar o app. Ao aceitar, você confirma que leu as regras de uso e de privacidade.',
      'Algumas coisas dependem só de você, e você pode desistir quando quiser, sem custo: as notificações no aparelho (Eu › Notificações), os lembretes por WhatsApp (só são enviados se a sua nutricionista usar esse recurso) e o uso de inteligência artificial (IA), que tem autorizações próprias, pedidas em outras telas. Se você não der uma autorização, só aquela função fica desligada e o atendimento continua. Se você autorizar lembretes por WhatsApp, eles saem do número da sua nutricionista e passam pela rede do WhatsApp (Meta). Os lembretes por e-mail continuam.',
      'Para funcionar, a plataforma usa outras empresas: Hostinger (servidor), Resend (envio de e-mails), Cloudflare (verificação anti-robô), Backblaze (cópia de segurança protegida por criptografia) e o serviço de notificações do seu navegador (Google, Apple, Mozilla ou Microsoft), que só entrega o aviso protegido ao seu aparelho.',
      'Resend, Cloudflare e Backblaze são empresas dos Estados Unidos, e os serviços de notificação também têm sede lá. Por isso seus dados, inclusive a cópia de segurança, podem ser enviados para fora do Brasil, com as garantias que a LGPD exige. Seus dados não são vendidos nem usados para publicidade ou para vender produtos.',
      'Ao agendar pela página de agendamento do consultório, você informa nome, e-mail e, se quiser, telefone, e confirma que tem 18 anos ou mais. Você também aceita este termo, e o número de rede (IP) do seu aparelho é registrado. Se você não confirmar o pedido com o código enviado ao seu e-mail, ele é apagado depois de 24 horas, na limpeza diária. Quando o agendamento é concluído, o seu cadastro é criado no consultório ou, se você já é paciente, a consulta entra no seu cadastro.',
      'Seus dados ficam separados por consultório, com senha protegida, conexão segura (HTTPS) e cópia de segurança diária do banco de dados, protegida por criptografia e guardada fora do servidor. Toda abertura ou alteração do seu prontuário fica registrada, com data, hora e IP. A sua nutricionista vê esse registro no "Histórico de acessos", e você pode pedir a ela uma cópia. Nenhum sistema é livre de falhas. Se houver um problema de segurança que possa trazer risco ou dano relevante para você, a sua nutricionista avisa você pelo e-mail ou telefone do seu cadastro, com o apoio da plataforma.',
      'Receitas e pareceres assinados podem aparecer no app, quando a sua nutricionista os libera, e também podem chegar por um link no e-mail, que pede um código. Todo documento assinado tem um código de verificação impresso. Quem tiver esse código pode conferir se o documento é válido, sem ver o conteúdo nem os seus dados.',
      'Você pode, sem custo: saber se seus dados são tratados; receber uma cópia (botão "Baixar meus dados", em Eu › Privacidade), que também serve para levar os dados a outro profissional; corrigir dados; pedir anonimização, bloqueio (o dado fica guardado, mas sem uso) ou exclusão; saber com quem os dados são compartilhados; se opor a um uso que descumpra a lei; e retirar as autorizações dadas em outras telas. A cópia e a exclusão você pede no app, em Eu › Privacidade; o link da cópia chega por e-mail e vale 24 horas. Para o resto, fale com a sua nutricionista. Ela responde em até 15 dias, com a resposta completa. Você também pode reclamar à ANPD, a Autoridade Nacional de Proteção de Dados.',
      'Para pedir a exclusão, use o botão "Pedir exclusão dos meus dados", em Eu › Privacidade, ou fale com a sua nutricionista. Ela responde em até 15 dias. Algumas coisas saem logo: as fotos do diário, os exames enviados pelo app que ainda não foram aceitos, a autorização do WhatsApp, as notificações no aparelho, as marcas de acesso ao app e as conversas com a IA Nutri. As consultas futuras são canceladas. O prontuário fica bloqueado (guardado, sem uso) por 20 anos contados do bloqueio, como pedem as normas do CFN. Depois disso, os anexos são apagados e o cadastro é anonimizado, ou seja, deixa de identificar você.',
      'O app usa só os cookies necessários (pequenos arquivos que o navegador guarda): o do login, o do consultório escolhido e o do link de documento. Para abrir sem internet, o app guarda no seu aparelho uma cópia do seu plano alimentar, que sai quando você toca em Sair; por isso, em aparelho de outra pessoa, saia sempre. Algumas preferências, como a lista de compras, também ficam só no seu aparelho. Não há propaganda nem ferramentas de outras empresas para medir o seu uso. Os vídeos do YouTube e do Vimeo só carregam quando você toca neles; nessa hora, esses sites recebem o seu IP.',
      `Versão 1.0, de ${dataBr(TERMO_PACIENTE_VERSAO_DATA)}.`,
    ],
  },
};

/** O texto mostrado e aceito: o da versão em vigor. */
export const TERMO_PACIENTE_PARAGRAFOS: readonly string[] = TERMO_PACIENTE_TEXTOS[TERMO_PACIENTE_VERSAO].paragrafos;
