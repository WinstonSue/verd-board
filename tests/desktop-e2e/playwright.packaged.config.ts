import { reporterPath } from '../../scripts/remote-playwright-reporter.cjs';
import { defineConfig } from '@playwright/test';

/** Only the explicit packaging workflow supplies VERDBOARD_PACKAGED_APP. */
export default defineConfig({
  reporter: process.env.REMOTE_TEST_REPORTER
    ? [['dot'], [reporterPath]]
    : undefined,
  retries: 0,
  maxFailures: 0,
  testDir: './src',
  testMatch: '**/packaged.spec.ts',
  workers: 1,
  timeout: 120_000,
  outputDir: '../../test-results/desktop-packaged',
  use: { trace: 'retain-on-failure' },
});
