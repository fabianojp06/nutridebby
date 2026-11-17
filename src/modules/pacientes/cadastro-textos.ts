import type {
  ESCOLARIDADES as VALORES_ESCOLARIDADE,
  ESTADOS_CIVIS as VALORES_ESTADO_CIVIL,
  IDENTIDADES_DE_GENERO as VALORES_IDENTIDADE,
  UFS as VALORES_UF,
} from '@/db/schema';

/**
 * Plano 18 (US-260, §8.4): textos, listas fechadas e a contagem de caracteres do cadastro complementar, sem nada de
 * banco — o formulário (componente de cliente) importa daqui; `cadastro.ts` reexporta e usa as mesmas regras no servidor.
 */

export type IdentidadeDeGenero = (typeof VALORES_IDENTIDADE)[number];
export type EstadoCivil = (typeof VALORES_ESTADO_CIVIL)[number];
export type Escolaridade = (typeof VALORES_ESCOLARIDADE)[number];
export type Uf = (typeof VALORES_UF)[number];

/** Textos exatos da spec (US-260, §8.4). */
export const MSG_CADASTRO = {
  cpfInvalido: 'CPF inválido. Confira os números.',
  cpfRepetido: 'Já existe um paciente com este CPF neste consultório.',
  abrirExistente: 'Abrir o cadastro existente (abre em nova aba)',
  escolhaDaLista: 'Escolha uma opção da lista',
  ufDaLista: 'Selecione um estado da lista',
  telefoneFixo: 'Telefone fixo inválido',
  cepInvalido: 'CEP inválido. Use os 8 números.',
  observacaoMaximo: 'Use no máximo 1.000 caracteres',
  tamanho: (min: number, max: number) => `Use entre ${min} e ${max} caracteres`,
  avisoObservacao:
    'O paciente pode receber uma cópia deste campo se pedir os dados dele (LGPD). Para anotações só suas, use as notas privadas do atendimento.',
  contadorObservacao: (n: number) => `${n.toLocaleString('pt-BR')} de 1.000 caracteres`,
  secoes: {
    dadosGerais: 'Dados gerais',
    contatoEEndereco: 'Contato e endereço',
    observacao: 'Observação',
    acessoAoApp: 'Acesso ao app',
    etiquetas: 'Etiquetas',
  },
  legendaEndereco: 'Endereço (opcional)',
  selecione: 'Selecione',
  rotulos: {
    nome: 'Nome completo',
    nomeSocial: 'Nome social (opcional)',
    dataNascimento: 'Data de nascimento',
    identidadeGenero: 'Identidade de gênero (opcional)',
    estadoCivil: 'Estado civil (opcional)',
    escolaridade: 'Escolaridade (opcional)',
    ocupacao: 'Ocupação (opcional)',
    nacionalidade: 'Nacionalidade (opcional)',
    naturalidade: 'Naturalidade (opcional)',
    cpf: 'CPF (opcional)',
    email: 'E-mail',
    telefone: 'Celular / WhatsApp (opcional)',
    telefoneFixo: 'Telefone fixo (opcional)',
    cep: 'CEP',
    logradouro: 'Rua',
    numero: 'Número',
    complemento: 'Complemento',
    bairro: 'Bairro',
    cidade: 'Cidade',
    uf: 'Estado',
    observacao: 'Observação (opcional)',
  },
  dicas: {
    nomeSocial: 'Preencha só a pedido do paciente. Aparece no painel junto do nome completo.',
    identidadeGenero: 'Como o paciente se identifica. As fórmulas usam o sexo biológico.',
    ocupacao: 'Profissão ou atividade principal.',
    nacionalidade: 'Ex.: brasileira',
    naturalidade: 'Cidade e estado onde nasceu. Ex.: Campinas (SP)',
    cpf: 'Para identificar o paciente sem engano. Não aparece na lista nem no app.',
    telefone: 'Ex.: (11) 91234-5678. Aceita fixo, mas os avisos de WhatsApp só saem para celular, se o paciente autorizar.',
    telefoneFixo: 'Ex.: (11) 3123-4567',
  },
} as const;

export type Opcao<V extends string> = { valor: V; rotulo: string };
/** A ordem da lista é a das chaves (a da spec); `cadastro.test.ts` confere que bate com as listas do schema (os CHECKs). */
const opcoes = <V extends string>(rotulos: Record<V, string>): readonly Opcao<V>[] =>
  Object.freeze((Object.entries(rotulos) as [V, string][]).map(([valor, rotulo]) => Object.freeze({ valor, rotulo })));

/** Listas fechadas da US-260 com os rótulos da tela (§8.4). */
export const IDENTIDADES_DE_GENERO = opcoes<IdentidadeDeGenero>({
  mulher: 'Mulher',
  homem: 'Homem',
  nao_binario: 'Não binário',
  outra: 'Outra',
  prefere_nao_informar: 'Prefere não informar',
});
export const ESTADOS_CIVIS = opcoes<EstadoCivil>({
  solteiro: 'Solteiro(a)',
  casado: 'Casado(a)',
  uniao_estavel: 'União estável',
  separado: 'Separado(a)',
  divorciado: 'Divorciado(a)',
  viuvo: 'Viúvo(a)',
});
export const ESCOLARIDADES = opcoes<Escolaridade>({
  sem_escolaridade: 'Sem escolaridade',
  fundamental_incompleto: 'Ensino fundamental incompleto',
  fundamental_completo: 'Ensino fundamental completo',
  medio_incompleto: 'Ensino médio incompleto',
  medio_completo: 'Ensino médio completo',
  superior_incompleto: 'Ensino superior incompleto',
  superior_completo: 'Ensino superior completo',
  pos_graduacao: 'Pós-graduação',
});
export const UFS = opcoes<Uf>({
  AC: 'Acre',
  AL: 'Alagoas',
  AP: 'Amapá',
  AM: 'Amazonas',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais',
  PA: 'Pará',
  PB: 'Paraíba',
  PR: 'Paraná',
  PE: 'Pernambuco',
  PI: 'Piauí',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul',
  RO: 'Rondônia',
  RR: 'Roraima',
  SC: 'Santa Catarina',
  SP: 'São Paulo',
  SE: 'Sergipe',
  TO: 'Tocantins',
});

/**
 * O FormData manda as quebras de linha do textarea como `\r\n`, e o navegador mostra `\n`: normalizadas para `\n` antes
 * de contar, validar e gravar, a tela e o servidor contam igual.
 */
export const normalizarQuebras = (s: string) => s.replace(/\r\n?/g, '\n');

/**
 * Tamanho de um texto do cadastro como o servidor confere: quebras normalizadas, pontas tiradas e caracteres contados
 * como o `char_length` do Postgres (code points, não unidades UTF-16 do JS). O contador "{n} de 1.000 caracteres" usa
 * esta mesma função.
 */
export const tamanhoDoTexto = (s: string) => Array.from(normalizarQuebras(s).trim()).length;
