/** WCAG 2.1: luminância relativa e razão de contraste entre duas cores #rrggbb. Puro (servidor e cliente). */
const canal = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export function luminancia(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => canal(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** `hex` misturada com `alvo` na proporção `p` (0 = só hex, 1 = só alvo). */
export function misturar(hex: string, alvo: string, p: number): string {
  const [a, b] = [rgb(hex), rgb(alvo)];
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * p).toString(16).padStart(2, '0')).join('')}`;
}
