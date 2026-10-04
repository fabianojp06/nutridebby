/** M6. Só constantes e tipos: cliente e servidor importam daqui. */
export const TIPOS_CONTEUDO = ['video', 'receita', 'orientacao'] as const;
export type TipoConteudo = (typeof TIPOS_CONTEUDO)[number];
export const ehTipoConteudo = (v: unknown): v is TipoConteudo => typeof v === 'string' && (TIPOS_CONTEUDO as readonly string[]).includes(v);
export const ROTULO_TIPO_CONTEUDO: Record<TipoConteudo, string> = { video: 'Vídeo', receita: 'Receita', orientacao: 'Orientação' };
/** US-055: "Vídeos / Receitas / Orientações". */
export const FILTROS_DO_FEED: { tipo: TipoConteudo; rotulo: string }[] = [
  { tipo: 'video', rotulo: 'Vídeos' },
  { tipo: 'receita', rotulo: 'Receitas' },
  { tipo: 'orientacao', rotulo: 'Orientações' },
];

export const VISIBILIDADES = ['todos', 'etiquetas', 'pacientes'] as const;
export type Visibilidade = (typeof VISIBILIDADES)[number];
export const ehVisibilidade = (v: unknown): v is Visibilidade => typeof v === 'string' && (VISIBILIDADES as readonly string[]).includes(v);
export const ROTULO_VISIBILIDADE: Record<Visibilidade, string> = { todos: 'Todos os pacientes', etiquetas: 'Pacientes com etiqueta', pacientes: 'Pacientes específicos' };

export const TITULO_MAX = 120;
export const RESUMO_MAX = 300;
export const CORPO_MAX = 20000;
export const ETIQUETAS_MAX = 10;
export const ETIQUETA_MAX = 30;
/** US-051: capa JPEG/PNG ≤ 5 MB. D20: PDF ≤ 10 MB. */
export const CAPA_MAX_BYTES = 5 * 1024 * 1024;
export const PDF_MAX_BYTES = 10 * 1024 * 1024;
export const INGREDIENTES_MAX = 50;
export const RENDIMENTO_MAX = 20000;
export const MODO_PREPARO_MAX = 10000;
export const MEDIDA_TXT_MAX = 60;
/** D19: o feed mostra no máximo isto (do mais recente para o mais antigo). */
export const FEED_LIMITE = 100;

export const MSG_CONTEUDO = {
  titulo: 'Informe o título (até 120 caracteres).',
  resumo: 'Use no máximo 300 caracteres no resumo.',
  corpo: 'Texto muito longo (até 20000 caracteres).',
  etiquetas: 'Use até 10 etiquetas de até 30 caracteres.',
  visibilidade: 'Escolha quem vê este conteúdo.',
  audienciaVazia: 'Escolha pelo menos uma etiqueta ou um paciente.',
  naoEncontrado: 'Conteúdo não encontrado.',
  /** dados.json (US-018): visto/favoritado que não está mais publicado — sem o título atual (pode ser de rascunho). */
  indisponivel: 'Conteúdo indisponível',
  /** R6: texto com NUL (`\0`), que o Postgres recusa — o mesmo texto do diário (F-4). */
  formulario: 'Formulário inválido.',
  /** US-050 (texto exato). */
  videoDominio: 'Use um link do YouTube ou do Vimeo',
  /** RN-10 (com ponto, como a RN-10; a US-050 não tem). */
  videoAviso: 'Vídeos não listados podem ser vistos por quem tiver o link.',
  capa: 'Envie uma imagem JPEG ou PNG de até 5 MB.',
  pdf: 'Envie um PDF de até 10 MB.',
  ocupado: 'Outro envio está em andamento. Tente de novo em instantes.',
  /** Envio de capa/PDF que caiu no meio (rede, corpo que não chegou no prazo — 408). */
  falhou: 'Não foi possível enviar. Tente de novo.',
  salvo: 'Conteúdo salvo.',
  capaSalva: 'Capa salva.',
  pdfSalvo: 'PDF salvo.',
  publicado: 'Conteúdo publicado.',
  despublicado: 'Conteúdo despublicado.',
  excluido: 'Conteúdo excluído.',
  receitaIncompleta: 'Preencha a receita (rendimento, porção e ingredientes) antes de publicar.',
  orientacaoVazia: 'Escreva o texto ou envie o PDF antes de publicar.',
  /** D17: salvar sem texto ou tirar o PDF de uma orientação PUBLICADA a deixaria vazia. */
  publicadoVazio: 'Um conteúdo publicado precisa de texto ou PDF. Despublique antes de tirar os dois.',
  avisados: (n: number) => (n === 1 ? 'Aviso enviado para 1 paciente.' : `Aviso enviado para ${n} pacientes.`),
} as const;

export const MSG_RECEITA = {
  rendimento: 'Informe o rendimento total em gramas (maior que 0).',
  porcao: 'Informe a porção em gramas (maior que 0).',
  /** US-051 (texto exato). */
  porcaoMaior: 'A porção não pode ser maior que o rendimento',
  ingredientes: 'Inclua pelo menos um ingrediente.',
  ingredientesMax: 'A receita pode ter até 50 ingredientes.',
  tempo: 'Tempo de preparo entre 1 e 1440 minutos.',
  modo: 'Texto muito longo (até 10000 caracteres).',
  medida: 'Medida caseira até 60 caracteres.',
  salva: 'Receita salva.',
  /** US-054 (texto exato). */
  indisponivel: 'Receita indisponível',
  naoEncontrada: 'Receita não encontrada.',
} as const;

export const MSG_PORTAL_CONTEUDO = {
  vazio: 'Nenhum conteúdo por aqui ainda.',
  semResultado: 'Nenhum conteúdo encontrado.',
  semFavoritos: 'Você ainda não favoritou nenhum conteúdo.',
  favoritar: 'Favoritar',
  desfavoritar: 'Remover dos favoritos',
  /** US-052 (texto exato). */
  baixarPdf: 'Baixar material (PDF)',
} as const;
