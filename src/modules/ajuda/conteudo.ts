import type { EstadoGuia, ProgressoGuia } from '@/modules/plataforma/preferencias-tipos';

/** P08-10 (D26): o manual guiado. Texto RASCUNHO até o dono e a Debby aprovarem (P08-08); espelhado na spec (US-057). Nenhum dado de saúde nos exemplos. */
export type Passo = { alvo?: string; titulo: string; texto: string };
export type Guia = {
  id: string;
  /** Sobe quando o texto muda de verdade: o aviso "Primeira vez aqui?" volta a aparecer (D27). */
  versao: number;
  /** Caminhos em que o guia vale (o primeiro guia da lista que casar). */
  padrao: RegExp;
  titulo: string;
  ajuda: { resumo: string; secoes: { titulo: string; itens: string[] }[] };
  passos: Passo[];
};

export const ID_BOAS_VINDAS = 'boas-vindas';
const ID = '[0-9a-f-]{36}';

export const GUIAS: readonly Guia[] = [
  {
    id: ID_BOAS_VINDAS,
    versao: 2, // Plano 12: o passo do menu passou a citar "Exames recebidos"
    padrao: /^\/painel$/,
    titulo: 'Início',
    ajuda: {
      resumo: 'O Início mostra o seu dia: a próxima consulta, a agenda de hoje, os diários novos e como os pacientes estão usando o app.',
      secoes: [
        { titulo: 'O que dá para fazer aqui', itens: ['Abrir o prontuário do próximo paciente.', 'Ver os diários que ainda não foram vistos.', 'Acompanhar os pedidos de cópia e de exclusão de dados dos pacientes (prazo de 15 dias).'] },
        { titulo: 'Perguntas comuns', itens: ['A taxa de faltas conta só as consultas que já começaram e não foram canceladas.', 'Os avisos do topo (espaço, WhatsApp) somem sozinhos quando o problema é resolvido.'] },
      ],
    },
    passos: [
      { titulo: 'Boas-vindas ao NutriDebby', texto: 'Um passeio rápido pelo painel. Você pode pular agora e rever depois no menu da sua conta.' },
      { alvo: 'menu', titulo: 'Menu do painel', texto: 'Pacientes, Agenda, Diários, Conteúdos e Configurações ficam sempre aqui no topo. Quando você liga o recebimento de exames pelo app, "Exames recebidos" aparece também, com o número dos que aguardam.' },
      { alvo: 'proxima-consulta', titulo: 'Próxima consulta', texto: 'A consulta mais próxima de hoje, com atalhos para o prontuário e para a chamada online.' },
      { alvo: 'atalhos', titulo: 'Atalhos', texto: 'Cadastre um paciente, marque uma consulta ou publique um conteúdo direto do Início.' },
      { alvo: 'tema', titulo: 'Claro ou escuro', texto: 'Este botão liga e desliga o modo escuro. A escolha fica salva na sua conta, em qualquer aparelho.' },
      { alvo: 'ajuda', titulo: 'Ajuda em cada tela', texto: 'Em qualquer tela, este botão explica o que dá para fazer ali e abre o manual completo.' },
      { alvo: 'conta', titulo: 'Sua conta', texto: 'Perfil e marca, segurança, o manual, este tour e o Sair ficam aqui.' },
    ],
  },
  {
    id: 'pacientes',
    versao: 1,
    padrao: /^\/painel\/pacientes(\/novo)?$/,
    titulo: 'Pacientes',
    ajuda: {
      resumo: 'A lista dos seus pacientes. Tudo começa aqui: cadastrar, convidar para o app e abrir o prontuário.',
      secoes: [{ titulo: 'Passo a passo', itens: ['Clique em "Novo paciente" e preencha nome, data de nascimento, sexo e e-mail.', 'Ao salvar, o paciente recebe o convite para o app por e-mail (e por WhatsApp, se você marcar "Enviar convite por WhatsApp" com a autorização). Se o convite vencer, use "Reenviar convite" no prontuário.', 'Use a busca para achar pelo nome; arquivados aparecem no filtro de situação.'] }],
    },
    passos: [
      { alvo: 'novo-paciente', titulo: 'Novo paciente', texto: 'Comece cadastrando o paciente. O convite para o app sai por e-mail ao salvar.' },
      { alvo: 'busca-pacientes', titulo: 'Busca', texto: 'Ache um paciente pelo nome ou filtre pela situação (ativo, arquivado).' },
    ],
  },
  {
    id: 'plano-alimentar',
    versao: 1,
    padrao: new RegExp(`^/painel/pacientes/${ID}/plano-alimentar(/.*)?$`),
    titulo: 'Plano alimentar',
    ajuda: {
      resumo: 'Monte o plano por refeições, com os alimentos da TACO ou os seus. O salvamento é automático; o paciente só vê depois de "Publicar".',
      secoes: [
        { titulo: 'Passo a passo', itens: ['Crie as refeições e adicione os alimentos com a quantidade em gramas ou medida caseira.', 'Confira os totais e a meta ao lado.', 'Clique em "Publicar": a versão anterior é arquivada e o paciente recebe o aviso no app.'] },
        { titulo: 'Perguntas comuns', itens: ['Para mudar um plano publicado, use "Editar": uma versão nova é criada, e a publicada continua valendo até você publicar a nova.', 'O PDF do plano fica pronto em alguns segundos depois de publicar.'] },
      ],
    },
    passos: [
      { alvo: 'editor-plano', titulo: 'Refeições e alimentos', texto: 'Cada refeição é um bloco. A busca de alimentos aceita parte do nome; a quantidade pode ser em gramas ou medida caseira.' },
      { alvo: 'publicar-plano', titulo: 'Publicar', texto: 'O paciente só vê o plano depois de publicado. Tudo o que você digita já fica salvo no rascunho.' },
    ],
  },
  {
    id: 'documentos',
    versao: 2, // Plano 13: o parecer nutricional e a retificação (quem já viu o tour, vê de novo)
    padrao: new RegExp(`^/painel/pacientes/${ID}/documentos(/.*)?$`),
    titulo: 'Documentos: receita e parecer',
    ajuda: {
      resumo: 'Receitas de suplementos e fitoterápicos e pareceres nutricionais sobre os exames, assinados por você à mão (digitalizada) e entregues ao paciente com código de verificação.',
      secoes: [
        {
          titulo: 'Passo a passo',
          itens: [
            'Clique em "Nova receita" (adicione os itens e escreva a justificativa de uso, que fica no prontuário e não vai na receita) ou em "Novo parecer nutricional" (escolha os exames e escreva a avaliação). Clique em "Salvar rascunho".',
            'Clique em "Preparar para assinatura" e confirme a declaração. Em alguns segundos o PDF fica pronto.',
            'Clique em "Baixar PDF para assinar", imprima, assine à mão e envie as fotos das páginas em "Enviar documento digitalizado (assinado à mão)", com o código da verificação em duas etapas.',
            'Assinado, o documento vai para o app do paciente; quem não tem o app recebe um link por e-mail. Na consulta presencial, use "Entregue pessoalmente".',
          ],
        },
        {
          titulo: 'Perguntas comuns',
          itens: [
            'Para assinar, a verificação em duas etapas precisa estar ativa (Segurança).',
            'Depois de assinado, o documento não muda. Errou, ou o exame mudou? Use "Retificar": a versão nova, com o motivo (fica só no prontuário), substitui a anterior quando for assinada. "Cancelar documento" é para o documento que não deve mais valer.',
            'O parecer guarda uma cópia dos valores dos exames. Se o exame mudar depois de preparar, a tela avisa e o parecer continua com a cópia.',
            'O parecer não afirma diagnóstico de doença nem prescreve medicamento: para isso, encaminhe ao médico.',
            'Qualquer pessoa com o código de verificação (o paciente, uma farmácia) confere a autenticidade sem ver o conteúdo.',
            '"Fitoterápico (forma farmacêutica ou fórmula magistral)" só aparece com a habilitação registrada em Configurações.',
          ],
        },
      ],
    },
    passos: [
      { alvo: 'nova-receita', titulo: 'Nova receita', texto: 'Comece aqui. A receita nasce como rascunho e só o paciente certo a recebe depois de assinada.' },
      { alvo: 'novo-parecer', titulo: 'Novo parecer nutricional', texto: 'O parecer lê os exames lançados na aba Exames: você escolhe os exames e escreve a avaliação, a conduta e os encaminhamentos.' },
      { alvo: 'editor-receita', titulo: 'Itens e justificativa', texto: 'Cada tipo de item pede os campos da resolução do CFN. A justificativa de uso fica só no prontuário.' },
      { alvo: 'editor-parecer', titulo: 'Exames e avaliação', texto: 'Os valores dos exames escolhidos são copiados a cada vez que você salva e congelados ao preparar.' },
      { alvo: 'preparar-documento', titulo: 'Preparar para assinatura', texto: 'A declaração confirma a sua responsabilidade. O PDF sai com a sua marca, o código de verificação e o QR code.' },
      { alvo: 'assinar-documento', titulo: 'Assinar e enviar', texto: 'Baixe o PDF, imprima, assine à mão e envie as fotos das páginas com o código da verificação em duas etapas. O sistema monta um PDF novo com o código e o QR.' },
      { alvo: 'entrega-documento', titulo: 'Entrega', texto: 'O paciente recebe pelo app ou por um link por e-mail. Aqui você vê se ele abriu e confirmou o recebimento, ou marca a entrega pessoal.' },
      { alvo: 'retificar-documento', titulo: 'Retificar', texto: 'Para corrigir um documento assinado, abra uma versão nova e escreva o motivo. A anterior continua valendo até a nova ser assinada.' },
      { alvo: 'cancelar-documento', titulo: 'Cancelar', texto: 'Documento que não deve mais valer? Cancele com o motivo (fica só no prontuário). A verificação pública passa a mostrar "cancelado".' },
    ],
  },
  {
    id: 'prontuario',
    // D20 (Plano 10A): sem "documentos" e sem subir a versão — a aba só aparece com o consultório liberado; ela fica descrita no guia `documentos`.
    // Plano 11: o item da IA entra nas perguntas comuns sem subir a versão, pelo mesmo motivo (a IA depende da liberação; os passos não mudam).
    versao: 2, // Plano 14A: a autorização de IA na aba Privacidade (item novo nas perguntas comuns)
    padrao: new RegExp(`^/painel/pacientes/${ID}(/.*)?$`),
    titulo: 'Prontuário',
    ajuda: {
      resumo: 'Tudo do paciente em abas: anamnese, antropometria, gasto energético, atendimentos, exames, evolução, plano alimentar e privacidade.',
      secoes: [
        { titulo: 'Passo a passo', itens: ['Comece pela anamnese (use um modelo para ganhar tempo).', 'Registre as medidas em Antropometria; a Evolução mostra os gráficos.', 'Em Privacidade ficam a cópia dos dados e o pedido de exclusão do paciente.'] },
        { titulo: 'Perguntas comuns', itens: ['Cada acesso ao prontuário fica registrado no "Histórico de acessos" (LGPD).', 'Paciente arquivado sai da agenda e dos conteúdos, mas o prontuário continua guardado.', 'Na aba Exames, "Ler valores com IA" lê o laudo anexado e mostra os valores para você conferir; só as linhas marcadas são salvas.', 'Em Privacidade, "Uso de IA" mostra se o paciente autorizou o uso de IA e os registros; o pedido vai por "Enviar pedido de autorização por e-mail" ou pelo "Registrar termo em papel" (imprimir pelo Chrome ou Edge, para sair o rodapé com o código e o número da página; o paciente assina; fotografar todas as páginas; guardar o original na pasta do paciente e entregar uma via a ele).', 'Na aba Evolução, "Não mostrar peso no app" tira o peso e o IMC do app do paciente; o prontuário e a cópia dos dados não mudam.'] },
      ],
    },
    passos: [
      { alvo: 'cabecalho-paciente', titulo: 'O paciente', texto: 'Nome, idade e situação. O selo mostra se o paciente está arquivado ou bloqueado.' },
      { alvo: 'abas-prontuario', titulo: 'Abas do prontuário', texto: 'Cada parte do acompanhamento fica numa aba. Em tela estreita, a faixa de abas rola para o lado.' },
    ],
  },
  {
    id: 'agenda',
    versao: 1,
    padrao: /^\/painel\/agenda(\/(nova|pendencias|consultas\/.+))?$/,
    titulo: 'Agenda',
    ajuda: {
      resumo: 'As consultas do dia e da semana, marcadas por você, pelo paciente no app ou pela sua página pública.',
      secoes: [
        { titulo: 'Passo a passo', itens: ['Use "Nova consulta" para marcar; o paciente recebe a confirmação e os lembretes.', 'Abra a consulta para remarcar, cancelar, registrar a presença ou iniciar o atendimento.', 'Consultas sem registro de presença aparecem em "Pendências".'] },
        { titulo: 'Perguntas comuns', itens: ['Os lembretes saem 24 h e 2 h antes, por e-mail, notificação no app e WhatsApp (se conectado e autorizado).'] },
      ],
    },
    passos: [
      { alvo: 'periodo-agenda', titulo: 'Dia, semana ou lista', texto: 'Troque a visão e navegue entre os dias. "Hoje" volta para o dia atual.' },
      { alvo: 'nova-consulta', titulo: 'Nova consulta', texto: 'Marque uma consulta presencial ou online; o horário respeita os seus horários de atendimento.' },
    ],
  },
  {
    id: 'horarios',
    versao: 1,
    padrao: /^\/painel\/agenda\/horarios$/,
    titulo: 'Horários de atendimento',
    ajuda: { resumo: 'Os dias e horários em que os pacientes podem marcar consulta, e os bloqueios (férias, feriados).', secoes: [{ titulo: 'Passo a passo', itens: ['Crie uma regra por dia da semana, com início, fim, duração e modalidade.', 'Use os bloqueios para tirar um período da agenda sem apagar as regras.'] }] },
    passos: [
      { alvo: 'regras-horario', titulo: 'Regras', texto: 'Cada regra diz o dia, o horário e a duração das consultas.' },
      { alvo: 'bloqueios-horario', titulo: 'Bloqueios', texto: 'Férias e feriados: o período bloqueado some da agenda dos pacientes.' },
    ],
  },
  {
    id: 'exames-recebidos',
    versao: 1,
    padrao: /^\/painel\/exames-recebidos(\/.*)?$/,
    titulo: 'Exames recebidos',
    ajuda: {
      resumo: 'Os exames que os pacientes enviaram pelo app ficam aqui até você conferir. Nada entra no prontuário sem você aceitar.',
      secoes: [
        {
          titulo: 'O que dá para fazer aqui',
          itens: [
            'Abrir um envio e conferir as páginas, como imagens.',
            'Aceitar: o exame entra na aba Exames do paciente, com o selo "Enviado pelo paciente". Com a IA ativa, dá para aceitar e já pedir a leitura dos valores.',
            'Recusar com um motivo: o arquivo é apagado na hora e o paciente vê o motivo no app.',
          ],
        },
        {
          titulo: 'Perguntas comuns',
          itens: [
            'O recebimento é ligado em Configurações, em "Exames enviados pelos pacientes".',
            'Você recebe no máximo um e-mail a cada 6 horas avisando que há exames novos, sem nome de paciente nem de exame.',
            'Envios não revisados em 90 dias expiram: o arquivo é apagado e o paciente é avisado.',
          ],
        },
      ],
    },
    passos: [{ alvo: 'fila-exames', titulo: 'Exames dos pacientes', texto: 'Os mais antigos ficam no topo. Abra um envio para conferir as páginas e aceitar ou recusar.' }],
  },
  {
    id: 'diarios',
    versao: 1,
    padrao: /^\/painel\/diarios(\/.*)?$/,
    titulo: 'Diários',
    ajuda: { resumo: 'O que os pacientes registram no app (refeição, texto e foto). Os não vistos aparecem primeiro.', secoes: [{ titulo: 'Passo a passo', itens: ['Abra um registro para ver a foto e comentar; o paciente recebe o aviso do comentário no app.'] }, { titulo: 'Perguntas comuns', itens: ['Um registro pode chegar só com "Comeu como no plano" ou "Comeu outra coisa": é a resposta do paciente à refeição do plano, com a refeição e o horário.'] }] },
    passos: [{ alvo: 'feed-diarios', titulo: 'Registros dos pacientes', texto: 'Os registros novos ficam no topo. Abrir um registro marca como visto.' }],
  },
  {
    id: 'conteudos',
    versao: 1,
    padrao: /^\/painel\/conteudos(\/.*)?$/,
    titulo: 'Conteúdos',
    ajuda: {
      resumo: 'Vídeos, receitas e orientações para os pacientes, com quem vê cada um e quantos já abriram.',
      secoes: [{ titulo: 'Passo a passo', itens: ['Escolha o tipo, preencha e salve como rascunho.', 'Em "Quem vê", escolha todos os pacientes, uma etiqueta ou pacientes específicos.', 'Clique em "Publicar"; marque "Avisar pacientes" para mandar a notificação.'] }],
    },
    passos: [{ alvo: 'novo-conteudo', titulo: 'Novo conteúdo', texto: 'Vídeo (link do YouTube ou Vimeo), receita com o valor por porção ou orientação em texto e PDF.' }],
  },
  {
    id: 'alimentos',
    versao: 1,
    padrao: /^\/painel\/alimentos(\/.*)?$/,
    titulo: 'Alimentos',
    ajuda: { resumo: 'A tabela TACO e os alimentos que você cadastrar ("Meu alimento"), com as medidas caseiras.', secoes: [{ titulo: 'Perguntas comuns', itens: ['Alimento usado em algum plano ou receita não pode ser excluído.'] }] },
    passos: [{ alvo: 'busca-alimentos', titulo: 'Busca', texto: 'Procure pelo nome; os seus alimentos aparecem junto com os da TACO.' }],
  },
  {
    id: 'modelos',
    versao: 1,
    padrao: /^\/painel\/(planos\/modelos|anamnese\/modelos)(\/.*)?$/,
    titulo: 'Modelos',
    ajuda: { resumo: 'Modelos de plano alimentar e de anamnese para começar mais rápido. Usar um modelo copia o conteúdo; mudar o modelo depois não muda o que já foi criado.', secoes: [] },
    passos: [{ titulo: 'Modelos', texto: 'Crie um modelo aqui ou salve um plano pronto como modelo pelo editor do plano.' }],
  },
  {
    id: 'configuracoes',
    versao: 5, // Plano 14A: a autorização do paciente no lugar do aviso de IA
    padrao: /^\/painel\/configuracoes(\/.*)?$/,
    titulo: 'Configurações',
    ajuda: {
      resumo: 'Perfil e marca, dados para documentos, horários, WhatsApp, alimentos, modelos, segurança e o tema do painel.',
      secoes: [
        { titulo: 'Perguntas comuns', itens: ['A cor da marca aparece no painel, no app do paciente e no PDF do plano.', 'O tema (claro, escuro ou igual ao aparelho) fica salvo na sua conta.'] },
        {
          titulo: 'Dados para documentos',
          itens: [
            'Em "Perfil e marca", a seção "Dados para documentos" guarda o nome completo, o e-mail e o telefone que saem no carimbo das receitas e dos pareceres, junto com o CRN.',
            'A habilitação em Fitoterapia é uma declaração sua, com o registro no CRN; sem ela, a receita não oferece "Fitoterápico (forma farmacêutica ou fórmula magistral)".',
            'Para assinar documentos, a verificação em duas etapas precisa estar ativa (cartão "Segurança").',
          ],
        },
        {
          titulo: 'Inteligência artificial (IA)',
          itens: [
            'A leitura de laudos com IA só aparece depois que o suporte libera o seu consultório; para ativar, você aceita o aditivo de inteligência artificial.',
            'A IA só sugere: você confere cada valor antes de salvar. Nada entra no prontuário sem você marcar e salvar.',
            'Antes de usar a IA com um paciente, peça a autorização dele (aba Privacidade do paciente, "Uso de IA"): pelo app, pelo link do e-mail ou pelo termo em papel. Recusar ou retirar não muda nada no atendimento, e a retirada vale na hora.',
            'O uso do mês aparece em porcentagem do limite do consultório; com 80% você recebe um aviso, e em 100% a IA para até o dia 1º.',
          ],
        },
      ],
    },
    passos: [
      { alvo: 'cartoes-configuracoes', titulo: 'Tudo num lugar', texto: 'Cada cartão abre uma parte das configurações do consultório.' },
      { alvo: 'tema-form', titulo: 'Tema', texto: 'Claro, escuro ou igual ao aparelho.' },
      { alvo: 'dados-documentos', titulo: 'Dados para documentos', texto: 'Em "Perfil e marca", a seção "Dados para documentos" guarda o nome completo, o e-mail e o telefone do carimbo das receitas e dos pareceres. Mudar depois não altera documento já preparado.' },
    ],
  },
  {
    id: 'whatsapp',
    versao: 1,
    padrao: /^\/painel\/whatsapp$/,
    titulo: 'WhatsApp',
    ajuda: {
      resumo: 'Conecte o número do consultório para os lembretes e confirmações saírem pelo WhatsApp.',
      secoes: [{ titulo: 'Perguntas comuns', itens: ['Sem WhatsApp, os lembretes continuam por e-mail e notificação no app.', 'Só recebem mensagem os pacientes que autorizaram.', 'Se o celular desconectar, o Início avisa e mostra como conectar de novo.'] }],
    },
    passos: [{ alvo: 'conectar-whatsapp', titulo: 'Conectar', texto: 'Leia o código QR com o WhatsApp do celular do consultório (Aparelhos conectados).' }],
  },
  {
    id: 'seguranca',
    versao: 1,
    padrao: /^\/conta\/seguranca$/,
    titulo: 'Segurança da conta',
    ajuda: {
      resumo: 'A verificação em duas etapas pede, além da senha, um código de 6 dígitos do aplicativo autenticador do celular. Ela é obrigatória para assinar documentos.',
      secoes: [
        {
          titulo: 'Passo a passo',
          itens: [
            'Instale um aplicativo autenticador no celular (Google Authenticator, Authy, 1Password…).',
            'Clique em "Ativar verificação em duas etapas" e confirme a sua senha.',
            'Leia o QR Code com o aplicativo e digite o código de 6 dígitos que ele mostra.',
            'Guarde os códigos de recuperação num lugar seguro: cada um funciona uma vez, se você perder o celular.',
          ],
        },
        {
          titulo: 'Perguntas comuns',
          itens: [
            'Ao enviar um documento assinado à mão (digitalizado), o sistema pede o código do aplicativo a cada envio.',
            'Depois de 5 códigos errados, espere 15 minutos para tentar de novo.',
            'Se o código não confere, confira se a hora do celular está automática.',
          ],
        },
      ],
    },
    passos: [{ alvo: 'ativar-2fa', titulo: 'Ativar', texto: 'Confirme a senha, leia o QR Code com o aplicativo autenticador e digite o código de 6 dígitos.' }],
  },
];

export function guiaDaRota(caminho: string): Guia | null {
  return GUIAS.find((g) => g.padrao.test(caminho)) ?? null;
}

/** true = ainda não está em nenhum dos `estados` na versão atual. */
export function precisaDoGuia(p: ProgressoGuia, g: Guia, estados: EstadoGuia[]): boolean {
  const r = p[g.id];
  return !r || r.v < g.versao || !estados.includes(r.estado);
}
