import { cpSync, mkdirSync, createReadStream, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';
export function pdfAssets(): Plugin {
  const root = path.resolve(__dirname, '..');
  const require = createRequire(
    path.join(root, 'packages/product/app/package.json'),
  );
  const source = path.dirname(require.resolve('pdfjs-dist/package.json'));
  let out = '';
  return {
    name: 'verd-pdf-assets',
    configureServer(server) {
      server.middlewares.use('/pdf-assets/', (request, response, next) => {
        const relative = (request.url || '').split('?')[0].replace(/^\/+/, '');
        const match = /^(cmaps|standard_fonts|wasm)\/([a-zA-Z0-9_.-]+)$/.exec(
          relative,
        );
        const worker = relative === 'pdf.worker.min.mjs';
        if (!worker && (!match || match[2].includes('..'))) {
          response.statusCode = 404;
          response.end();
          return;
        }
        const file = worker
          ? path.join(source, 'legacy/build/pdf.worker.min.mjs')
          : path.join(source, match![1], match![2]);
        if (!existsSync(file)) {
          response.statusCode = 404;
          response.end();
          return;
        }
        if (file.endsWith('.wasm'))
          response.setHeader('Content-Type', 'application/wasm');
        if (worker) response.setHeader('Content-Type', 'text/javascript');
        createReadStream(file).on('error', next).pipe(response);
      });
    },
    configResolved(config) {
      out = path.resolve(config.root, config.build.outDir, 'pdf-assets');
    },
    writeBundle() {
      mkdirSync(out, { recursive: true });
      for (const name of ['cmaps', 'standard_fonts', 'wasm', 'LICENSE'])
        cpSync(path.join(source, name), path.join(out, name), {
          recursive: true,
        });
      cpSync(
        path.join(source, 'legacy/build/pdf.worker.min.mjs'),
        path.join(out, 'pdf.worker.min.mjs'),
      );
    },
  };
}
