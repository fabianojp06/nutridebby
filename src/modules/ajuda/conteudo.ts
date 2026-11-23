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
    versao: 5, // Plano 12: o passo do menu passou a citar "Exames recebidos"; 3 = Plano 15: o passo do menu cita "Dúvidas dos pacientes" (★ DO-6)
    // 4 = Plano 20: o passo do menu cita "Financeiro"; 5 = Plano 25: "Mensagens" no lugar das dúvidas (sobe +1 sobre a da main no rebase)
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
      { alvo: 'menu', titulo: 'Menu do painel', texto: 'Pacientes, Agenda, Diários, Mensagens, Conteúdos, Financeiro e Configurações ficam no topo. Com o recebimento de exames ligado, "Exames recebidos" aparece também, com o número dos que aguardam. Em "Mensagens", o número soma as conversas não lidas e as dúvidas abertas da IA Nutri.' },
      { alvo: 'proxima-consulta', titulo: 'Próxima consulta', texto: 'A consulta mais próxima de hoje, com atalhos para o prontuário e para a chamada online.' },
      { alvo: 'atalhos', titulo: 'Atalhos', texto: 'Cadastre um paciente, marque uma consulta ou publique um conteúdo direto do Início.' },
      { alvo: 'tema', titulo: 'Claro ou escuro', texto: 'Este botão liga e desliga o modo escuro. A escolha fica salva na sua conta, em qualquer aparelho.' },
      { alvo: 'ajuda', titulo: 'Ajuda em cada tela', texto: 'Em qualquer tela, este botão explica o que dá para fazer ali e abre o manual completo.' },
      { alvo: 'conta', titulo: 'Sua conta', texto: 'Perfil e marca, segurança, o manual, este tour e o Sair ficam aqui.' },
    ],
  },
  {
    id: 'pacientes',
    versao: 2, // Plano 18: abas da lista, Ações e o cadastro em seções
    padrao: /^\/painel\/pacientes(\/novo)?$/,
    titulo: 'Pacientes',
    ajuda: {
      resumo: 'A lista dos seus pacientes. Tudo começa aqui: cadastrar, convidar para o app e abrir o prontuário.',
      secoes: [{ titulo: 'Passo a passo', itens: ['Clique em "Novo paciente" e preencha nome, data de nascimento, sexo e e-mail.', 'Ao salvar, o paciente recebe o convite para o app por e-mail (e por WhatsApp, se você marcar "Enviar convite por WhatsApp" com a autorização). Se o convite vencer, use "Reenviar convite" em "Acesso ao app", na aba Perfil da ficha.', 'Use a busca para achar pelo nome ou pelo e-mail; os arquivados ficam na aba Inativos.'] }],
    },
    passos: [
      { alvo: 'novo-paciente', titulo: 'Novo paciente', texto: 'Comece cadastrando o paciente. O convite para o app sai por e-mail ao salvar.' },
      { alvo: 'busca-pacientes', titulo: 'Busca', texto: 'Ache um paciente pelo nome ou pelo e-mail. As abas separam ativos e arquivados; os bloqueados ficam em Ver bloqueados.' },
      // Plano 18 (§8.1): o alvo é a coluna "Ações" da tabela (sem paciente na lista, o passo aparece centralizado)
      { alvo: 'acoes-paciente', titulo: 'Ações', texto: 'Em Ações você abre a ficha, edita o cadastro, arquiva ou reativa o paciente sem sair da lista.' },
      // Plano 18 (§8.4): o alvo está em "Novo paciente" (na lista, o passo aparece centralizado)
      { alvo: 'cadastro-paciente', titulo: 'Cadastro do paciente', texto: 'O cadastro fica em seções. Só nome, nascimento, sexo e e-mail são obrigatórios; o resto completa o registro da primeira consulta.' },
    ],
  },
  {
    id: 'plano-alimentar',
    // Plano 14B-2: item da IA sem subir a versão (depende da liberação, como no Plano 11)
    versao: 2, // Plano 17: a seção Lembretes no app
    padrao: new RegExp(`^/painel/pacientes/${ID}/plano-alimentar(/.*)?$`),
    titulo: 'Plano alimentar',
    ajuda: {
      resumo: 'Monte o plano por refeições, com os alimentos da TACO ou os seus. O salvamento é automático; o paciente só vê depois de "Publicar".',
      secoes: [
        { titulo: 'Passo a passo', itens: ['Crie as refeições e adicione os alimentos com a quantidade em gramas ou medida caseira.', 'Confira os totais e a meta ao lado.', 'Clique em "Publicar": a versão anterior é arquivada e o paciente recebe o aviso no app.'] },
        {
          titulo: 'Perguntas comuns',
          itens: [
            'Para mudar um plano publicado, use "Editar": uma versão nova é criada, e a publicada continua valendo até você publicar a nova.',
            'O PDF do plano fica pronto em alguns segundos depois de publicar.',
            '"Gerar rascunho com IA": informe a meta, os macronutrientes e as refeições; a IA escolhe alimentos da TACO e da sua tabela, e todas as contas são do sistema. O plano publicado leva o selo "Elaborado com apoio de IA e revisado pela nutricionista".',
            'Lembretes no app: cada paciente recebe no máximo 24 lembretes por dia, sempre entre 6h e 22h no fuso do consultório. A tela não deixa salvar acima disso; se um plano novo passar do limite, os lembretes de menor prioridade (a água primeiro) ficam de fora naquele dia.',
          ],
        },
      ],
    },
    passos: [
      { alvo: 'editor-plano', titulo: 'Refeições e alimentos', texto: 'Cada refeição é um bloco. A busca de alimentos aceita parte do nome; a quantidade pode ser em gramas ou medida caseira.' },
      { alvo: 'publicar-plano', titulo: 'Publicar', texto: 'O paciente só vê o plano depois de publicado. Tudo o que você digita já fica salvo no rascunho.' },
      { alvo: 'lembretes-app', titulo: 'Lembretes no app', texto: 'Configure água, avisos das refeições do plano, suplemento e lembrete livre. O paciente pode desligar qualquer um; o nome do suplemento e o texto livre aparecem só dentro do app.' },
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
    // Plano 15 (US-170, US-175, DP-17): antes do guia `prontuario`, cujo padrão casa qualquer aba da ficha (o primeiro que casa ganha)
    id: 'ia-nutri',
    versao: 1,
    padrao: new RegExp(`^/painel/pacientes/${ID}/ia-nutri$`),
    titulo: 'IA Nutri do paciente',
    ajuda: {
      resumo: 'Libere a IA Nutri paciente por paciente. Depois, o paciente lê o texto e decide no app. Aqui você lê as conversas dele com a IA e registra a desativação quando ele pedir.',
      secoes: [
        {
          titulo: 'Perguntas comuns',
          itens: [
            'Marque "Liberar a IA Nutri para este paciente" e salve. Para bloquear de novo, desmarque: a entrada some do app dele, e as conversas ficam até o prazo.',
            'Se o paciente estiver com o peso oculto no app, o sistema pede a sua confirmação antes de liberar.',
            'Se o paciente pedir para desativar e não conseguir pelo app (por exemplo, arquivado), use "Registrar desativação a pedido do paciente": as conversas dele com a IA Nutri são apagadas.',
          ],
        },
      ],
    },
    passos: [{ alvo: 'ia-nutri-aba', titulo: 'IA Nutri do paciente', texto: 'Libere a IA Nutri paciente por paciente. Depois, o paciente lê o texto e decide no app. Aqui você lê as conversas dele com a IA e registra a desativação quando ele pedir.' }],
  },
  {
    // Plano 18 (§8.3): só o Início da ficha; antes do `prontuario`, que casa todas as abas (os passos novos só têm alvo aqui).
    // Título "Início do paciente": "Início" é o do guia de boas-vindas (o manual completo lista um h2 por guia).
    id: 'inicio-paciente',
    versao: 2, // Plano 18, PR 2: o cartão No app
    padrao: new RegExp(`^/painel/pacientes/${ID}$`),
    titulo: 'Início do paciente',
    ajuda: {
      resumo: 'O Início reúne o que já foi feito com o paciente: o resumo, o botão "Adicionar" e uma seção para cada parte do acompanhamento, com os três registros mais recentes.',
      secoes: [
        {
          titulo: 'Passo a passo',
          itens: [
            'Use "Adicionar" para registrar anamnese, antropometria, gasto energético, exame, atendimento ou prescrição sem procurar a aba.',
            'Abra uma seção para ver os registros mais recentes; "Ver todos" leva à aba com a lista completa.',
            'O cadastro, o acesso ao app e as etiquetas ficam no Perfil.',
            'O cartão "No app do paciente" mostra o acesso ao app, o plano, os documentos (só quando liberados no consultório) e os conteúdos que o paciente vê; "Ver detalhes" abre a página com notificações, lembretes, evolução, jornada, exames, diário e IA Nutri, contados com as mesmas regras do app.',
          ],
        },
        { titulo: 'Perguntas comuns', itens: ['Paciente bloqueado por pedido de exclusão não tem o botão "Adicionar": o prontuário é só para consulta.'] },
      ],
    },
    passos: [
      { alvo: 'cabecalho-paciente', titulo: 'O paciente', texto: 'Nome, idade, situação e as medidas da última avaliação, com a data. O selo mostra se o paciente está arquivado ou bloqueado.' },
      { alvo: 'abas-prontuario', titulo: 'Abas do prontuário', texto: 'Início reúne o que já foi feito; Perfil guarda o cadastro. Cada parte do acompanhamento tem a sua aba.' },
      { alvo: 'adicionar-prontuario', titulo: 'Adicionar', texto: 'Um botão só para registrar anamnese, medidas, exames, atendimentos e prescrições.' },
      { alvo: 'secoes-inicio', titulo: 'Seções', texto: 'Cada seção mostra quantos registros há e os três mais recentes. O selo No app marca o que o paciente vê no app.' },
      { alvo: 'no-app-cartao', titulo: 'No app do paciente', texto: 'O que o paciente enxerga no app, contado com as mesmas regras do app.' },
    ],
  },
  {
    // Plano 18 (§8.4): só a aba Perfil; antes do `prontuario`, que casa todas as abas. Título "Perfil do paciente":
    // distinto dos outros (o manual completo lista um h2 por guia; `e2e/manual.spec.ts`).
    id: 'perfil-paciente',
    versao: 1,
    padrao: new RegExp(`^/painel/pacientes/${ID}/perfil$`),
    titulo: 'Perfil do paciente',
    ajuda: {
      resumo: 'O Perfil guarda o cadastro do paciente em seções (dados gerais, contato e endereço, observação), o acesso ao app e as etiquetas.',
      secoes: [
        {
          titulo: 'Passo a passo',
          itens: [
            'Só nome, nascimento, sexo e e-mail são obrigatórios; o resto completa o registro da primeira consulta. Depois, use "Salvar cadastro".',
            'Preencha o nome social só a pedido do paciente.',
            'Se o convite para o app vencer, use "Reenviar convite" em "Acesso ao app".',
          ],
        },
        {
          titulo: 'Perguntas comuns',
          itens: [
            'O CPF não aparece na lista nem no app. Se outro paciente do consultório já tiver o mesmo CPF, o link "Abrir o cadastro existente (abre em nova aba)" mostra o cadastro dele.',
            'A observação pode ir na cópia dos dados que o paciente pedir (LGPD). Para anotações só suas, use as notas privadas do atendimento.',
            'Paciente bloqueado por pedido de exclusão tem o cadastro só para consulta.',
          ],
        },
      ],
    },
    passos: [{ alvo: 'cadastro-paciente', titulo: 'Cadastro do paciente', texto: 'O cadastro fica em seções. Só nome, nascimento, sexo e e-mail são obrigatórios; o resto completa o registro da primeira consulta.' }],
  },
  {
    id: 'prontuario',
    // D20 (Plano 10A): sem "documentos" e sem subir a versão — a aba só aparece com o consultório liberado; ela fica descrita no guia `documentos`.
    // Plano 11: o item da IA entra nas perguntas comuns sem subir a versão, pelo mesmo motivo (a IA depende da liberação; os passos não mudam).
    // Plano 14B-2: item da IA sem subir a versão (depende da liberação, como no Plano 11)
    versao: 3, // Plano 14A: a autorização de IA na aba Privacidade (item novo nas perguntas comuns); 3 = Plano 18: abas Início e Perfil
    padrao: new RegExp(`^/painel/pacientes/${ID}(/.*)?$`),
    titulo: 'Prontuário',
    ajuda: {
      resumo: 'Tudo do paciente em abas: o Início reúne o que já foi feito, o Perfil guarda o cadastro, e as outras trazem anamnese, antropometria, gasto energético, atendimentos, exames, evolução, plano alimentar e privacidade.',
      secoes: [
        { titulo: 'Passo a passo', itens: ['No Início, veja o que já foi feito; no Perfil, confira o cadastro. Depois, comece pela anamnese (use um modelo para ganhar tempo).', 'Registre as medidas em Antropometria; a Evolução mostra os gráficos.', 'Em Privacidade ficam a cópia dos dados e o pedido de exclusão do paciente.'] },
        { titulo: 'Perguntas comuns', itens: ['Cada acesso ao prontuário fica registrado no "Histórico de acessos" (LGPD).', 'Paciente arquivado sai da agenda e dos conteúdos, mas o prontuário continua guardado.', 'Na aba Exames, "Ler valores com IA" lê o laudo anexado e mostra os valores para você conferir; só as linhas marcadas são salvas.', 'Em Privacidade, "Uso de IA" mostra se o paciente autorizou o uso de IA e os registros; o pedido vai por "Enviar pedido de autorização por e-mail" ou pelo "Registrar termo em papel" (imprimir pelo Chrome ou Edge, para sair o rodapé com o código e o número da página; o paciente assina; fotografar todas as páginas; ao salvar, digitar o código de referência do rodapé do papel; guardar o original na pasta do paciente e entregar uma via a ele).', 'Na aba Evolução, "Não mostrar peso no app" tira o peso e o IMC do app do paciente; o prontuário e a cópia dos dados não mudam.', '"Resumo do histórico (IA)": um resumo do prontuário antes da consulta, com cada frase ligada ao registro de onde veio. Só com a autorização do paciente; as notas privadas só vão se você marcar "Incluir notas privadas".'] },
      ],
    },
    passos: [
      { alvo: 'cabecalho-paciente', titulo: 'O paciente', texto: 'Nome, idade, situação e as medidas da última avaliação, com a data. O selo mostra se o paciente está arquivado ou bloqueado.' },
      { alvo: 'abas-prontuario', titulo: 'Abas do prontuário', texto: 'Início reúne o que já foi feito; Perfil guarda o cadastro. Cada parte do acompanhamento tem a sua aba.' },
    ],
  },
  {
    id: 'agenda',
    versao: 2, // Plano 20: Realizada gera a cobrança (sobe +1 sobre a da main no rebase)
    padrao: /^\/painel\/agenda(\/(nova|pendencias|consultas\/.+))?$/,
    titulo: 'Agenda',
    ajuda: {
      resumo: 'As consultas do dia e da semana, marcadas por você, pelo paciente no app ou pela sua página pública.',
      secoes: [
        { titulo: 'Passo a passo', itens: ['Use "Nova consulta" para marcar; o paciente recebe a confirmação e os lembretes.', 'Abra a consulta para remarcar, cancelar, registrar a presença ou iniciar o atendimento.', 'Ao marcar "Realizada" (ou registrar o atendimento ligado à consulta), a cobrança é criada no Financeiro com o valor da consulta, se ele estiver configurado. A seção "Cobrança" da consulta mostra o valor e o recebimento.', 'Consultas sem registro de presença aparecem em "Pendências".'] },
        {
          titulo: 'Perguntas comuns',
          itens: [
            'Os lembretes saem 24 h e 2 h antes, por e-mail, notificação no app e WhatsApp (se conectado e autorizado).',
            'Marcar "Faltou" não cria cobrança. Se a consulta já tinha uma, o aviso na tela diz o que fazer no Financeiro.',
          ],
        },
      ],
    },
    passos: [
      { alvo: 'periodo-agenda', titulo: 'Dia, semana ou lista', texto: 'Troque a visão e navegue entre os dias. "Hoje" volta para o dia atual.' },
      { alvo: 'nova-consulta', titulo: 'Nova consulta', texto: 'Marque uma consulta presencial ou online; o horário respeita os seus horários de atendimento.' },
      // Plano 20: sem alvo (não há `data-guia` na lista nem no "Realizada"): abre no centro em qualquer tela da agenda
      {
        titulo: 'Cobrança da consulta',
        texto: 'Quando você marca a consulta como "Realizada", a cobrança é criada sozinha no Financeiro, com o valor da consulta. Confira o valor e o recebimento na seção "Cobrança" da consulta. Sem o valor configurado, nada é criado.',
      },
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
    id: 'duvidas',
    versao: 1, // Plano 25 (CH-D45): só o título virou "Dúvidas da IA Nutri"; a versão sobe na T9 (CH-D55)
    padrao: /^\/painel\/duvidas(\/.*)?$/,
    titulo: 'Dúvidas da IA Nutri',
    ajuda: {
      resumo: 'Aqui chegam as perguntas que os pacientes enviaram pela IA Nutri e as mensagens com sinal de risco, que ficam no topo. Abra a dúvida para ler, siga o protocolo nas de risco e toque em "Marcar como vista": o paciente vê no app que a dúvida foi vista. A resposta você dá na consulta ou pelo canal que já usa.',
      secoes: [
        {
          titulo: 'Perguntas comuns',
          itens: [
            'Abrir uma dúvida fica registrado no "Histórico de acessos" do paciente.',
            'A mensagem com sinal de risco de um paciente que desativou a IA Nutri é mostrada uma vez e apagada ao abrir: anote o que for preciso antes de sair da página.',
            'A conversa inteira do paciente com a IA fica na aba "IA Nutri" da ficha dele.',
          ],
        },
      ],
    },
    passos: [{ alvo: 'fila-duvidas', titulo: 'Dúvidas da IA Nutri', texto: 'As mensagens com sinal de risco ficam no topo, depois as mais antigas. Abra a dúvida para ler e, depois de tratar, toque em "Marcar como vista".' }],
  },
  {
    id: 'mensagens',
    versao: 1, // Plano 25 (T6a): a caixa e a nova conversa; a T6b acrescenta os passos da conversa sem subir a versão (CH-D55)
    padrao: /^\/painel\/mensagens(\/.*)?$/,
    titulo: 'Mensagens',
    ajuda: {
      resumo: 'As conversas por mensagens com os pacientes. A caixa mostra quem escreveu, a conversa mais recente primeiro, e nunca o texto das mensagens: ele só aparece quando você abre a conversa.',
      secoes: [
        {
          titulo: 'O que dá para fazer aqui',
          itens: [
            'Ver as conversas e, em "Não lidas", só as que têm mensagem do paciente ainda não lida.',
            'Achar um paciente pelo nome em "Buscar paciente".',
            'Começar uma conversa em "Nova conversa": a lista mostra os pacientes ativos, e quem ainda não usa o app aparece com "Sem acesso ao app".',
          ],
        },
        {
          titulo: 'Perguntas comuns',
          itens: [
            'A conversa com mensagem que pode indicar risco fica no topo, com o selo "Sinal de risco", até você abrir a conversa.',
            'O número ao lado de "Mensagens", no menu, soma as conversas com mensagem não lida e as dúvidas abertas da IA Nutri.',
            'As dúvidas que a IA Nutri encaminha ficam na aba "Dúvidas da IA Nutri", que aparece quando a IA Nutri está ativa ou quando há dúvida aberta.',
          ],
        },
      ],
    },
    passos: [
      { alvo: 'mensagens-abas', titulo: 'Seções de Mensagens', texto: '"Conversas" reúne as conversas com os pacientes. "Dúvidas da IA Nutri" aparece quando a IA Nutri está ativa ou quando há dúvida aberta.' },
      { alvo: 'mensagens-filtro', titulo: 'Filtro e busca', texto: 'Escolha "Todas" ou "Não lidas" e busque o paciente pelo nome.' },
      { alvo: 'mensagens-caixa', titulo: 'Conversas', texto: 'Cada linha mostra o paciente, quando chegou a última mensagem, de que tipo ela é e quantas não foram lidas. O texto só aparece ao abrir a conversa.' },
      { alvo: 'nova-conversa', titulo: 'Nova conversa', texto: 'Escolha o paciente para abrir a conversa com ele.' },
      { alvo: 'busca-nova-conversa', titulo: 'Escolher o paciente', texto: 'Busque pelo nome. Quem ainda não usa o app aparece com "Sem acesso ao app".' },
    ],
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
    versao: 2, // Plano 14B: modelos sugeridos pela IA (a marca e a aprovação; quem já viu o tour, vê de novo)
    padrao: /^\/painel\/(planos\/modelos|anamnese\/modelos)(\/.*)?$/,
    titulo: 'Modelos',
    ajuda: {
      resumo: 'Modelos de plano alimentar e de anamnese para começar mais rápido. Usar um modelo copia o conteúdo; mudar o modelo depois não muda o que já foi criado.',
      secoes: [{ titulo: 'Modelos sugeridos pela IA', itens: ['Modelos sugeridos pela IA chegam com a marca "Sugestão da IA — revise" e só podem ser usados com pacientes depois de "Aprovar modelo".'] }],
    },
    passos: [
      { titulo: 'Modelos', texto: 'Crie um modelo aqui ou salve um plano pronto como modelo pelo editor do plano.' },
      { titulo: 'Modelos sugeridos pela IA', texto: 'Modelos sugeridos pela IA chegam com a marca "Sugestão da IA — revise" e só podem ser usados com pacientes depois de "Aprovar modelo".' },
    ],
  },
  {
    id: 'configuracoes',
    versao: 8, // Plano 15: o aditivo 1.2 e a IA Nutri (texto e passo novos); a 7 foi a do aditivo 1.1 (Plano 14B-2), a 6 a dos modelos sugeridos pela IA (Plano 14B-1)
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
            'A IA (leitura de laudos, resumo do histórico e rascunho de plano) só aparece depois que o suporte libera o seu consultório; para ativar, você aceita o aditivo de inteligência artificial.',
            'O aditivo está na versão 1.2, que inclui o resumo do histórico, o rascunho de plano alimentar e a IA Nutri para pacientes. Quem aceitou a versão 1.1 continua usando a leitura de laudos, o resumo, o rascunho e os modelos; só a IA Nutri pede o aceite da 1.2 ("Aceitar a versão atual").',
            'A IA só sugere: você confere cada valor antes de salvar. Nada entra no prontuário sem você marcar e salvar.',
            'Antes de usar a IA com um paciente, peça a autorização dele (aba Privacidade do paciente, "Uso de IA"): pelo app, pelo link do e-mail ou pelo termo em papel. Recusar ou retirar não muda nada no atendimento, e a retirada vale na hora.',
            'O uso do mês aparece em porcentagem do limite do consultório; com 80% você recebe um aviso, e em 100% a IA para até o dia 1º.',
            'Modelos sugeridos pela IA: escolha a área e a IA prepara 2 modelos de plano e 1 de anamnese com os alimentos da sua tabela, sem nenhum dado de paciente.',
            'IA Nutri para pacientes: ative em Configurações, libere paciente por paciente na ficha e acompanhe a fila "Dúvidas dos pacientes".',
          ],
        },
      ],
    },
    passos: [
      { alvo: 'cartoes-configuracoes', titulo: 'Tudo num lugar', texto: 'Cada cartão abre uma parte das configurações do consultório.' },
      { alvo: 'tema-form', titulo: 'Tema', texto: 'Claro, escuro ou igual ao aparelho.' },
      { alvo: 'dados-documentos', titulo: 'Dados para documentos', texto: 'Em "Perfil e marca", a seção "Dados para documentos" guarda o nome completo, o e-mail e o telefone do carimbo das receitas e dos pareceres. Mudar depois não altera documento já preparado.' },
      // Plano 14B: a seção só aparece com a IA ativa no consultório; sem ela, o passo abre no centro, sem destaque (como o de cima)
      { alvo: 'modelos-ia', titulo: 'Modelos sugeridos pela IA', texto: 'Com a IA ativa, escolha a área e clique em "Gerar modelos": a IA prepara 2 modelos de plano e 1 de anamnese, sem nenhum dado de paciente. Revise e aprove cada um antes de usar com pacientes.' },
      // Plano 15: a subseção só aparece com a IA ativa no consultório (como a dos modelos)
      { alvo: 'ia-nutri-secao', titulo: 'IA Nutri para pacientes', texto: 'Com a IA ativa, a IA Nutri responde dúvidas dos pacientes sobre o plano publicado. Ative aqui, libere paciente por paciente na ficha e acompanhe a fila "Dúvidas dos pacientes".' },
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
  {
    // Plano 20: no FIM da lista (o Plano 18 insere guias antes de 'prontuario'). Textos finais do revisor-interface
    // (17/11/2026). O tour mostra todos os passos em qualquer tela do Financeiro: o passo cujo alvo não está na tela abre
    // no centro, e por isso o título dos passos de outras telas começa pelo nome da tela.
    id: 'financeiro',
    versao: 1,
    padrao: /^\/painel\/financeiro(\/.*)?$/,
    titulo: 'Financeiro',
    ajuda: {
      resumo: 'O caixa do consultório: o saldo, o que entrou e saiu no mês, os pagamentos pendentes dos pacientes e os relatórios. Só você vê; nada é enviado ao paciente.',
      secoes: [
        {
          titulo: 'Para começar',
          itens: [
            'Em "Configurações", informe a data e o valor do saldo do caixa e o valor da sua consulta.',
            'Com o valor da consulta informado, cada consulta marcada como Realizada gera a cobrança sozinha, na categoria Consultas.',
            'Não escreva informações de saúde na descrição dos lançamentos.',
          ],
        },
        {
          titulo: 'Perguntas comuns',
          itens: [
            'O saldo atual soma ao saldo do caixa tudo o que foi recebido e pago a partir da data do saldo.',
            'Lançamento não se apaga: "Cancelar lançamento" tira o lançamento dos totais e do saldo, mas ele continua na lista, como Cancelado.',
            'Categoria com lançamentos não pode ser excluída: use "Arquivar" para que ela não apareça nos formulários.',
            'A categoria Consultas pode mudar de nome, mas não pode ser arquivada nem excluída.',
            'Um lançamento recebido ou pago conta no mês do pagamento; em aberto, no mês do vencimento.',
            'Se você incluir o nome dos pacientes no CSV, o download fica registrado no Histórico de acessos de cada paciente.',
          ],
        },
      ],
    },
    passos: [
      { alvo: 'financeiro-secoes', titulo: 'Seções do Financeiro', texto: 'Resumo, Lançamentos, Pagamentos pendentes, Relatórios e Configurações ficam nesta barra, em todas as telas do Financeiro.' },
      { alvo: 'financeiro-cartoes', titulo: 'Resumo do mês', texto: 'No Resumo: o saldo atual, as entradas e as saídas do mês e os pagamentos pendentes dos pacientes. Os cartões só aparecem depois que você configura o Financeiro.' },
      { alvo: 'financeiro-saldo', titulo: 'Configurações: saldo do caixa', texto: 'Em "Configurações", informe quanto havia no caixa numa data. O saldo atual soma a esse valor tudo o que foi recebido e pago a partir dela.' },
      { alvo: 'financeiro-valor-consulta', titulo: 'Configurações: valor da consulta', texto: 'Em "Configurações", o valor é sugerido em toda cobrança criada ao marcar a consulta como Realizada, e você pode mudá-lo em cada cobrança. Sem o valor, a consulta não gera cobrança.' },
      { alvo: 'financeiro-categorias', titulo: 'Configurações: categorias', texto: 'Crie, renomeie ou arquive as categorias das entradas e das saídas. A categoria Consultas é a das cobranças das consultas: pode mudar de nome, mas não pode ser arquivada.' },
      { alvo: 'financeiro-filtros', titulo: 'Lançamentos: filtros', texto: 'Escolha o mês, o tipo, a categoria, a situação ou a forma de pagamento e clique em "Filtrar". Os totais acima da lista seguem o filtro e não contam os cancelados.' },
      { alvo: 'financeiro-novo', titulo: 'Novo lançamento', texto: 'Informe valor, categoria e vencimento. Marque "Já foi recebido" (ou "Já foi pago") se o dinheiro já entrou ou saiu. Na entrada, você pode ligar o lançamento a um paciente. Não escreva informações de saúde na descrição.' },
      { alvo: 'financeiro-receber', titulo: 'Receber ou pagar', texto: 'Use "Marcar como recebido" (ou "Marcar como pago") e informe a data e a forma de pagamento. Foi engano? "Desfazer recebimento" volta o lançamento para em aberto.' },
      { alvo: 'financeiro-cancelar', titulo: 'Cancelar', texto: 'Lançamento não se apaga: "Cancelar lançamento" pede o motivo e não tem volta. Ele continua na lista, como Cancelado, e sai dos totais e do saldo.' },
      { alvo: 'financeiro-pendentes', titulo: 'Pagamentos pendentes', texto: 'As cobranças que os pacientes ainda não pagaram, uma linha por paciente, começando pela mais antiga. Clique em "Ver" para receber cada uma. Esta lista é só sua: nada é enviado ao paciente.' },
      { alvo: 'financeiro-relatorios', titulo: 'Relatórios', texto: 'O fluxo de caixa do ano, mês a mês, e as entradas e saídas dos últimos 12 meses. Só entram os lançamentos recebidos ou pagos. Troque o ano em "Ano".' },
      { alvo: 'financeiro-csv', titulo: 'CSV para o contador', texto: 'Escolha o período (até 12 meses) e clique em "Baixar CSV". Sem marcar "Incluir o nome dos pacientes", o arquivo sai sem os nomes e sem a descrição das entradas de pacientes.' },
    ],
  },
];

export function guiaDaRota(caminho: string): Guia | null {
  return GUIAS.find((g) => g.padrao.test(caminho)) ?? null;
}

export { precisaDoGuia } from './precisa-do-guia';
