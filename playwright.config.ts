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

// PF-N16: 3000 é o painel do Easypanel na VPS; 3100 em dev/E2E local, 3000 em CI/containers.
const baseURL = process.env.APP_URL ?? (process.env.CI ? 'http://localhost:3000' : 'http://localhost:3100');

// SUS-117: os specs do portal do paciente que rodam também no WebKit (Safari do iPhone). Lista explícita, por arquivo:
// entra o spec cujo assunto é o portal (entrar, Hoje, diário, plano, PWA e offline); os do painel ficam só no Chromium.
// Fora, de propósito: `lembretes.spec.ts` (3 dos 4 testes são o axe do painel, com o tema da conta da nutricionista),
// `exames-enviados.spec.ts` e `ia-nutri-paciente.spec.ts` (o lado do paciente não se separa da revisão no painel, em
// testes `serial`). Nesses specs, a nutricionista entra com `painelNoComputador` (e2e/helpers.ts): o painel em tela de
// computador, no mesmo navegador. O job `e2e-webkit` do ci.yml roda este projeto num banco só dele.
const SPECS_DO_PORTAL = [
  'portal.spec.ts',
  'sessao-portal.spec.ts',
  'app-paciente.spec.ts',
  'nada-some.spec.ts',
  'sus-112-recarregar-ao-voltar.spec.ts',
  'fontes-portal.spec.ts',
  // Entram quando chegarem à main (o padrão não acha arquivo que não existe): questionário e metas (Plano 27, PRs 2 e
  // 3), mensagens (Plano 25) e o Enter do editor do site (Plano 28, PR 2). Ao chegar, a nutricionista desses specs
  // também entra com `painelNoComputador`.
  'questionario.spec.ts',
  'metas.spec.ts',
  'mensagens*.spec.ts',
  'site-opinioes.spec.ts',
];

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
    // RNF-09 / RNF-10: as telas do PWA no tamanho de um Android (Chrome); o Safari do iOS, no projeto `webkit` abaixo
    { name: 'celular', use: { ...devices['Pixel 7'] }, testMatch: /acessibilidade\.spec\.ts/ },
    // D25 (Plano 08): o painel da nutricionista, em tela de computador, nos modos claro, escuro e "igual ao aparelho"
    { name: 'painel', use: { ...devices['Desktop Chrome'] }, testMatch: /acessibilidade-painel\.spec\.ts/ },
    // SUS-117 (RNF-09): o portal do paciente no WebKit do Playwright, como o Safari do iPhone (o mais novo da 1.63). O que
    // o Playwright não faz no WebKit (CDP, app instalado) sai por `test.skip(browserName === 'webkit', …)` só no teste.
    // O aparelho de verdade continua no runbook para instalar, push, VoiceOver e foto HEIC (docs/operacao/go-live.md).
    { name: 'webkit', use: { ...devices['iPhone 17'] }, testMatch: SPECS_DO_PORTAL },
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
