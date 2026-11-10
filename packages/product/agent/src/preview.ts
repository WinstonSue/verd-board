import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import {
  resourceStoragePath,
  type WorkspaceFile,
} from '@sue/verd-board-app/headless';

export async function previewAuthoring(
  files: WorkspaceFile[],
  fileId: string,
  output: string,
  options: { workspaceRoot?: string } = {},
) {
  files = structuredClone(files);
  const assetCache = new Map<string, string>();
  const workspaceRoot = options.workspaceRoot
    ? await fs.realpath(options.workspaceRoot)
    : undefined;
  const inline = async (value: unknown): Promise<void> => {
    if (!value || typeof value !== 'object') return;
    const obj = value as Record<string, unknown>;
    if (
      typeof obj['src'] === 'string' &&
      obj['src'].startsWith('verd-asset:')
    ) {
      const asset = obj['src'].slice(11);
      if (
        !workspaceRoot ||
        !/^\.verd-resources\/assets\/[a-z0-9]+\.[a-z0-9]+$/.test(asset)
      )
        throw new Error(
          'Managed image preview requires a workspace root and a valid asset address',
        );
      let source = assetCache.get(asset);
      if (!source) {
        const resolved = await fs
          .realpath(path.join(workspaceRoot, resourceStoragePath(asset)))
          .catch((error) => {
            if (error.code !== 'ENOENT') throw error;
            return fs.realpath(path.join(workspaceRoot, asset));
          });
        if (!resolved.startsWith(workspaceRoot + path.sep))
          throw new Error('Asset escapes workspace');
        const bytes = await fs.readFile(resolved);
        const extension = path.extname(asset).slice(1);
        source = `data:image/${extension === 'jpg' ? 'jpeg' : extension};base64,${bytes.toString('base64')}`;
        assetCache.set(asset, source);
      }
      obj['src'] = source;
    }
    await Promise.all(Object.values(obj).map(inline));
  };
  await inline(files);

  const format = path.extname(output).slice(1);
  if (format !== 'svg' && format !== 'png')
    throw new Error('Preview output must end in .svg or .png');
  const assets = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'preview',
  );
  await fs.access(path.join(assets, 'preview.html')).catch(() => {
    throw new Error(
      'Preview assets are missing: build or reinstall the agent package',
    );
  });
  const server = createServer(async (request, response) => {
    try {
      const requested = decodeURIComponent(
        new URL(request.url ?? '/', 'http://localhost').pathname,
      );
      const resource = path.resolve(
        assets,
        requested === '/' ? 'preview.html' : '.' + requested,
      );
      if (!resource.startsWith(assets + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      const content = await fs.readFile(resource);
      response.setHeader(
        'Content-Type',
        resource.endsWith('.js')
          ? 'text/javascript'
          : resource.endsWith('.css')
            ? 'text/css'
            : 'text/html',
      );
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser: import('playwright').Browser | undefined;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch().catch((error) => {
      throw new Error(
        String(error).includes("Executable doesn't exist")
          ? 'BROWSER_UNAVAILABLE: run verd preview --install-browser'
          : 'BROWSER_LAUNCH_FAILED: ' + String(error),
      );
    });
    const page = await browser.newPage({
      viewport: { width: 1200, height: 900 },
      deviceScaleFactor: 1,
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Preview server unavailable');
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { renderAgentPreview: unknown })
          .renderAgentPreview === 'function',
    );
    const result = await page.evaluate(
      async ({ files, fileId, format }) => {
        const render = (
          window as unknown as {
            renderAgentPreview: (
              files: unknown[],
              id: string,
              format: string,
            ) => Promise<{
              data?: string;
              document?: boolean;
              warnings: unknown[];
            }>;
          }
        ).renderAgentPreview;
        return render(files, fileId, format);
      },
      { files, fileId, format },
    );
    await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
    if (result.document)
      await page.locator('#root').screenshot({ path: output });
    else await fs.writeFile(output, Buffer.from(result.data!, 'base64'));
    return { output: path.resolve(output), warnings: result.warnings };
  } finally {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
