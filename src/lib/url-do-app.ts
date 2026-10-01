/**
 * Link absoluto do app: APP_URL + caminho (começando com "/"), mantendo um eventual prefixo de
 * caminho do APP_URL — por isso não é `new URL(caminho, base)`, que o descartaria.
 */
export function urlDoApp(appUrl: string, caminho: string): string {
  return `${appUrl.replace(/\/$/, '')}${caminho}`;
}
