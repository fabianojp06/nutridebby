import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
    // Runner próprio: o contêiner do job enxerga os 8 núcleos da VPS (o padrão daria 7 workers numa cota de 4 núcleos e
    // expôs um deadlock de DDL do rls-guard contra outro arquivo). 3, como no runner hospedado de 4 vCPU.
    ...(process.env.CI ? { maxWorkers: 3 } : {}),
  },
});
