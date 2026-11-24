import type { MotivoSemPermissao } from '@/lib/session-rules';

/**
 * Plano 26 (spec §6.2): textos da recepção, exatos da spec e neutros em gênero para a pessoa da recepção. A T7 acrescentou
 * `MSG_EQUIPE` e `EQUIPE_LIGADA` (RE-D52) neste arquivo.
 */
export const MSG_RECEPCAO = {
  /** RE-D47 (US-490): "Sem permissão", com um texto por motivo. */
  semPermissao: {
    titulo: 'Sem permissão',
    motivo: {
      nutri: 'Esta página é só da nutricionista.',
      financeiro: 'Você não tem permissão para o Financeiro. Peça à nutricionista.',
    } satisfies Record<MotivoSemPermissao, string>,
    voltar: 'Voltar ao início',
  },
  /** RN-503 (RE-D45): a conta desativada. */
  acessoDesativado: {
    titulo: 'Acesso desativado',
    texto: 'Seu acesso a este consultório foi desativado. Fale com a nutricionista.',
    /**
     * Revisão da P26-07 (RN-500): a conta ativa sem o aceite do Termo de confidencialidade da equipe (senha criada fora do
     * convite). RASCUNHO, sem fonte na spec (§6.2): vai à tabela de textos do Plano 26 na T12.
     */
    termoPendente: 'Seu acesso ainda não foi liberado: falta aceitar o Termo de confidencialidade da equipe. Fale com a nutricionista.',
  },
  /** RN-501 (RE-D29): o DPA do consultório pendente. */
  contratoPendente: {
    titulo: 'Contrato do consultório pendente',
    texto: 'O contrato de tratamento de dados do consultório precisa ser aceito pela nutricionista. Peça para ela entrar no NutriDebby.',
  },
  /** RN-500 (RE-D20): o 2FA obrigatório, na Segurança da conta. */
  doisFatoresObrigatorio: 'A recepção precisa da verificação em duas etapas. Configure agora para continuar.',
  /** Plano 26 (T8, §6.2 "Menu da conta"): o nome e o papel no menu da conta da recepção. */
  menuDaConta: (nome: string) => `${nome} · Recepção`,
  /** Revisão da P26-08: o e-mail no menu da conta, neutro em gênero (o "Conectado como" é da nutricionista). RASCUNHO, sem fonte na spec (§6.2). */
  emailDaConta: (email: string) => `E-mail da conta: ${email}.`,
  /** RE-D59 (§6.2 "Solicitações (recepção)"): os pedidos de pessoa nova ficam com a nutricionista. */
  pedidosPessoaNova: 'Pedidos de pessoas ainda sem cadastro ficam com a nutricionista.',
  /** RN-509 (§6.2 "Presença (recepção)"): ela só registra "Faltou". */
  presenca: 'Para marcar como realizada, a nutricionista registra o atendimento ou marca a presença.',
} as const;

/**
 * RE-D52 (Plano 26): a Equipe nasce desligada no PR 2 e é ligada na T11b (PR 3), com as telas de trabalho da recepção. Com
 * a constante desligada, `/painel/configuracoes/equipe` responde `notFound()`, o cartão "Equipe" some do hub de Configurações
 * e TODA action da Equipe recusa antes de ler a sessão (um POST direto não grava nada). O módulo (`equipe.ts`) não olha a
 * constante: os testes o exercitam desligado. `boolean`, não o literal: o TypeScript não estreita o ramo ligado.
 */
export const EQUIPE_LIGADA: boolean = false;

/** RN-499, RE-D18: até 3 pessoas ativas na recepção de cada consultório (linhas de equipe_membros sem `desativada_em`). */
export const LIMITE_DA_EQUIPE = 3;

