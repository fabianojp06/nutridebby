import { expect, test } from '@playwright/test';
import { entrarComo } from './helpers';

// Plano 16 (RNF-193, D9): as fontes do portal são servidas pelo app (CSP font-src 'self', sem Google) e o primeiro
// carregamento de uma página de /p baixa no máximo 160 KB de woff2. /p/escolher usa o layout de /p (as fontes do portal)
// e é a primeira tela da conta com três consultórios do seed (E2E_MULTI).
const MULTI = { email: 'multi-e2e@nutridebby.test', senha: 'Multi2026segura' };

test('fontes do portal: só do próprio app e até 160 KB de woff2 no primeiro carregamento (RNF-193)', async ({ browser }) => {
  const page = await entrarComo(browser, MULTI.email, MULTI.senha, '10.9.19.6');
  await expect(page).toHaveURL(/\/p\/escolher/);
  // Espera a carga do redirecionamento do login terminar (senão o reload deixa respostas sem corpo) e desliga o cache
  // do navegador: o reload mede o primeiro carregamento, não fontes já guardadas.
  await page.waitForLoadState('networkidle');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const respostas: Promise<{ url: string; bytes: number }>[] = [];
  page.on('response', (r) => {
    if (/\.woff2(\?|$)/.test(r.url())) respostas.push(r.body().then((b) => ({ url: r.url(), bytes: b.length })));
  });
  await page.reload();
  await page.waitForLoadState('networkidle');
  const fontes = await Promise.all(respostas);
  expect(fontes.length, 'o portal carrega as fontes').toBeGreaterThan(0);
  for (const f of fontes) expect(new URL(f.url).origin, f.url).toBe(new URL(page.url()).origin);
  const total = fontes.reduce((s, f) => s + f.bytes, 0);
  console.log(`woff2 no primeiro carregamento de /p/escolher: ${(total / 1024).toFixed(1)} KB em ${fontes.length} arquivo(s)`);
  expect(total).toBeLessThanOrEqual(160 * 1024);
  // P08-13: só as duas do portal (Red Hat Display e Atkinson); as do painel (layout raiz) não têm preload e não são usadas no /p
  expect(fontes.length, 'só as fontes do portal').toBeLessThanOrEqual(2);
  await page.context().close();
});
