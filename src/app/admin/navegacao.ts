/** P16-17: as três abas da administração. Puro (as `AbasDoAdmin` são cliente). */
export const ABAS_DO_ADMIN = [
  { href: '/admin', rotulo: 'Contas' },
  { href: '/admin/servidor', rotulo: 'Servidor' },
  { href: '/admin/seguranca', rotulo: 'Segurança' },
] as const;

const dentro = (caminho: string, base: string) => caminho === base || caminho.startsWith(`${base}/`);

/** A aba marcada: "Contas" na lista e em toda página de conta (`/admin/contas/**`, inclusive "Nova conta"). */
export function abaAtual(caminho: string): string | null {
  if (caminho === '/admin' || dentro(caminho, '/admin/contas')) return '/admin';
  return ABAS_DO_ADMIN.find((a) => a.href !== '/admin' && dentro(caminho, a.href))?.href ?? null;
}
