import { build, createServer, loadConfigFromFile } from 'vite';
import react from '@vitejs/plugin-react';
import { createServer as createHttpServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT as root, hash, sourceInventory } from './release-review.mjs';
import { webE2EOptions } from './web-e2e-runtime.mjs';

export const buildDirectory =
  process.env.VERD_WEB_E2E_BUILD ??
  path.join(root, 'apps/service/dist-e2e-standalone');

export async function prepareWebE2E({
  directory = buildDirectory,
  inventory = sourceInventory,
  buildService = build,
  reuse = Boolean(process.env.VERD_WEB_E2E_BUILD),
} = {}) {
  const sourceDigest = hash(await inventory());
  const marker = path.join(directory, 'source.json');
  const previous = await fs
    .readFile(marker, 'utf8')
    .then(JSON.parse, () => null);
  if (reuse && previous?.sourceDigest === sourceDigest) {
    await fs.access(path.join(directory, 'main.mjs'));
    await fs.access(path.join(directory, 'test-support.mjs'));
    return;
  }
  const serviceRoot = path.join(root, 'apps/service');
  await buildService({
    root: serviceRoot,
    configFile: path.join(serviceRoot, 'vite.config.ts'),
    build: { outDir: directory },
  });
  await buildService({
    root: serviceRoot,
    configFile: path.join(serviceRoot, 'vite.config.ts'),
    build: {
      outDir: directory,
      ssr: 'src/test-support.ts',
      emptyOutDir: false,
      rollupOptions: {
        output: {
          entryFileNames: 'test-support.mjs',
          inlineDynamicImports: true,
        },
      },
    },
  });
  if (hash(await inventory()) !== sourceDigest)
    throw new Error('Source changed while preparing Web E2E service');
  await fs.writeFile(marker, JSON.stringify({ sourceDigest }));
}

export async function serveWebE2E() {
  const options = webE2EOptions();
  let vite;
  let proxyOptions;
  const http = createHttpServer((request, response) =>
    vite.middlewares(request, response),
  );
  const sockets = new Set();
  http.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  let closing;
  const close = () => {
    closing ??= (async () => {
      for (const socket of sockets) socket.destroy();
      await vite?.close();
      if (http.listening)
        await new Promise((resolve, reject) =>
          http.close((error) => (error ? reject(error) : resolve())),
        );
    })();
    return closing;
  };
  const shutdown = () =>
    void close().then(
      () => process.exit(0),
      (error) => {
        console.error(error);
        process.exit(1);
      },
    );
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  if (process.connected) process.once('disconnect', shutdown);
  try {
    const { config } = await loadConfigFromFile(
      { command: 'serve', mode: 'development' },
      path.join(root, 'apps/web/vite.config.ts'),
    );
    // Keep automatic JSX compilation, without window-only Refresh code in
    // shared modules loaded by Git workers. Preserve the normal HMR transport.
    const plugins = config.plugins
      .flat(Infinity)
      .filter((plugin) => !plugin?.name?.startsWith('vite:react-'));
    vite = await createServer({
      ...config,
      configFile: false,
      plugins: [...plugins, react({ include: /^$/ })],
      cacheDir: path.join(
        root,
        `node_modules/.vite/apps/web-e2e-${process.pid}`,
      ),
      server: {
        ...config.server,
        middlewareMode: true,
        hmr: { server: http },
        watch: null,
        proxy: {
          ...config.server.proxy,
          '/api': {
            target: 'http://127.0.0.1:1',
            changeOrigin: true,
            configure(_proxy, value) {
              proxyOptions = value;
            },
          },
        },
      },
    });
    await new Promise((resolve, reject) => {
      http.once('error', reject);
      http.listen(options.webPort, options.hostname, () => {
        http.off('error', reject);
        resolve();
      });
    });
    process.on('message', (message) => {
      if (message?.type !== 'target') return;
      proxyOptions.target = message.origin ?? 'http://127.0.0.1:1';
      process.send?.({ type: 'target', id: message.id });
    });
    const { port } = http.address();
    console.log(`Web E2E frontend: http://${options.hostname}:${port}`);
    process.send?.({ type: 'ready', port });
    return { close };
  } catch (error) {
    await close();
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const mode = process.argv[2];
  if (mode === 'prepare') await prepareWebE2E();
  else if (mode === 'serve') await serveWebE2E();
  else throw new Error('Use web-e2e.mjs prepare|serve');
}
