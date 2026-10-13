import { defineConfig } from 'vitest/config';
import { selecaoDosTestes } from './test/arquivos-de-tempo';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    // include/exclude e workers: no CI, os testes de tempo rodam à parte (pnpm test:tempo; test/arquivos-de-tempo.ts)
    ...selecaoDosTestes(process.env),
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
