import { getEnv } from '@/env';

/**
 * S-9 (P06-12, P09-01): rota de escrita com cookie (POST/PUT/PATCH/DELETE) só da própria origem, conferida antes da
 * sessão (guarda em src/app/api/mesma-origem-rotas.test.ts). Sem `Origin` passa (o cookie de sessão é SameSite=Lax, que já
 * não vai em POST entre sites); `Origin` presente e diferente — inclusive vazio ou "null" — é recusado. Um lugar só,
 * em vez da conferência copiada em cada rota (as do painel aceitavam o `Origin` vazio).
 */
export function mesmaOrigem(req: Request, appUrl: string = getEnv().APP_URL): boolean {
  const origem = req.headers.get('origin');
  return origem === null || origem === new URL(appUrl).origin;
}
