import { test as base, type Page } from '@playwright/test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  startReadyProcess,
  setServiceTarget,
  webE2EOptions,
} from '../../../scripts/web-e2e-runtime.mjs';
import { pathToFileURL } from 'node:url';

export * from '@playwright/test';
export interface DiskSnapshot {
  nodes: {
    path: string;
    kind: 'file' | 'directory';
    text: string;
    content: number[];
  }[];
  meta: {
    config: { version: number; value: Record<string, unknown> };
    session?: any;
  };
}
export interface ServiceFixture {
  root: string;
  workspace: string;
  dataRoot: string;
  readonly origin: string;
  readDisk(): Promise<DiskSnapshot>;
  seedLegacy(records: [string, unknown][]): Promise<void>;
  restart(): Promise<void>;
  legacyBackup?: unknown;
  readonly openedPaths: string[];
}
let active: ServiceFixture | undefined;
export function serviceFixture(_page?: Page): ServiceFixture {
  if (!active) throw new Error('Service fixture is not running');
  return active;
}
const repo = path.resolve(__dirname, '../../..');
const buildDirectory =
  process.env.VERD_WEB_E2E_BUILD ??
  path.join(repo, 'apps/service/dist-e2e-standalone');
interface WebRuntime {
  origin?: string;
  setTarget(origin?: string): Promise<void>;
}
export const test = base.extend<
  { localService: ServiceFixture },
  { webRuntime: WebRuntime }
>({
  webRuntime: [
    async ({}, runFixture, info) => {
      if (info.project.metadata.runtime === 'production') {
        await runFixture({ setTarget: async () => {} });
        return;
      }
      const options = webE2EOptions();
      const frontend = await startReadyProcess(
        process.execPath,
        ['scripts/web-e2e.mjs', 'serve'],
        { cwd: repo, env: process.env, port: options.webPort, timeout: 120000 },
      );
      try {
        await runFixture({
          origin: `http://${options.hostname}:${(frontend.ready as { port: number }).port}`,
          async setTarget(origin) {
            await setServiceTarget(frontend.child, origin);
          },
        });
      } finally {
        await frontend.stop();
      }
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ localService, webRuntime }, runFixture) => {
    await runFixture(webRuntime.origin ?? localService.origin);
  },
  localService: [
    async ({ webRuntime }, runFixture, info) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-web-e2e-'));
      const dataRoot = path.join(root, 'data');
      const workspace = path.join(dataRoot, 'workspaces/default');
      await fs.mkdir(workspace, { recursive: true });
      const production = info.project.metadata.runtime === 'production';
      const options = webE2EOptions();
      let port = production
        ? options.webPort || options.servicePort
        : options.servicePort;
      let running: Awaited<ReturnType<typeof startReadyProcess>> | undefined;
      let logs = '';
      async function start() {
        running = await startReadyProcess(
          process.execPath,
          [
            path.join(buildDirectory, 'main.mjs'),
            ...(production ? [] : ['--dev']),
          ],
          {
            cwd: repo,
            port,
            env: {
              ...process.env,
              VERDBOARD_WEB_DATA_PATH: dataRoot,
              VERDBOARD_WORKSPACE_BOUNDARY: root,
              VERDBOARD_EMPTY_DEFAULT: '1',
              VERDBOARD_WORKSPACE_PATH: undefined,
              VERDBOARD_SERVICE_PORT: String(port),
              VERDBOARD_WEB_PORT: webRuntime.origin
                ? new URL(webRuntime.origin).port
                : String(port),
              VERDBOARD_SERVICE_TEST: '1',
            },
          },
        );
        port = (running.ready as { port: number }).port;
        await webRuntime.setTarget(`http://127.0.0.1:${port}`);
      }
      async function stop() {
        const previous = running;
        running = undefined;
        if (!previous) return;
        await previous.stop();
        logs += previous.logs;
      }
      const fixture: ServiceFixture = {
        root,
        workspace,
        dataRoot,
        get origin() {
          return `http://${options.hostname}:${port}`;
        },
        get openedPaths() {
          return (logs + (running?.logs ?? ''))
            .split('\n')
            .filter((line) => line.startsWith('VERD_OPEN_PATH '))
            .map((line) => JSON.parse(line.slice(15)) as string);
        },
        async readDisk() {
          const nodes: DiskSnapshot['nodes'] = [];
          async function walk(folder: string, prefix = '') {
            for (const entry of await fs.readdir(folder, {
              withFileTypes: true,
            })) {
              const location = prefix ? prefix + '/' + entry.name : entry.name;
              if (
                entry.name === '.git' ||
                entry.name === '.verdscrolls' ||
                /\.\d+\.[a-f0-9-]+\.tmp$/.test(entry.name)
              )
                continue;
              if (entry.isDirectory()) {
                nodes.push({
                  path: location,
                  kind: 'directory',
                  content: [],
                  text: '',
                });
                await walk(path.join(folder, entry.name), location);
              } else if (entry.isFile()) {
                const bytes = await fs.readFile(path.join(folder, entry.name));
                nodes.push({
                  path: location,
                  kind: 'file',
                  content: [...bytes],
                  text: bytes.toString('utf8'),
                });
              }
            }
          }
          await walk(workspace);
          const config = await fs
            .readFile(path.join(workspace, '.verdscrolls/config.json'), 'utf8')
            .then(JSON.parse, () => ({ version: 0, value: {} }));
          const sessions = await fs
            .readdir(path.join(workspace, '.verdscrolls/sessions'))
            .catch((error) => {
              if (error.code === 'ENOENT') return [] as string[];
              throw error;
            });
          const personal = sessions.filter((name) => name.endsWith('.json'));
          if (personal.length > 1)
            throw new Error(
              'Web fixture has multiple host sessions; select the intended host explicitly',
            );
          const session = await fs
            .readFile(
              path.join(
                workspace,
                '.verdscrolls',
                personal.length ? 'sessions/' + personal[0] : 'session.json',
              ),
              'utf8',
            )
            .then(JSON.parse, () => undefined);
          return { nodes, meta: { config, session } };
        },
        async seedLegacy(records) {
          await stop();
          const helpers = await import(
            pathToFileURL(path.join(buildDirectory, 'test-support.mjs')).href
          );
          fixture.legacyBackup = await helpers.seedLegacyWorkspace(
            workspace,
            records,
          );
          await start();
        },
        async restart() {
          await stop();
          await start();
        },
      };
      active = fixture;
      try {
        await start();
        await runFixture(fixture);
      } finally {
        active = undefined;
        try {
          try {
            await webRuntime.setTarget();
          } finally {
            await stop();
          }
        } finally {
          try {
            if (info.status !== info.expectedStatus)
              await info.attach('local-service.log', {
                body: logs,
                contentType: 'text/plain',
              });
          } finally {
            await fs.rm(root, { recursive: true, force: true });
          }
        }
      }
    },
    { auto: true },
  ],
  page: async ({ page, localService }, runFixture) => {
    await page.exposeFunction('__verdReadDisk', () => localService.readDisk());
    await page.exposeFunction(
      '__verdLegacyBackup',
      () => localService.legacyBackup,
    );
    await page.exposeFunction(
      '__verdSeedLegacy',
      (records: [string, unknown][]) => localService.seedLegacy(records),
    );
    await page.addInitScript(
      ({ parent, workspace }) => {
        (window as any).__verdTestParent = parent;
        (window as any).__verdTestWorkspace = workspace;
      },
      { parent: localService.root, workspace: localService.workspace },
    );
    await runFixture(page);
  },
});
