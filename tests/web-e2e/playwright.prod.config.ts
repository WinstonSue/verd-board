import { reporterPath } from '../../scripts/remote-playwright-reporter.cjs';
import { runtimeTests } from '../../scripts/e2e-selection.cjs';
import { defineConfig, devices } from '@playwright/test';

import { webE2EOptions } from '../../scripts/web-e2e-runtime.mjs';

/** Serves the latest web production build. It never reuses a dev server. */
export default defineConfig({
  reporter: process.env.REMOTE_TEST_REPORTER
    ? [['dot'], [reporterPath]]
    : undefined,
  retries: 0,
  maxFailures: 0,
  testDir: './src',
  testMatch: runtimeTests('web', 'production'),
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  workers: webE2EOptions().workers,
  outputDir: process.env.VERDBOARD_E2E_OUTPUT ?? 'test-results',
  use: {
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
