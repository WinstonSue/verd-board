import { test as base, type Page } from '@playwright/test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
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
const buildDirectory = path.join(
  repo,
  `apps/service/dist-e2e-${Number(process.env.VERDBOARD_SERVICE_PORT ?? 7330)}`,
);
export const test = base.extend<{ localService: ServiceFixture }>({
  localService: [
    async ({ baseURL }, runFixture, info) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-web-e2e-'));
      const dataRoot = path.join(root, 'data');
      const workspace = path.join(dataRoot, 'workspaces/default');
      await fs.mkdir(workspace, { recursive: true });
      const port =
        info.project.metadata.runtime === 'production'
          ? Number(new URL(baseURL!).port)
          : Number(process.env.VERDBOARD_SERVICE_PORT ?? 7330);
      let child: ChildProcess | undefined;
      let logs = '';
      async function start() {
        child = spawn(
          process.execPath,
          [
            path.join(buildDirectory, 'main.mjs'),
            ...(info.project.metadata.runtime === 'production'
              ? []
              : ['--dev']),
          ],
          {
            cwd: repo,
            env: {
              ...process.env,
              VERDBOARD_WEB_DATA_PATH: dataRoot,
              VERDBOARD_WORKSPACE_BOUNDARY: root,
              VERDBOARD_EMPTY_DEFAULT: '1',
              VERDBOARD_WORKSPACE_PATH: undefined,
              VERDBOARD_SERVICE_PORT: String(port),
              VERDBOARD_WEB_PORT: new URL(baseURL!).port,
              VERDBOARD_SERVICE_TEST: '1',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        child.stdout?.on('data', (chunk) => {
          logs += chunk;
        });
        child.stderr?.on('data', (chunk) => {
          logs += chunk;
        });
        for (let attempt = 0; attempt < 240; attempt++) {
          if (child.exitCode !== null)
            throw new Error('Service startup failed:\n' + logs);
          try {
            if ((await fetch(`http://127.0.0.1:${port}/api/v1/health`)).ok)
              return;
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('Service did not become ready:\n' + logs);
      }
      async function stop() {
        const running = child;
        if (!running || running.exitCode !== null) return;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => running.kill('SIGKILL'), 10000);
          running.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
          running.kill('SIGTERM');
        });
      }
      const fixture: ServiceFixture = {
        root,
        workspace,
        dataRoot,
        get openedPaths() {
          return logs
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
          const session = await fs
            .readFile(path.join(workspace, '.verdscrolls/session.json'), 'utf8')
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
        await stop();
        if (info.status !== info.expectedStatus)
          await info.attach('local-service.log', {
            body: logs,
            contentType: 'text/plain',
          });
        await fs.rm(root, { recursive: true, force: true });
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
