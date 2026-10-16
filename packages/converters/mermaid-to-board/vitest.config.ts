/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    fileParallelism: false,
    setupFiles: ['./tests/setup.ts'],
    passWithNoTests: true,
    coverage: {
      reporter: ['text', 'json-summary', 'json', 'html', 'lcovonly'],
    },
  },
});
