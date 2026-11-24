import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deployAgentResources } from '@sue/verd-board-agent/node';
import { createLocalService } from './service';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const dev = process.argv.includes('--dev');
const appName = dev ? 'VerdBoard Web Dev' : 'VerdBoard Web';
const appData =
  process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library/Application Support')
    : process.platform === 'win32'
      ? (process.env.APPDATA ?? path.join(os.homedir(), 'AppData/Roaming'))
      : (process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local/share'));
const dataRoot = path.resolve(
  process.env.VERDBOARD_WEB_DATA_PATH ?? path.join(appData, appName),
);
const product = JSON.parse(
  await fs.readFile(
    path.join(repoRoot, 'packages/product/app/package.json'),
    'utf8',
  ),
) as { version: string };
const target = `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'}-${process.arch}`;
const prepared = await fs
  .readFile(path.join(repoRoot, 'apps/service/build/agent-source.json'), 'utf8')
  .then(
    (text) => JSON.parse(text) as { path: string },
    () => null,
  );
const resources =
  process.env.VERD_AGENT_RESOURCES ??
  (prepared
    ? path.resolve(repoRoot, prepared.path)
    : path.join(repoRoot, 'apps/desktop/build/agent-resources', target));
let deployed: Promise<string> | undefined;
const service = await createLocalService({
  localCodex: true,
  dataRoot,
  defaultRoot: process.env.VERDBOARD_WORKSPACE_PATH,
  seedDefault: process.env.VERDBOARD_EMPTY_DEFAULT !== '1',
  workspaceBoundary: process.env.VERDBOARD_WORKSPACE_BOUNDARY,
  builtinSource:
    process.env.VERDBOARD_BUILTIN_WORKSPACE_PATH ??
    path.join(
      repoRoot,
      dev ? 'workspace' : 'apps/service/build/builtin-workspaces/workspace',
    ),
  patternSource: path.join(
    repoRoot,
    dev
      ? 'packages/agent/patterns/workspace'
      : 'apps/service/build/builtin-workspaces/agent-patterns',
  ),
  productVersion: product.version,
  openPath:
    process.env.VERDBOARD_SERVICE_TEST === '1'
      ? async (location) => {
          console.log('VERD_OPEN_PATH ' + JSON.stringify(location));
        }
      : undefined,
  webRoot: dev
    ? undefined
    : path.join(
        repoRoot,
        process.env.VERDBOARD_SERVICE_TEST === '1'
          ? 'apps/web/dist-e2e'
          : 'apps/web/dist',
      ),
  allowedOrigins: dev
    ? [
        `http://localhost:${process.env.VERDBOARD_WEB_PORT ?? 7200}`,
        `http://127.0.0.1:${process.env.VERDBOARD_WEB_PORT ?? 7200}`,
      ]
    : undefined,
  sharedResources: () =>
    process.env.VERDBOARD_SERVICE_TEST === '1'
      ? resources
      : (deployed ??= deployAgentResources(
          resources,
          path.join(dataRoot, 'agent-resources'),
        ).catch((error) => {
          deployed = undefined;
          throw error;
        })),
});
const port = await service.listen(
  Number(process.env.VERDBOARD_SERVICE_PORT ?? (dev ? 7201 : 7200)),
);
console.log(`VerdBoard Web service: http://localhost:${port} (${dataRoot})`);
process.send?.({ type: 'ready', port });
let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  void service.close().then(
    () => process.exit(0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (process.connected) process.once('disconnect', shutdown);
