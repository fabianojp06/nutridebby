/** US-042 / RN-07. Sem banco: o formulário (cliente) também usa. */
export const REFEICOES_DO_DIARIO = ['Café da manhã', 'Lanche da manhã', 'Almoço', 'Lanche da tarde', 'Jantar', 'Ceia', 'Outro'] as const;
export type RefeicaoDiario = (typeof REFEICOES_DO_DIARIO)[number];
export const FOTO_DIARIO_MAX_BYTES = 10 * 1024 * 1024; // RN-07
export const LIMITE_DIARIO_POR_DIA = 10; // RN-07
export const TEXTO_DIARIO_MAX = 2000;
export const COMENTARIO_MAX = 1000; // US-043 (Tarefa 8)

/** Plano 16 (RN-197): respostas à refeição do plano, gravadas no diário. Lista fechada (CHECK diary_entries_resposta_valida). */
export const RESPOSTAS_DO_DIARIO = ['como_no_plano', 'outra_coisa'] as const;
export type RespostaDoDiario = (typeof RESPOSTAS_DO_DIARIO)[number];
export const ehRespostaDoDiario = (v: unknown): v is RespostaDoDiario => typeof v === 'string' && (RESPOSTAS_DO_DIARIO as readonly string[]).includes(v);
/** O que o paciente vê no balão dele (texto da spec, US-192). */
export const ROTULO_RESPOSTA: Record<RespostaDoDiario, string> = { como_no_plano: 'Comi assim', outra_coisa: 'Comi outra coisa' };
/** O que a nutricionista vê no feed e no registro aberto (§4.9). */
export const ROTULO_RESPOSTA_NUTRI: Record<RespostaDoDiario, string> = { como_no_plano: 'Comeu como no plano', outra_coisa: 'Comeu outra coisa' };
/** CHECK diary_entries_refeicao_do_plano (char_length 1..80). */
export const REFEICAO_DO_PLANO_MAX = 80;

const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

/** "Almoço · 12:30": a cópia (não FK) da refeição do plano no registro — o plano muda e o registro continua dizendo a que se referia. */
export function rotuloDaRefeicao(nome: string, horario: string): string {
  return horario ? `${nome} · ${horario}` : nome;
}

/** §4.4: a refeição do diário (lista fechada) a partir do nome da refeição do plano; sem correspondência, "Outro". */
export function refeicaoDoDiario(nomeDoPlano: string): RefeicaoDiario {
  const alvo = semAcento(nomeDoPlano);
  return REFEICOES_DO_DIARIO.find((r) => r !== 'Outro' && semAcento(r) === alvo) ?? 'Outro';
}

export const MSG_DIARIO = {
  refeicao: 'Escolha a refeição.',
  vazio: 'Escreva o que você comeu ou envie uma foto.',
  texto: 'Use no máximo 2000 caracteres.',
  foto: 'Envie uma foto JPEG, PNG ou HEIC de até 10 MB',
  limite: 'Limite de 10 registros por dia atingido',
  salvo: 'Registro salvo.',
  salvoSemFoto: 'Registro salvo sem a foto.',
  processando: 'Foto sendo preparada…',
  fotoFalhou: 'Não foi possível processar a foto.',
  nenhum: 'Nenhum registro ainda.',
  ocupado: 'Tente novamente em alguns instantes.',
  formulario: 'Formulário inválido.',
  refeicaoNaoEncontrada: 'Refeição não encontrada no seu plano.',
  /** Plano 19 (RN-247 e): a resposta a uma refeição que não vale hoje no fuso do consultório. */
  refeicaoDeOutroDia: 'Esta refeição não é de hoje.',
  registrado: 'Registrado no diário.',
} as const;
