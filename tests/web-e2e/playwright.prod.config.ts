import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const rootDir = path.resolve(__dirname, '../..');
const baseURL = 'http://127.0.0.1:4173';

/** Serves the latest web production build. It never reuses a dev server. */
export default defineConfig({
  testDir: './src',
  timeout: 60_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command:
      'pnpm --filter web exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
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
