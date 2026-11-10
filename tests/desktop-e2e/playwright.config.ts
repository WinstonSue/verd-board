import { defineConfig } from '@playwright/test';
import path from 'node:path';

process.env['VERDBOARD_E2E_MODE'] = 'dev';

export default defineConfig({
  retries: 0,
  maxFailures: 0,
  testDir: './src',
  testIgnore: ['**/packaged.spec.ts', '**/demo.spec.ts'],
  grepInvert: /@prod/,
  workers: 1,
  timeout: 120_000,
  // Fresh profiles load the Vite source graph and install bundled agent tools.
  expect: { timeout: 30_000 },
  outputDir: '../../test-results/desktop-dev',
  use: { trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm --filter desktop exec vite --mode e2e',
    cwd: path.resolve(__dirname, '../..'),
    url: 'http://127.0.0.1:7310/__desktop-e2e-ready',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