/** Plano 26 (spec §6.2, US-488, US-489): os textos da Equipe, do convite e do primeiro acesso, exatos e neutros em gênero. */
export const MSG_EQUIPE = {
  titulo: 'Equipe',
  explicacao:
    'A recepção cuida da agenda e do cadastro dos pacientes. Ela não vê anamnese, medidas, exames, planos, documentos, notas do atendimento, a observação do cadastro nem nada da IA. Tudo o que ela cadastra ou altera, e cada cadastro que ela abre, fica no Histórico de acessos do paciente.',
  convidar: 'Convidar recepcionista',
  dicaConvite: 'Convide só quem trabalha para você no consultório. A pessoa vai aceitar um termo de confidencialidade.',
  campos: { nome: 'Nome', email: 'E-mail', financeiro: 'Permitir acesso ao Controle Financeiro' },
  dicaFinanceiro: 'Lançamentos, pagamentos pendentes e relatórios financeiros. As configurações do Financeiro continuam só suas.',
  enviar: 'Enviar convite',
  colunas: ['Nome', 'E-mail', 'Situação', 'Financeiro', 'Último acesso', 'Ações'],
  situacao: {
    conviteEnviado: (data: string, hora: string) => `Convite enviado (vale até ${data} às ${hora})`,
    conviteVencido: 'Convite vencido',
    ativo: 'Ativo',
    desativado: (data: string) => `Acesso desativado em ${data}`,
  },
  ultimoAcesso: (data: string, hora: string) => `Último acesso: ${data} às ${hora}`,
  aindaNaoEntrou: 'Ainda não entrou',
  acoes: { reenviar: 'Reenviar convite', salvarPermissao: 'Salvar permissão', desativar: 'Desativar', reativar: 'Reativar' },
  /** O `aria-label` de cada botão da linha: "{ação} {nome}" (§6.2). */
  rotuloDaAcao: (acao: string, nome: string) => `${acao} ${nome}`,
  /** O `aria-label` da caixa do Financeiro na linha (a coluna da tabela não é um `<label>`). */
  rotuloDoFinanceiro: (nome: string) => `Permitir acesso ao Controle Financeiro: ${nome}`,
  ok: {
    convidada: 'Convite enviado.',
    reenviado: 'Convite reenviado.',
    permissao: 'Permissão atualizada.',
    desativada: 'Acesso desativado.',
    reativada: 'Acesso reativado.',
  },
  limite: 'O consultório pode ter até 3 pessoas ativas na recepção.',
  erros: {
    nome: 'Informe o nome (3 a 80 caracteres)',
    email: 'Informe um e-mail válido',
    emailEmUso: 'Este e-mail já tem uma conta no NutriDebby. Use outro e-mail para a recepção.',
    jaTemSenha: 'A senha já foi criada. Se a pessoa esqueceu, use "Esqueci minha senha".',
    contaSuspensa: 'Conta suspensa: não é possível convidar agora.',
    limite: 'O consultório pode ter até 3 pessoas ativas na recepção.',
  },
  confirmarDesativar: (nome: string) =>
    `Desativar ${nome}? A pessoa sai do NutriDebby agora e não entra mais. O que foi feito com esta conta continua no Histórico de acessos dos pacientes.`,
  confirmarReativar: (nome: string) => `Reativar ${nome}? A pessoa volta a entrar com a mesma senha e a mesma verificação em duas etapas.`,
  /** O cartão do hub de Configurações (no fim de `CARTOES`, só com `EQUIPE_LIGADA`). */
  cartao: { titulo: 'Equipe', texto: 'Convidar a recepção e cuidar dos acessos dela.' },
  /** O e-mail `convite_recepcao` (§6.2). */
  email: {
    assunto: (consultorio: string) => `Convite para a equipe de ${consultorio} no NutriDebby`,
    corpo: (nome: string, nutricionista: string, consultorio: string) =>
      `Olá, ${nome}. ${nutricionista} convidou você para a equipe de recepção de ${consultorio} no NutriDebby. Crie sua senha pelo link abaixo em até 72 horas.`,
    botao: 'Criar minha senha',
    ignorar: 'Se você não esperava este convite, ignore este e-mail.',
  },
  /** A página do convite (`/convite/[token]`) com o convite da recepção (US-489). */
  convite: {
    titulo: 'Criar sua senha',
    texto: (consultorio: string) => `Você recebeu um convite para a equipe de ${consultorio}.`,
    rotuloTermo: 'Li e aceito o Termo de confidencialidade da equipe',
    termoNaoAceito: 'Para entrar na equipe, aceite o termo de confidencialidade.',
    /** Revisão da P26-07: o convite vencido da recepção. RASCUNHO, sem fonte na spec (§6.2): vai à tabela de textos na T12. */
    expirado: 'Convite expirado. Peça à nutricionista para reenviar o convite.',
  },
} as const;
