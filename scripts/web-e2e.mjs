import { build, createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serviceRoot = path.join(root, 'apps/service');
const buildKey = Number(process.env.VERDBOARD_SERVICE_PORT ?? 7330);
const outDir = path.join(serviceRoot, `dist-e2e-${buildKey}`);
await build({
  root: serviceRoot,
  configFile: path.join(serviceRoot, 'vite.config.ts'),
  build: { outDir },
});
await build({
  root: serviceRoot,
  configFile: path.join(serviceRoot, 'vite.config.ts'),
  build: {
    outDir,
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
if (process.argv[2] === 'dev') {
  process.env.VERDBOARD_SERVICE_PORT =
    process.env.VERDBOARD_SERVICE_PORT ?? '7330';
  process.env.VERDBOARD_WEB_PORT = process.env.VERDBOARD_WEB_PORT ?? '7320';
  const server = await createServer({
    root: path.join(root, 'apps/web'),
    configFile: path.join(root, 'apps/web/vite.config.ts'),
    cacheDir: path.join(root, `node_modules/.vite/apps/web-e2e-${buildKey}`),
    server: { host: '127.0.0.1' },
  });
  await server.listen();
  server.printUrls();
  process.on('SIGINT', () => void server.close());
  process.on('SIGTERM', () => void server.close());
}
