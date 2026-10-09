import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, inject } from 'vitest';

// NODE_ENV é tipado como readonly pelos tipos globais do Next.js; Object.assign
// contorna a checagem estática sem afetar o valor em runtime (Vitest já o define
// como 'test' por padrão — a linha abaixo apenas o deixa explícito).
Object.assign(process.env, { NODE_ENV: 'test' });
process.env.APP_URL = 'http://localhost:3000';
process.env.DATABASE_URL = inject('appDatabaseUrl');
process.env.AUTH_SECRET = 'test-secret-with-at-least-32-characters!!';
process.env.LOG_LEVEL = 'error';
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.EMAIL_FROM = 'NutriDebby <nao-responda@nutridebby.test>';
process.env.MAILPIT_URL = 'http://localhost:8025';
process.env.FILE_URL_SECRET = 'file-url-secret-de-teste-com-32-caracteres!';
// Chaves de teste oficiais da Cloudflare (sempre passa); os testes de unidade injetam o verificador
process.env.TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
// Rede de segurança (Plano 11, T4): nenhum teste herda a chave da Anthropic do ambiente.
delete process.env.ANTHROPIC_API_KEY;
// Plano 14A (D2): nenhum teste herda credencial nem configuração da AWS do ambiente
for (const v of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_REGION', 'AWS_BEARER_TOKEN_BEDROCK', 'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS']) delete process.env[v];
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-data-'));
process.env.DATA_DIR = dataDir;

// T8-R2b: cada arquivo de teste ganha sua própria pasta (mkdtempSync); sem isso, elas se acumulam
// em /tmp a cada execução da suíte.
afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
