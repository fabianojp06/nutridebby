const UNIDADES = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatarBytes(n: number): string {
  let v = n;
  let i = 0;
  while (v >= 1024 && i < UNIDADES.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: i === 0 ? 0 : 1 }).format(v)} ${UNIDADES[i]}`;
}
