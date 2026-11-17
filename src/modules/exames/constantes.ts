/**
 * Plano 22 — exames do consultório: limites, listas e textos de interface (spec §6.2). SEM imports: o formulário 'use
 * client' lê daqui (EP-D47). Os textos são **rascunho para a Debby** e para o `revisor-interface`; os normativos
 * (categorias, nomes para começar) também para o CRN-3 (spec §14.3, EP-P3). Os poucos textos que a §6.2 não traz estão
 * marcados "texto novo" no comentário da chave.
 */

export const CATALOGO_MAX = 500;
export const NOME_MAX = 80;
export const UNIDADE_MAX = 20;
export const SINONIMOS_MAX = 10;
export const COMPONENTES_MIN = 2;
export const COMPONENTES_MAX = 30;
export const FAIXAS_MAX = 20;
export const IDADE_MAX = 130;
export const FONTE_MIN = 2;
export const FONTE_MAX = 300;
export const NOTA_MAX = 2000;
export const MODELO_NOTA_MAX = 1000;
export const COMPARAR_MIN = 2;
export const COMPARAR_MAX = 6;
/** Linhas do exame, solicitação e modelo de solicitação (spec §6, Global Constraints do plano). */
export const LINHAS_MAX = 50;
export const LISTA_DE_EXAMES_MAX = 40;
/** RN-376: |x| < 1e15 nos limites numéricos (faixa do laudo e do consultório). */
export const LIMITE_ABSOLUTO = 1e15;

/**
 * RN-381, EP-D12: conjunto fechado, sem nome de doença. **Rascunho para a Debby**; a lista inteira vai na pergunta 5 ao
 * CRN-3, e "Desnutrição" fica fora até a resposta.
 */
export const CATEGORIAS_DO_CONSULTORIO = [
  'Baixo',
  'Normal',
  'Alto',
  'Ótimo',
  'Desejável',
  'Adequado',
  'Suficiente',
  'Aceitável',
  'Limítrofe',
  'Elevado',
  'Muito elevado',
  'Insuficiente',
  'Deficiência',
  'Depleção leve',
  'Depleção moderada',
  'Depleção grave',
] as const;
export type CategoriaDoConsultorio = (typeof CATEGORIAS_DO_CONSULTORIO)[number];

/** Os componentes do hemograma (painel de `PAINEIS_PARA_COMECAR`); cada um também é um nome de `NOMES_PARA_COMECAR`. */
const HEMOGRAMA = [
  'Hemácias',
  'Hemoglobina',
  'Hematócrito',
  'VCM',
  'HCM',
  'CHCM',
  'RDW',
  'Leucócitos',
  'Neutrófilos',
  'Bastonetes',
  'Segmentados',
  'Eosinófilos',
  'Basófilos',
  'Linfócitos',
  'Monócitos',
  'Plaquetas',
  'VPM',
] as const;

/**
 * RN-372: **rascunho para a Debby.** Só nomes de exames laboratoriais e os outros nomes — os 14 grupos de `SINONIMOS`
 * (`src/modules/ia/correspondencia.ts`, todos os nomes de cada grupo) e os componentes do hemograma —, **sem unidade,
 * faixa, nota ou ordem por importância** (a ordem é a dos grupos), sem testes sem respaldo científico (mineralograma
 * capilar, IgG para "intolerância alimentar"; Res. CFN 306/2003, art. 2º, parágrafo único, V). Só entra no catálogo o que a nutricionista
 * marcar. O teste `constantes.test.ts` confere os grupos e a unicidade normalizada (RN-371).
 */
