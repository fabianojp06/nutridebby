import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.APP_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node_modules/.bin/next start -p ${new URL(baseURL).port || 3000}`,
    url: `${baseURL}/entrar`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
