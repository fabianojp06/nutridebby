import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

// SUS-101: fora do CI, só as chaves de que o config e os helpers do E2E precisam vêm do .env.local do worktree (a porta
// da APP_URL, o banco do e2e/whatsapp.ts, o segredo do webhook, o Mailpit). O resto fica com o carregador do próprio
// Next no `next start`: copiar o arquivo inteiro levaria o NODE_ENV=development do .env.local ao build de produção
// (o CI roda com NODE_ENV=production). Variável já exportada no shell vence, como no `tsx --env-file-if-exists`.
const ENV_LOCAL = fileURLToPath(new URL('./.env.local', import.meta.url));
const DO_ENV_LOCAL = ['APP_URL', 'DATABASE_URL', 'EVOLUTION_WEBHOOK_SECRET', 'MAILPIT_URL'] as const;
if (!process.env.CI && existsSync(ENV_LOCAL)) {
  const arquivo = parseEnv(readFileSync(ENV_LOCAL, 'utf8'));
  for (const nome of DO_ENV_LOCAL) if (process.env[nome] === undefined && arquivo[nome] !== undefined) process.env[nome] = arquivo[nome];
}

// O início da execução, antes dos webServers: o e-mail que o worker desta execução envia nasce depois dele (o convite da
// recepção da semente, e2e/equipe-primeiro-acesso.spec.ts). O processo principal define; os workers do Playwright herdam o
// ambiente e o `??=` não sobrescreve ao recarregar o config.
process.env.E2E_INICIO ??= new Date().toISOString();

// PF-N16: 3000 é o painel do Easypanel na VPS; 3100 em dev/E2E local, 3000 em CI/containers.
const baseURL = process.env.APP_URL ?? (process.env.CI ? 'http://localhost:3000' : 'http://localhost:3100');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // Runner próprio: o contêiner do job enxerga os 8 núcleos da VPS, mas a slice do CI limita a 4 (o padrão do Playwright,
  // metade dos núcleos vistos, daria 4 workers e estouraria prazos). 2, como no runner hospedado de 4 vCPU.
  workers: process.env.CI ? 2 : undefined,
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
      // IA_PROVEDOR=sandbox aqui também (R9, manual técnico 10.10): fora do CI, o .env.local não traz a IA — sem ela, a IA Nutri
      // fica `ausente` e /p/plano/ia/autorizar volta ao plano (o beforeAll do acessibilidade e do acessibilidade-painel)
      env: { SESSAO_TESTE_MS: '30000', IA_PROVEDOR: 'sandbox', IA_RETENCAO_ZERO: '1' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // e-mails (Mailpit) são enviados pelo worker
      command: 'pnpm worker',
      env: { IA_PROVEDOR: 'sandbox', IA_RETENCAO_ZERO: '1' },
      wait: { stdout: /worker iniciado/ },
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
  ],
});
