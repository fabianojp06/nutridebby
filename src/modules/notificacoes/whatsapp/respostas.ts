export type Intencao = 'confirmar' | 'remarcar';

const CONFIRMAR = new Set(['1', 'sim', 'confirmo', 'confirmar', 'confirmado', 'confirmada', 'ok']);
const REMARCAR = new Set(['2', 'remarcar', 'preciso remarcar', 'quero remarcar', 'nao posso', 'nao vou poder']);

/**
 * D3: só respostas curtas e inequívocas; o resto (inclusive "sim, mas atraso") fica para a nutricionista ler no próprio
 * WhatsApp. Roda na rota do webhook (D5): o texto nunca sai dela — só a intenção.
 */
export function interpretarResposta(texto: string): Intencao | null {
  if (texto.length > 60) return null;
  const t = texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // marcas combinantes (acentos) que o NFD separou
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (CONFIRMAR.has(t)) return 'confirmar';
  if (REMARCAR.has(t)) return 'remarcar';
  return null;
}
