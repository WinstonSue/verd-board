import { reporterPath } from '../../scripts/remote-playwright-reporter.cjs';
import { runtimeTests } from '../../scripts/e2e-selection.cjs';
import { defineConfig } from '@playwright/test';

process.env['VERDBOARD_E2E_MODE'] = 'prod';

/** Requires pnpm build:desktop. Never starts a dev server or builds implicitly. */
export default defineConfig({
  reporter: process.env.REMOTE_TEST_REPORTER
    ? [['dot'], [reporterPath]]
    : undefined,
  retries: 0,
  maxFailures: 0,
  testDir: './src',
  testMatch: runtimeTests('desktop', 'production'),
  testIgnore: ['**/packaged.spec.ts', '**/dev-runtime.spec.ts'],
  workers: 1,
  timeout: 60_000,
  // Fresh profiles install and verify bundled agent tools before showing UI.
  expect: { timeout: 30_000 },
  outputDir: '../../test-results/desktop-prod',
  use: {
    trace: process.env.REMOTE_TEST_TRACE === 'all' ? 'on' : 'retain-on-failure',
  },
});
