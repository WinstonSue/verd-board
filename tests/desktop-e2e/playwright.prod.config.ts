import { defineConfig } from '@playwright/test';

process.env['VERDBOARD_E2E_MODE'] = 'prod';

/** Requires pnpm build:desktop. Never starts a dev server or builds implicitly. */
export default defineConfig({
  retries: 0,
  maxFailures: 0,
  testDir: './src',
  testIgnore: ['**/packaged.spec.ts', '**/dev-runtime.spec.ts'],
  workers: 1,
  timeout: 60_000,
  // Fresh profiles install and verify bundled agent tools before showing UI.
  expect: { timeout: 30_000 },
  outputDir: '../../test-results/desktop-prod',
  use: { trace: 'retain-on-failure' },
});