export const NOMES_PARA_COMECAR: readonly { nome: string; sinonimos: string[] }[] = [
  { nome: 'Glicemia de jejum', sinonimos: ['Glicose de jejum', 'Glicose em jejum', 'Glicemia em jejum', 'Glicose jejum'] },
  { nome: 'Hemoglobina glicada', sinonimos: ['Hemoglobina glicosilada', 'HbA1c', 'A1c', 'Hb A1c'] },
  { nome: 'AST', sinonimos: ['TGO', 'Aspartato aminotransferase', 'Transaminase oxalacética'] },
  { nome: 'ALT', sinonimos: ['TGP', 'Alanina aminotransferase', 'Transaminase pirúvica'] },
  { nome: 'Colesterol HDL', sinonimos: ['HDL colesterol', 'HDL', 'HDL-C'] },
  { nome: 'Colesterol LDL', sinonimos: ['LDL colesterol', 'LDL', 'LDL-C'] },
  { nome: 'Colesterol não HDL', sinonimos: ['Não HDL colesterol', 'Não HDL'] },
  { nome: 'TSH', sinonimos: ['Hormônio tireoestimulante', 'Tireotrofina'] },
  { nome: 'T4 livre', sinonimos: ['T4L', 'Tiroxina livre'] },
  { nome: 'Vitamina D', sinonimos: ['25-OH vitamina D', '25-hidroxivitamina D', 'Vitamina D 25-hidroxi', 'Vitamina D3'] },
  { nome: 'Vitamina B12', sinonimos: ['Cobalamina', 'Cianocobalamina'] },
  { nome: 'GGT', sinonimos: ['Gama GT', 'Gama glutamil transferase'] },
  { nome: 'PCR', sinonimos: ['Proteína C reativa', 'PCR ultrassensível', 'Proteína C reativa ultrassensível'] },
  { nome: 'Triglicérides', sinonimos: ['Triglicerídeos', 'Triglicérides totais'] },
  { nome: 'Hemácias', sinonimos: ['Eritrócitos'] },
  { nome: 'Hemoglobina', sinonimos: [] },
  { nome: 'Hematócrito', sinonimos: [] },
  { nome: 'VCM', sinonimos: ['Volume corpuscular médio'] },
  { nome: 'HCM', sinonimos: ['Hemoglobina corpuscular média'] },
  { nome: 'CHCM', sinonimos: ['Concentração de hemoglobina corpuscular média'] },
  { nome: 'RDW', sinonimos: [] },
  { nome: 'Leucócitos', sinonimos: [] },
  { nome: 'Neutrófilos', sinonimos: [] },
  { nome: 'Bastonetes', sinonimos: [] },
  { nome: 'Segmentados', sinonimos: [] },
  { nome: 'Eosinófilos', sinonimos: [] },
  { nome: 'Basófilos', sinonimos: [] },
  { nome: 'Linfócitos', sinonimos: [] },
  { nome: 'Monócitos', sinonimos: [] },
  { nome: 'Plaquetas', sinonimos: [] },
  { nome: 'VPM', sinonimos: ['Volume plaquetário médio'] },
];

/** RN-372, RN-373: o painel para começar (só os nomes dos componentes; rascunho para a Debby). */
export const PAINEIS_PARA_COMECAR: readonly { nome: 'Hemograma completo'; componentes: string[] }[] = [{ nome: 'Hemograma completo', componentes: [...HEMOGRAMA] }];

const exames = (n: number) => (n === 1 ? '1 exame' : `${n} exames`);

