import { pdfAssets } from '../../scripts/pdf-assets';
/// <reference types='vitest' />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Vite reloads this config when it restarts its server in the same process.
const devLaunch = Symbol.for('verdboard.desktop.devLaunch');
const devProcess = process as NodeJS.Process & { [devLaunch]?: true };

export default defineConfig(({ command, mode }) => {
  const automated = command === 'serve' && mode === 'e2e';
  const interactive = command === 'serve' && !automated;
  const electronOutput =
    command === 'build'
      ? 'dist-electron'
      : automated
        ? 'dist-electron-e2e'
        : 'dist-electron-dev';
  const mainEntry = path.resolve(__dirname, electronOutput, 'main.js');
  const compiled = new Set<string>();
  const watchReady = (entry: string) => ({
    name: `desktop-ready-${entry}`,
    buildStart() {
      compiled.delete(entry);
    },
    writeBundle() {
      compiled.add(entry);
      if (!interactive) return;
      if (devProcess[devLaunch]) {
        console.info('[VerdBoard Dev] 退出 DEV 后重新启动以应用变更。');
        return;
      }
      if (compiled.size !== 2) return;

      const executable: string = createRequire(import.meta.url)('electron');
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        VERDBOARD_INTERACTIVE_DEV: '1',
      };
      delete env['ELECTRON_RUN_AS_NODE'];
      devProcess[devLaunch] = true;
      const child = spawn(executable, [mainEntry], {
        cwd: __dirname,
        env,
        // Keep terminal interrupts on the Vite side. IPC disconnect asks
        // Electron to quit while its renderer can still save.
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      });
      child.once('error', (error) => {
        console.error('[VerdBoard Dev] Electron 启动失败。', error);
        process.exit(1);
      });
      child.once('exit', (code) => process.exit(code ?? 1));
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
          pdfAssets(),
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
          // The plugin compiles both entries. The readiness hooks above own
          // interactive startup and Playwright owns automated startup.
          electron([
            {
              entry: 'electron/main.ts',
              onstart() {},
              vite: {
                plugins: [watchReady('main')],
                resolve: { conditions: ['development', 'module', 'node'] },
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
              onstart() {},
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
