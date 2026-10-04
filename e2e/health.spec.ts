import { expect, test } from '@playwright/test';

// RNF-04 / P08-02: o que o monitor externo confere — 200, "ok", sem cache. Sem x-request-id: /api/* fica fora do
// matcher do proxy (D2), o id das APIs só existe no log e no Sentry.
test('GET /api/health responde 200 {"status":"ok"} sem cache, com o worker no ar', async ({ request }) => {
  const r = await request.get('/api/health');
  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ status: 'ok' });
  expect(r.headers()['cache-control']).toBe('no-store');
});
