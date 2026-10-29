import { defineConfig } from '@playwright/test';

process.env['VERDBOARD_E2E_MODE'] = 'prod';

/** Requires pnpm build:desktop. Never starts a dev server or builds implicitly. */
export default defineConfig({
  testDir: './src',
  testIgnore: ['**/packaged.spec.ts', '**/dev-runtime.spec.ts'],
  workers: 1,
  timeout: 60_000,
  outputDir: '../../test-results/desktop-prod',
  use: { trace: 'retain-on-failure' },
});
