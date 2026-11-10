import { pdfAssets } from '../../scripts/pdf-assets';
/// <reference types='vitest' />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  resolve: { conditions: ['development', 'browser', 'module'] },
  cacheDir: '../../node_modules/.vite/apps/web',
  test: {
    globals: true,
    environment: 'jsdom',
    passWithNoTests: true,
  },

  server: {
    port: Number(process.env.VERDBOARD_WEB_PORT ?? 7200),
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.VERDBOARD_SERVICE_PORT ?? 7201}`,
        changeOrigin: true,
      },
    },
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
