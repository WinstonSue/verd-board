import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    passWithNoTests: false,
    include: [
      'src/**/*.{spec,test}.{ts,tsx}',
      'tests/**/*.{spec,test}.{ts,tsx}',
    ],
  },
});
