/** D17: puro (sem banco) — o botão de tema e o manual, no cliente, usam estes tipos. */
export const TEMAS = ['sistema', 'claro', 'escuro'] as const;
export type Tema = (typeof TEMAS)[number];
export const ehTema = (v: unknown): v is Tema => typeof v === 'string' && (TEMAS as readonly string[]).includes(v);

/** O botão alterna o que a usuária VÊ: em "sistema", vira o oposto do modo atual do aparelho. */
export function proximoTema(atual: Tema, aparelhoEscuro: boolean): Tema {
  const efetivo = atual === 'sistema' ? (aparelhoEscuro ? 'escuro' : 'claro') : atual;
  return efetivo === 'escuro' ? 'claro' : 'escuro';
}

export type EstadoGuia = 'concluido' | 'dispensado' | 'visto';
export type ProgressoGuia = Record<string, { v: number; estado: EstadoGuia }>;
export const ID_GUIA = /^[a-z][a-z0-9-]{1,39}$/;
export const ESTADOS_GUIA: readonly EstadoGuia[] = ['concluido', 'dispensado', 'visto'];
