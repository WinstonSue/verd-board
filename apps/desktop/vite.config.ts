/// <reference types='vitest' />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'node:path';

export default defineConfig(({ command, mode }) => {
  const automated = command === 'serve' && mode === 'e2e';
  const electronOutput =
    command === 'build'
      ? 'dist-electron'
      : automated
        ? 'dist-electron-e2e'
        : 'dist-electron-dev';
  const mainEntry = path.resolve(__dirname, electronOutput, 'main.js');
  let started = false;
  const compiled = new Set<string>();
  const watchReady = (entry: string) => ({
    name: `desktop-ready-${entry}`,
    buildStart() {
      compiled.delete(entry);
    },
    writeBundle() {
      compiled.add(entry);
    },
  });
  return {
    root: __dirname,
    cacheDir: `../../node_modules/.vite/apps/desktop${automated ? '-e2e' : ''}`,
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
      port: automated ? 7310 : 7300,
      host: '127.0.0.1',
      strictPort: true,
    },

    preview: {
      port: 4400,
      host: 'localhost',
    },

    plugins: process.env.VITEST
      ? [react()]
      : [
          react(),
          {
            name: 'desktop-e2e-ready',
            configureServer(server) {
              if (!automated) return;
              server.middlewares.use(
                '/__desktop-e2e-ready',
                (_request, response) => {
                  response.statusCode = compiled.size === 2 ? 200 : 503;
                  response.end(compiled.size === 2 ? 'ready' : 'compiling');
                },
              );
            },
          },
          electron([
            {
              entry: 'electron/main.ts',
              onstart(options) {
                if (automated) return;
                started = true;
                void options.startup([mainEntry]);
              },
              vite: {
                plugins: [watchReady('main')],
                build: {
                  outDir: electronOutput,
                  rollupOptions: {
                    external: ['electron'],
                  },
                },
              },
            },
            {
              entry: 'electron/preload.ts',
              onstart(options) {
                if (automated) return;
                if (started) options.reload();
                else {
                  started = true;
                  void options.startup([mainEntry]);
                }
              },
              vite: {
                plugins: [watchReady('preload')],
                build: {
                  outDir: electronOutput,
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
  };
});
