import { pdfAssets } from '../../scripts/pdf-assets';
/// <reference types='vitest' />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/web',
  test: {
    globals: true,
    environment: 'jsdom',
    passWithNoTests: true,
  },

  server: {
    port: 7200,
    host: 'localhost',
    headers: { 'Content-Security-Policy': "frame-ancestors 'none'" },
  },

  preview: {
    port: 4300,
    host: 'localhost',
    headers: { 'Content-Security-Policy': "frame-ancestors 'none'" },
  },

  plugins: [react(), pdfAssets()],

  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});
