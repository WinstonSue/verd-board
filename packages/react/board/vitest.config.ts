import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import shared from '../../../vitest.shared';

export default defineConfig({
  ...shared,
  plugins: [react()],
  test: {
    ...shared.test,
    environment: 'jsdom',
  },
});
