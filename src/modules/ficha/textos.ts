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
  /** Cabeçalho da ficha (spec §8.2, RN-275): a linha de medidas da última avaliação e o selo do peso oculto. */
  cabecalho: {
    ultimaAvaliacao: (data: string, medidas: string) => `Última avaliação em ${data}: ${medidas}`,
    altura: (m: string) => `altura ${m} m`,
    peso: (kg: string) => `peso ${kg} kg`,
    imc: (v: string) => `IMC ${v}`,
    gordura: (p: string) => `gordura ${p}%`,
    semAvaliacao: 'Sem avaliação antropométrica.',
    pesoOculto: 'Peso oculto no app',
  },
} as const;
