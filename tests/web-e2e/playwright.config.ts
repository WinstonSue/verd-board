import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const rootDir = path.resolve(__dirname, '../..');
const baseURL = process.env['BASE_URL'] || 'http://127.0.0.1:7320';

export default defineConfig({
  reporter: process.env.REMOTE_TEST_REPORTER
    ? [['dot'], [process.env.REMOTE_TEST_REPORTER]]
    : undefined,
  retries: 0,
  maxFailures: 0,
  testDir: './src',
  timeout: 60_000,
  workers: 1,
  outputDir: process.env.VERDBOARD_E2E_OUTPUT ?? 'test-results',
  use: {
    baseURL,
    trace: process.env.REMOTE_TEST_TRACE === 'all' ? 'on' : 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/web-e2e.mjs dev',
    env: {
      VERDBOARD_WEB_PORT: new URL(baseURL).port,
      VERDBOARD_SERVICE_PORT: process.env.VERDBOARD_SERVICE_PORT ?? '7330',
    },
    cwd: rootDir,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