/** Spec §6.2 (textos exatos; rascunho para a Debby e para o `revisor-interface`). */
export const MSG_EXAMES = {
  /** Linhas "Cartões em Configurações" (só o do PR 2) e "Catálogo". */
  catalogo: {
    cartaoTitulo: 'Exames',
    cartaoTexto: 'Catálogo de exames, faixas do consultório e modelos de solicitação.',
    titulo: 'Catálogo de exames',
    secaoCatalogo: 'Catálogo',
    secaoModelos: 'Modelos de solicitação',
    novo: 'Novo exame',
    vazio: 'Seu catálogo ainda está vazio.',
    comecar: 'Nomes de exames para começar',
    tituloDialogoComecar: 'Nomes de exames para começar (você escolhe o que usar)',
    ajudaComecar: 'Só nomes de exames laboratoriais. Nenhuma unidade, faixa ou valor de referência vem junto.',
    selecionarTodos: 'Selecionar todos',
    adicionar: 'Adicionar ao catálogo',
    colunas: { exame: 'Exame', unidade: 'Unidade', faixas: 'Faixas', acao: 'Ação' },
    painel: (n: number) => `Painel (${exames(n)})`,
    /** Texto novo (T3): retorno de "Adicionar ao catálogo" (a §6.2 não traz). Rascunho para a Debby. */
    adicionados: (n: number) => (n === 1 ? '1 exame adicionado ao catálogo.' : `${n} exames adicionados ao catálogo.`),
    /** Texto novo (T3): "Adicionar ao catálogo" sem nenhum nome marcado. Rascunho para a Debby. */
    nenhumMarcado: 'Marque ao menos um nome.',
    /** Texto novo (T3): o link de volta para o hub. */
    voltar: 'Configurações',
    /** Texto novo (T3): título do formulário de um exame novo (spec §4.1, h1). */
    tituloNovo: 'Novo exame do catálogo',
    /** Texto novo (T3): legenda da coluna "Faixas" sem faixa. */
    semFaixas: 'Nenhuma',
    /** Texto novo (T3): nome acessível do link de cada exame e do "Excluir" na lista. */
    editarRotulo: (nome: string) => `Editar ${nome}`,
    excluirRotulo: (nome: string) => `Excluir ${nome}`,
  },
  exameDoCatalogo: {
    nome: 'Nome',
    unidade: 'Unidade (opcional)',
    sinonimos: 'Outros nomes (opcional)',
    ajudaSinonimos: 'Como o exame aparece em laudos diferentes. Um por linha, até 10.',
    componentes: 'Exames que compõem este (opcional)',
    ajudaComponentes: 'Para pedidos como Hemograma completo: ao lançar o resultado, cada exame da lista vira uma linha.',
    salvar: 'Salvar',
    excluir: 'Excluir',
    salvo: 'Exame salvo.',
    excluido: 'Exame excluído do catálogo.',
  },
  faixas: {
    titulo: 'Faixas do consultório',
    ajuda: 'Faixas que você define, com a fonte. Servem para mostrar uma categoria ao lado do resultado, só no painel. A plataforma não traz faixas prontas.',
    sexo: 'Sexo do cadastro',
    sexos: { todos: 'Todos', F: 'Feminino', M: 'Masculino' },
    idadeDe: 'Idade de',
    ate: 'até',
    anos: 'anos',
    aPartirDe: 'A partir de',
    abaixoDe: 'Abaixo de',
    categoria: 'Categoria',
    fonte: 'Fonte',
    ajudaFonte: 'Diretriz, consenso ou laboratório, com o ano.',
    acrescentar: 'Acrescentar faixa',
    remover: 'Remover faixa',
    fonteDe: (fonte: string) => `Fonte: ${fonte}`,
    atualizadaEm: (data: string) => `atualizada em ${data}`,
    /** Texto novo (T3): o grupo de cada faixa no formulário e o nome acessível de "Remover faixa". Rascunho para a Debby. */
    rotuloFaixa: (n: number) => `Faixa ${n}`,
    removerRotulo: (n: number) => `Remover faixa ${n}`,
    /** Texto novo (T3): a opção vazia de "Categoria" (como "Grupo" em Alimentos). */
    escolha: 'Escolha…',
  },
  modelosNota: {
    titulo: 'Modelos de nota de interpretação',
    linhaFixa: 'Escreva fatores a investigar e encaminhamentos; não afirme doença.',
    aviso: 'Retire dados do paciente antes de salvar.',
    abaixo: 'Quando o resultado está abaixo da referência',
    acima: 'Quando o resultado está acima da referência',
  },
  /** Linha "Catálogo: erros". */
  erros: {
    nome: 'O nome tem de 1 a 80 caracteres.',
    nomeRepetido: (nome: string) => `Já existe um exame com este nome ou com um destes outros nomes: ${nome}.`,
    sinonimos: 'Use até 10 outros nomes.',
    painel: 'Um painel tem de 2 a 30 exames.',
    painelSemFaixa: 'Um painel não tem unidade, faixas nem modelos de nota.',
    semUnidade: 'Informe a unidade do exame antes de cadastrar faixas.',
    fonte: 'Informe a fonte (de 2 a 300 caracteres).',
    semLimite: 'Informe ao menos um limite.',
    limites: 'O limite inicial deve ser menor que o final.',
    idades: 'A idade inicial deve ser menor ou igual à final.',
    sobreposicao: 'Esta faixa se sobrepõe a outra do mesmo público.',
    faixasDemais: 'Use até 20 faixas.',
    modeloNota: 'O modelo de nota tem no máximo 1000 caracteres.',
    catalogoCheio: 'O catálogo chegou ao limite de 500 exames.',
    trocarUnidade: 'Remova as faixas antes de trocar a unidade.',
    confirmarExcluir: (nome: string) => `Excluir ${nome} do catálogo? Exames, modelos e documentos já gravados não mudam.`,
    confirmarExcluirSim: 'Excluir',
    cancelar: 'Cancelar',
    /** Texto novo (a §6.2 não traz): unidade acima de 20 caracteres (RN-371). Rascunho para a Debby. */
    unidade: 'A unidade tem no máximo 20 caracteres.',
    /** Texto novo: idade fora de 0 a 130 anos completos (RN-374). Rascunho para a Debby. */
    idade: 'Informe a idade em anos completos, de 0 a 130.',
    /** Texto novo: categoria fora de CATEGORIAS_DO_CONSULTORIO (RN-381). Rascunho para a Debby. */
    categoria: 'Escolha uma categoria da lista.',
    /** Texto novo: sexo fora de "Todos", "Feminino" e "Masculino" (RN-374). Rascunho para a Debby. */
    sexo: 'Escolha Todos, Feminino ou Masculino.',
    /** Componente do painel repetido (RN-373): o mesmo texto da lista da solicitação (§6.2). */
    componenteRepetido: 'Este exame já está na lista.',
    /** Texto novo (T3): o exame do catálogo foi excluído em outra aba (o mesmo texto da aba Exames). Rascunho para a Debby. */
    naoEncontrado: 'Exame não encontrado.',
  },
  lancamento: {
    adicionarDoCatalogo: 'Adicionar do catálogo',
    buscar: 'Buscar no catálogo',
    selecionarTodos: 'Selecionar todos',
    selecionarTodosRotulo: 'Selecionar todos os exames mostrados',
    adicionarN: (n: number) => `Adicionar ${exames(n)}`,
    carregarModelo: 'Carregar modelo de solicitação',
    removerTodos: 'Remover todos',
    confirmarRemoverTodos: 'Remover todas as linhas deste exame? Nada muda até você salvar.',
    remover: 'Remover',
    cancelar: 'Cancelar',
    adicionarLinha: 'Adicionar linha',
    grupoLinha: (n: number, marcador: string) => `Linha ${n}: ${marcador}`,
    marcador: (n: number) => `Marcador ${n}`,
    valor: (n: number) => `Valor ${n}`,
    unidade: (n: number) => `Unidade ${n}`,
    referencia: (n: number) => `Referência do laudo ${n}`,
    faixaDe: (n: number) => `Faixa do laudo: de ${n}`,
    faixaAte: (n: number) => `até ${n}`,
    ajudaFaixa: 'Copie a faixa impressa no laudo.',
    usarFaixa: (a: string, b: string) => `Usar ${a} a ${b}`,
    usarFaixaRotulo: (a: string, b: string, n: number) => `Usar ${a} a ${b} (linha ${n})`,
    faixaDiverge: 'A faixa numérica não bate com o texto da referência. Confira no laudo.',
  },
  /** Linha "Lançamento: erros" (as mensagens de hoje de `exames.ts` continuam). */
  lancamentoErros: {
    faixaInvertida: 'O início da faixa deve ser menor ou igual ao fim.',
    justificativa: 'Informe a justificativa da alteração (de 5 a 500 caracteres).',
    nadaAlterado: 'Nada foi alterado.',
    faixaInvalida: 'Faixa inválida. Use só números, como 70 ou 4,5.',
    mudou: 'O exame mudou desde que você abriu. Recarregue a página.',
  },
  exame: {
    abrir: 'Abrir',
    abrirRotulo: (titulo: string, data: string) => `Abrir ${titulo} de ${data}`,
    editar: 'Editar',
    editarExame: 'Editar exame',
    justificativa: 'Justificativa da alteração',
    salvo: 'Exame salvo.',
    versoes: 'Versões anteriores',
    versao: (n: number, data: string, nome: string) => `Versão ${n} — ${data}, por ${nome}`,
    comparar: 'Comparar',
    compararRotulo: (titulo: string, data: string) => `Comparar ${titulo} de ${data}`,
    compararN: (n: number) => `Comparar ${n} exames`,
    apoioComparar: 'Escolha de 2 a 6 exames para comparar.',
    avisoEditarNoApp: 'Este exame está no app do paciente. O que você salvar aparece lá na hora.',
    avisoExcluirNoApp: 'Este exame está no app do paciente. Ao excluir, ele some de lá.',
    /** Texto novo (T4): "Versões anteriores" de um exame nunca editado. Rascunho para a Debby. */
    semVersoes: 'Este exame ainda não foi editado.',
    /** Texto novo (T4): o nome acessível do "Editar" de cada exame na lista (nomes únicos). */
    editarRotulo: (titulo: string, data: string) => `Editar ${titulo} de ${data}`,
    /** Texto novo (T4): rótulos de "Versões anteriores". Rascunho para a Debby. */
    justificativaDe: (texto: string) => `Justificativa: ${texto}`,
    semJustificativa: 'Só acrescentou linhas (sem justificativa).',
    valoresDaVersao: (n: number) => `Valores da versão ${n}`,
  },
  classificacao: {
    abaixo: 'Abaixo da referência',
    dentro: 'Dentro da referência',
    acima: 'Acima da referência',
    aviso: 'Classificação automática pela faixa de referência informada. Não é diagnóstico.',
    gestacao: 'As faixas do consultório não consideram gestação.',
    faixaDoConsultorio: '(faixa do consultório)',
  },
  /** RN-382 ("REF" é só o nome interno da função). */
  ref: {
    botao: 'Ver referência',
    rotulo: (marcador: string) => `Referência de ${marcador}`,
    doLaudo: (texto: string) => `Referência do laudo: ${texto}`,
    faixaDoLaudo: (faixa: string) => `Faixa do laudo: ${faixa}`,
    faixasDoConsultorio: 'Faixas do consultório',
    linhaFaixa: (publico: string, idade: string, limites: string, categoria: string) => `${publico}, ${idade}: ${limites} — ${categoria}`,
    fonte: (fonte: string, data: string) => `Fonte: ${fonte} · atualizada em ${data}`,
    semReferencia: 'Sem referência.',
  },
  nota: {
    titulo: 'Nota de interpretação',
    linhaFixa: 'Escreva fatores a investigar e encaminhamentos; não afirme doença.',
    ajuda: 'Não aparece no app; entra na cópia dos dados que o paciente pedir.',
    inserirModelo: 'Inserir modelo',
    modelo: (exame: string, sentido: 'abaixo' | 'acima') => `${exame} — ${sentido}`,
    semModelo: 'Nenhum modelo para os exames fora da referência.',
    salvar: 'Salvar nota',
    apagar: 'Apagar nota',
    salva: 'Nota salva.',
    apagada: 'Nota apagada.',
    anteriores: 'Notas anteriores',
    max: 'A nota tem no máximo 2000 caracteres.',
  },
  comparativo: {
    titulo: 'Comparativo de exames',
    caption: 'Resultados por data',
    marcador: 'Marcador',
    semValor: '—',
    nota: 'Marcadores com unidades diferentes aparecem em linhas separadas.',
    voltar: 'Voltar aos exames',
  },
  /** Linha "Mostrar no app (painel)". */
  app: {
    mostrar: 'Mostrar no app do paciente',
    confirmar:
      'O paciente verá no app o título, a data, os valores e a referência deste exame, com o aviso de que não é diagnóstico. A nota de interpretação, as categorias do consultório e o laudo não aparecem.',
    confirmarSim: 'Mostrar no app',
    cancelar: 'Cancelar',
    retirar: 'Retirar do app',
    mostrado: 'O exame aparece no app do paciente.',
    retirado: 'O exame saiu do app do paciente.',
    pacienteSemApp: 'Este paciente ainda não usa o app. O exame aparece quando ele entrar.',
    selo: 'No app',
    historicoLiberou: 'Liberou exame no app',
    historicoRetirou: 'Retirou exame do app',
  },
  portal: {
    titulo: 'Resultados liberados',
    texto: 'Resultados que sua nutricionista liberou para você.',
    resultado: (valor: string, unidade: string) => `Resultado: ${valor} ${unidade}`.trimEnd(),
    referencia: (texto: string) => `Referência: ${texto}`,
    fora: 'Fora da referência',
    aviso: 'Não é diagnóstico. Converse com sua nutricionista.',
  },
  /** Linha "Modelos de solicitação" (as telas da T3). */
  modelosSolicitacao: {
    titulo: 'Modelos de solicitação',
    novo: 'Novo modelo',
    aviso: 'Retire dados do paciente antes de salvar.',
    vazio: 'Nenhum modelo de solicitação ainda. Crie o primeiro em Novo modelo.',
    nome: 'Nome do modelo',
    exames: 'Exames',
    orientacoes: 'Orientações ao paciente (opcional)',
    salvo: 'Modelo salvo.',
    excluido: 'Modelo excluído.',
    erros: {
      nome: 'O nome tem de 1 a 80 caracteres.',
      repetido: 'Já existe um modelo com este nome.',
      semExames: 'Inclua ao menos um exame.',
      max: 'O modelo pode ter até 40 exames.',
      exameRepetido: 'Este exame já está na lista.',
      /** O mesmo texto da solicitação (§6.2, "Solicitação: erros"). */
      orientacoes: 'As orientações têm no máximo 1000 caracteres.',
      /** Texto novo (T3): o modelo foi excluído em outra aba. Rascunho para a Debby. */
      naoEncontrado: 'Modelo não encontrado.',
    },
    /** Texto novo (T3): nomes acessíveis da lista e do formulário. */
    editarRotulo: (nome: string) => `Editar o modelo ${nome}`,
    excluirRotulo: (nome: string) => `Excluir o modelo ${nome}`,
    confirmarExcluir: (nome: string) => `Excluir o modelo ${nome}? As solicitações já feitas não mudam.`,
    tituloNovo: 'Novo modelo de solicitação',
    removerRotulo: (nome: string) => `Remover ${nome}`,
    nomeDoExame: 'Nome do exame',
    adicionar: 'Adicionar',
    examesN: (n: number) => (n === 1 ? '1 exame' : `${n} exames`),
  },
  /** Linha "Estados vazios e erros genéricos" (os de exames; "Nenhum item salvo." é de MSG_MODELOS, PR 4). */
  vazios: {
    catalogoVazio: 'Seu catálogo está vazio. Cadastre exames em Catálogo de exames.',
    semResultado: 'Nenhum exame encontrado.',
    semModelo: 'Nenhum modelo ainda.',
    erroSalvar: 'Não foi possível salvar. Tente de novo.',
    erroExcluir: 'Não foi possível excluir. Tente de novo.',
    erroApp: 'Não foi possível mudar o app do paciente. Tente de novo.',
  },
} as const;
