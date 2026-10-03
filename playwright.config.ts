import { defineConfig, devices } from '@playwright/test';

// PF-N16: 3000 é o painel do Easypanel na VPS; 3100 em dev/E2E local, 3000 em CI/containers.
const baseURL = process.env.APP_URL ?? (process.env.CI ? 'http://localhost:3000' : 'http://localhost:3100');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /acessibilidade\.spec\.ts/ },
    // RNF-09 / RNF-10: as telas do PWA no tamanho de um Android (Chrome) — o Safari do iOS fica no teste manual do runbook
    { name: 'celular', use: { ...devices['Pixel 7'] }, testMatch: /acessibilidade\.spec\.ts/ },
  ],
  webServer: [
    {
      command: `node_modules/.bin/next start -p ${new URL(baseURL).port || 3000}`,
      url: `${baseURL}/entrar`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // e-mails (Mailpit) são enviados pelo worker
      command: 'pnpm worker',
      wait: { stdout: /worker iniciado/ },
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
  ],
});
