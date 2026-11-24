/** A origem da aplicação é a de `valor`? URL inválida → não. */
function mesmaOrigem(valor: string, appUrl: string): boolean {
  return URL.canParse(valor) && new URL(valor).origin === new URL(appUrl).origin;
}

/**
 * RN-493 (Plano 26; molde de `recusaDeOrigem`, RN-321 do Plano 20), também na impressão da agenda (Plano 23, RN-419): a
 * navegação (GET) que grava `exportar` em nome da nutricionista — o cookie da sessão (SameSite=Lax) vai junto numa
 * navegação vinda de outro site. Só vale o pedido da própria origem (o link do painel: `same-origin`) ou digitado na barra
 * de endereço (`none`). Sem `Sec-Fetch-Site` (navegador antigo), vale só com `Origin` — ou, sem ele, `Referer` — da origem
 * do APP_URL. Fora disso, quem chama volta para a tela de origem sem ler nem gravar nada.
 */
export function navegacaoDaPropriaOrigem(h: Headers, appUrl: string): boolean {
  const site = h.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin' || site === 'none';
  const origin = h.get('origin');
  if (origin !== null) return mesmaOrigem(origin, appUrl);
  const referer = h.get('referer');
  return referer !== null && mesmaOrigem(referer, appUrl);
}
