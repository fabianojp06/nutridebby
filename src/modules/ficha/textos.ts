import { TIPO_DOCUMENTO_ROTULO } from '@/modules/documentos/constantes';

/**
 * Plano 18, spec §8.3 (textos exatos): Início da ficha — seções, Adicionar. Sem imports de servidor: o diálogo Adicionar
 * (componente cliente) lê daqui.
 */
export const MSG_FICHA = {
  /** Títulos das seções (RN-278), na ordem do registro. */
  titulos: {
    planoAlimentar: 'Plano alimentar',
    antropometria: 'Antropometria',
    gastoEnergetico: 'Gasto energético',
    anamneses: 'Anamneses',
    atendimentos: 'Atendimentos',
    exames: 'Exames',
    examesEnviados: 'Exames enviados pelo paciente',
    documentos: 'Documentos',
    mensagens: 'Mensagens', // Plano 25 (§4.4)
  },
  /** Rótulos genéricos dos itens (D14: nunca o nome do modelo da anamnese nem o do exame). */
  rotulos: {
    planoAlimentar: 'Plano alimentar',
    avaliacao: 'Avaliação',
    calculo: 'Cálculo',
    anamnese: 'Anamnese',
    atendimento: 'Atendimento',
    exame: 'Exame',
    envio: 'Envio do paciente',
  },
  situacaoDoPlano: { rascunho: 'Rascunho', publicado: 'Publicado', arquivado: 'Arquivado' },
  /** Situação do envio do paciente vista pela nutricionista (rótulos curtos; o motivo da recusa não aparece). */
  situacaoDoEnvio: {
    processando: 'Processando',
    recebido: 'Aguardando revisão',
    aceito: 'Aceito',
    recusado: 'Recusado',
    cancelado: 'Cancelado',
    expirado: 'Expirado',
    falhou: 'Falhou',
  },
  /** "{Título} ({n})" no `<h3>` do `<summary>`. */
  secao: (titulo: string, n: number) => `${titulo} (${n})`,
  vazio: 'Nenhum registro ainda.',
  verTodos: 'Ver todos',
  /** Nome acessível do "Ver todos" de cada seção. */
  verTodosDe: (titulo: string) => `Ver todos: ${titulo}`,
  adicionar: 'Adicionar',
  adicionarAoProntuario: 'Adicionar ao prontuário',
  grupos: { avaliacoes: 'Avaliações', prescricoes: 'Prescrições', outros: 'Outros' },
  /** Itens do diálogo Adicionar (US-263). */
  itens: {
    anamnese: 'Anamnese',
    antropometria: 'Antropometria',
    gastoEnergetico: 'Gasto energético',
    exame: 'Exame',
    atendimento: 'Atendimento',
    planoAlimentar: 'Plano alimentar',
    receita: TIPO_DOCUMENTO_ROTULO.receita,
    parecer: TIPO_DOCUMENTO_ROTULO.parecer,
  },
  dica: 'Antes do plano alimentar, registre a anamnese, a antropometria e o gasto energético.',
  fechar: 'Fechar',
  /** Título (só para leitor de tela) do bloco das seções: os `<h3>` das seções ficam sob ele, não sob "Inteligência artificial". */
  secoesTitulo: 'Registros do prontuário',
  /** Cartão Resumo (RN-276, spec §8.3). */
  resumo: {
    titulo: 'Resumo',
    aniversario: (diaEMes: string) => `Aniversário: ${diaEMes}`,
    desde: (data: string) => `Paciente desde ${data}`,
    planoPublicadoEm: (data: string) => `Plano alimentar publicado em ${data}`,
    nenhumPlano: 'Nenhum plano publicado',
  },
  /** Selo do item que o paciente vê no app (RN-279), decidido no contexto de paciente (Tarefa 9). */
  seloNoApp: 'No app',
  /** Na seção Antropometria, com "Não mostrar peso no app" (RN-279, spec §8.3). */
  pesoOcultoNaSecao: 'Peso e IMC ocultos no app.',
  /** Cabeçalho da ficha (spec §8.2, RN-275): a linha de medidas da última avaliação e o selo do peso oculto. */
  cabecalho: {
    ultimaAvaliacao: (data: string, medidas: string) => `Última avaliação em ${data}: ${medidas}`,
    altura: (m: string) => `altura ${m} m`,
    peso: (kg: string) => `peso ${kg} kg`,
    imc: (v: string) => `IMC ${v}`,
    gordura: (p: string) => `gordura ${p}%`,
    semAvaliacao: 'Sem avaliação antropométrica.',
    pesoOculto: 'Peso oculto no app',
    /** D7, RN-266: na tela, abaixo do título (o nome social); no papel, logo depois do nome civil (Res. CFN 594/2017, art. 4º, § 1º, I). */
    nomeDeRegistro: (nome: string) => `Nome de registro: ${nome}`,
    nomeSocial: (nomeSocial: string) => `Nome social: ${nomeSocial}`,
  },
  /** Nota do cartão Resumo (D17, RN-269, spec §8.3): itens em minúsculas, na ordem da lista fechada. */
  incompleto: {
    itensFaltando: (itens: string) => `Cadastro incompleto: faltam ${itens}.`,
    quantidade: (n: number) => `Cadastro incompleto: faltam ${n} dados.`,
    completar: 'Completar no Perfil',
    itens: {
      dataNascimento: 'data de nascimento',
      sexo: 'sexo',
      identidadeGenero: 'identidade de gênero',
      estadoCivil: 'estado civil',
      nacionalidade: 'nacionalidade',
      naturalidade: 'naturalidade',
      escolaridade: 'escolaridade',
      ocupacao: 'ocupação',
      endereco: 'endereço',
      telefone: 'telefone',
    },
  },
} as const;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Plano 18, spec §8.5 e US-264 (textos exatos): o cartão "No app do paciente" do Início e a página `[id]/app`. Na página,
 * cada linha é "{rótulo} {texto}" (o rótulo numa coluna, como no esboço da §8.5).
 */
