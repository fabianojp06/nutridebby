/**
 * D24: cores do visual V2 (Bento), [claro, escuro]. Fonte única: o globals.css repete os valores (teste confere).
 * Faltavam no design e foram acrescentadas: borda de campo (≥ 3:1, WCAG 1.4.11), fundos de erro/aviso/ok e o foco.
 */
export const TOKENS = {
  fundo: ['#eaf0ec', '#0f1613'],
  cartao: ['#ffffff', '#17211d'],
  texto: ['#14211d', '#e6eeea'],
  suave: ['#4b5c55', '#a3b5ad'],
  borda: ['#d5e0da', '#26332e'],
  campo: ['#6f817a', '#7a8c84'],
  linha: ['#edf2ef', '#22302b'],
  link: ['#0f4f42', '#7fd4b9'],
  erro: ['#8f2f22', '#ff9c8f'],
  'erro-fundo': ['#fbe9e6', '#3a1d19'],
  aviso: ['#8a5306', '#f0b867'],
  'aviso-fundo': ['#fdf3e1', '#33270f'],
  ok: ['#1f6b45', '#7fd4b9'],
  'ok-fundo': ['#e4f2ea', '#15302a'],
  botao: ['#14211d', '#e6eeea'],
  'botao-texto': ['#ffffff', '#0f1613'],
} as const satisfies Record<string, readonly [string, string]>;

export type Token = keyof typeof TOKENS;

/** Pares que a interface usa: texto normal 4,5:1; borda de campo 3:1 (componente). */
export const PARES: readonly { texto: Token; fundo: Token; minimo: number }[] = [
  { texto: 'texto', fundo: 'fundo', minimo: 4.5 },
  { texto: 'texto', fundo: 'cartao', minimo: 4.5 },
  { texto: 'texto', fundo: 'linha', minimo: 4.5 },
  { texto: 'suave', fundo: 'cartao', minimo: 4.5 },
  { texto: 'suave', fundo: 'fundo', minimo: 4.5 },
  { texto: 'link', fundo: 'cartao', minimo: 4.5 },
  { texto: 'erro', fundo: 'cartao', minimo: 4.5 },
  { texto: 'erro', fundo: 'erro-fundo', minimo: 4.5 },
  { texto: 'aviso', fundo: 'cartao', minimo: 4.5 },
  { texto: 'aviso', fundo: 'aviso-fundo', minimo: 4.5 },
  { texto: 'ok', fundo: 'cartao', minimo: 4.5 },
  { texto: 'ok', fundo: 'ok-fundo', minimo: 4.5 },
  { texto: 'botao-texto', fundo: 'botao', minimo: 4.5 },
  { texto: 'campo', fundo: 'cartao', minimo: 3 },
  { texto: 'campo', fundo: 'fundo', minimo: 3 },
];

/**
 * Plano 16 (§4.7, D8): tokens só do portal do paciente ([data-app='paciente']), [claro, escuro]. Fundo, texto, suave,
 * cartão e borda do portal são os de TOKENS (os valores claros da spec são os mesmos). `p-marco-texto` é escuro nos dois
 * modos: no escuro o token `texto` é claro e reprovaria sobre o âmbar.
 */
export const TOKENS_PORTAL = {
  'p-clara': ['#e2efe9', '#1f3a31'],
  'p-marco': ['#f0b867', '#f0b867'],
  'p-marco-texto': ['#14211d', '#14211d'],
} as const satisfies Record<string, readonly [string, string]>;

export type TokenPortal = keyof typeof TOKENS_PORTAL;

/** Pares do portal: balão do paciente (texto e hora sobre p-clara), chip/marco âmbar, contorno do marco contra o fundo (1.4.11). */
export const PARES_PORTAL: readonly { texto: Token | TokenPortal; fundo: Token | TokenPortal; minimo: number }[] = [
  { texto: 'texto', fundo: 'p-clara', minimo: 4.5 },
  { texto: 'suave', fundo: 'p-clara', minimo: 4.5 },
  { texto: 'link', fundo: 'p-clara', minimo: 4.5 },
  { texto: 'p-marco-texto', fundo: 'p-marco', minimo: 4.5 },
  { texto: 'texto', fundo: 'fundo', minimo: 3 },
];
