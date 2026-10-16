import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const rootDir = path.resolve(__dirname, '../..');
const baseURL = process.env['BASE_URL'] || 'http://localhost:7200';

export default defineConfig({
  testDir: './src',
  timeout: 60_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec turbo run dev --filter=web',
    cwd: rootDir,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
