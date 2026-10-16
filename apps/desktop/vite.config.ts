/// <reference types='vitest' />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/desktop',
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'electron/**/*.{test,spec}.{ts,tsx}',
    ],
  },

  server: {
    port: 7300,
    host: 'localhost',
  },

  preview: {
    port: 4400,
    host: 'localhost',
  },

  plugins: process.env.VITEST
    ? [react()]
    : [
        react(),
        electron([
          {
            entry: 'electron/main.ts',
            onstart(options) {
              options.startup();
            },
            vite: {
              build: {
                outDir: 'dist-electron',
                rollupOptions: {
                  external: ['electron'],
                },
              },
            },
          },
          {
            entry: 'electron/preload.ts',
            onstart(options) {
              options.reload();
            },
            vite: {
              build: {
                outDir: 'dist-electron',
                rollupOptions: {
                  external: ['electron'],
                },
              },
            },
          },
        ]),
        renderer(),
      ],

  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});
