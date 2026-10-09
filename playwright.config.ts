import { defineConfig, devices } from '@playwright/test';

// PF-N16: 3000 é o painel do Easypanel na VPS; 3100 em dev/E2E local, 3000 em CI/containers.
const baseURL = process.env.APP_URL ?? (process.env.CI ? 'http://localhost:3000' : 'http://localhost:3100');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /acessibilidade(-painel)?\.spec\.ts/ },
    // RNF-09 / RNF-10: as telas do PWA no tamanho de um Android (Chrome) — o Safari do iOS fica no teste manual do runbook
    { name: 'celular', use: { ...devices['Pixel 7'] }, testMatch: /acessibilidade\.spec\.ts/ },
    // D25 (Plano 08): o painel da nutricionista, em tela de computador, nos modos claro, escuro e "igual ao aparelho"
    { name: 'painel', use: { ...devices['Desktop Chrome'] }, testMatch: /acessibilidade-painel\.spec\.ts/ },
  ],
  webServer: [
    {
      command: `node_modules/.bin/next start -p ${new URL(baseURL).port || 3000}`,
      url: `${baseURL}/entrar`,
      // P12-14: prazos curtos da sessão da equipe (30 s) só para o contexto com o cookie nd_sessao_teste
      // (e2e/sessao-equipe.spec.ts); as outras specs seguem com os 30 min. Recusada em produção (src/env.ts).
      // Plano 14A (A-D4): retenção zero só no E2E/dev, com o sandbox (também no worker, abaixo: app e worker iguais)
      env: { SESSAO_TESTE_MS: '30000', IA_RETENCAO_ZERO: '1' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // e-mails (Mailpit) são enviados pelo worker
      command: 'pnpm worker',
      env: { IA_RETENCAO_ZERO: '1' },
      wait: { stdout: /worker iniciado/ },
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
  ],
});
