import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';

/** Serves the latest web production build. It never reuses a dev server. */
export default defineConfig({
  reporter: process.env.REMOTE_TEST_REPORTER
    ? [['dot'], [process.env.REMOTE_TEST_REPORTER]]
    : undefined,
  retries: 0,
  maxFailures: 0,
  testDir: './src',
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL,
    trace: process.env.REMOTE_TEST_TRACE === 'all' ? 'on' : 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      metadata: { runtime: 'production' },
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