export const MSG_NO_APP = {
  titulo: 'No app do paciente',
  intro: (nome: string) => `O que ${nome} vê hoje no app do consultório. As contagens seguem as mesmas regras do app.`,
  verDetalhes: 'Ver detalhes',
  rotulos: {
    acesso: 'Acesso',
    notificacoes: 'Notificações',
    plano: 'Plano',
    lembretes: 'Lembretes',
    evolucao: 'Evolução',
    jornada: 'Jornada',
    documentos: 'Documentos',
    conteudos: 'Conteúdos',
    exames: 'Exames',
    diario: 'Diário',
    iaNutri: 'IA Nutri',
  },
  acesso: {
    ativo: 'Ativo: o paciente já criou a senha.',
    /** Cartão do Início (US-264): "Acesso: ativo · último acesso em 14/11/2026". */
    ativoNoCartao: 'Acesso: ativo',
    ultimoAcessoEm: (data: string) => `Último acesso em ${data}`,
    ultimoAcessoEmNoCartao: (data: string) => `último acesso em ${data}`,
    nuncaAcessou: 'Último acesso: nenhum ainda.',
    nuncaAcessouNoCartao: 'nenhum acesso ainda',
    naoEntrou: 'Ainda não entrou no app.',
    /** O texto do convite pendente ou vencido (o mesmo do Perfil, `textoDoAcesso`). */
    conviteAte: (dataHora: string) => `Convite enviado por e-mail. Vale até ${dataHora}.`,
    conviteExpirado: 'Convite expirado. Reenvie para o paciente conseguir entrar.',
    reenviar: 'Reenviar o convite no Perfil',
    arquivado: 'Paciente arquivado: não vê nada no app até ser reativado.',
    bloqueado: 'Paciente bloqueado por pedido de exclusão: sem acesso ao app.',
  },
  notificacoes: {
    ativas: (n: number) => `Ativas em ${plural(n, 'aparelho', 'aparelhos')}`,
    /** Texto exato da §8.5 ("Sem push"), com o rótulo e o ponto. */
    desligadas: 'Notificações: desligadas em todos os aparelhos.',
    whatsapp: 'WhatsApp autorizado',
    semWhatsapp: 'WhatsApp não autorizado',
  },
  plano: {
    publicadoEm: (data: string) => `Publicado em ${data}`,
    nenhum: 'Nenhum plano publicado.',
    receitas: (n: number) => plural(n, 'receita sugerida', 'receitas sugeridas'),
    listaDeCompras: 'Lista de compras disponível',
    /** Cartão do Início (US-264). */
    publicadoNoCartao: 'Plano alimentar publicado',
  },
  lembretes: {
    ligados: (n: number) => plural(n, 'lembrete ligado', 'lembretes ligados'),
    desligadosPeloPaciente: (n: number) => `${plural(n, 'desligado', 'desligados')} pelo paciente`,
    pausados: 'Pausados pelo paciente',
  },
  evolucao: {
    avaliacoes: (n: number) => plural(n, 'avaliação', 'avaliações'),
    pesoOculto: 'Peso e IMC: ocultos no app (Não mostrar peso no app)',
    pesoVisivel: 'Peso e IMC: aparecem no app',
    gorduraAparece: '% de gordura: aparece no app',
    gorduraNaoAparece: '% de gordura: não aparece no app',
  },
  atendimentos: (n: number) => plural(n, 'atendimento', 'atendimentos'),
  documentos: (n: number) => plural(n, 'documento', 'documentos'),
  conteudos: (n: number) => plural(n, 'conteúdo', 'conteúdos'),
  conteudosNaBiblioteca: (n: number) => `${plural(n, 'conteúdo', 'conteúdos')} na biblioteca`,
  envios: (n: number) => plural(n, 'envio de exame', 'envios de exame'),
  diario: (n: number) => `${plural(n, 'registro', 'registros')} nos últimos 30 dias`,
  iaNutri: { ligada: 'Ligada para este paciente', desligada: 'Desligada' },
} as const;
