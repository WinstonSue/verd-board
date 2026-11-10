import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createFsWorkspaceHost,
  type createLocalWorkspaceManager,
  withWorkspaceLock,
} from '@sue/verd-board-agent/node';
import {
  normalizeWorkspaceSessionState,
  normalizeTrashEntryId,
  normalizeWorkspacePath,
  partitionCellStore,
} from '@sue/verd-board-app/headless';
import { migrateLegacyCellWorkspace } from '../../../packages/product/app/src/migration/cell-workspace';
import {
  encodeServiceValue,
  type BrowserBackup,
} from '../../../packages/product/app/src/host/service-protocol';

const exec = promisify(execFile);
const digest = (bytes: Uint8Array | string) =>
  'sha256-' + createHash('sha256').update(bytes).digest('hex');
type Node = {
  wsKey: string;
  path: string;
  kind: 'file' | 'directory';
  content?: Uint8Array;
};
type Meta = {
  wsKey: string;
  config: { version: number; value: Record<string, unknown> };
  session: unknown;
};
type Workspace = {
  key: string;
  name: string;
  pinned?: boolean;
  lastOpenedAt?: number;
  hidden?: boolean;
};
type Trash = {
  wsKey: string;
  entryId: string;
  originalPath: string;
  trashedAt: number;
  nodes: Record<string, Node>;
};
function safePath(input: string) {
  if (
    typeof input !== 'string' ||
    !input ||
    input.includes('\\') ||
    input.includes('\0') ||
    input.includes(':') ||
    input.startsWith('/') ||
    input.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Unsafe migration path: ' + input);
  return input;
}
const runtime = (location: string) =>
  /^\.verdscrolls\/(?:shared|bin|transactions|receipts|staging|locks|instance\.json|agent|runtime)(?:\/|$)/.test(
    location,
  );
async function write(root: string, node: Node, relative = node.path) {
  const location = path.join(root, safePath(relative));
  if (node.kind === 'directory') await fs.mkdir(location, { recursive: true });
  else {
    if (!(node.content instanceof Uint8Array))
      throw new Error('Missing file bytes: ' + relative);
    await fs.mkdir(path.dirname(location), { recursive: true });
    await fs.writeFile(location, node.content, { flag: 'wx' });
    if (digest(await fs.readFile(location)) !== digest(node.content))
      throw new Error('Migration checksum mismatch: ' + relative);
  }
}
function validateGitNode(node: Node) {
  const p = node.path;
  if (!p.startsWith('.git/')) return;
  if (
    /\.lock$/.test(p) ||
    /^\.git\/(?:MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD|rebase-merge|rebase-apply|sequencer)(?:\/|$)/.test(
      p,
    ) ||
    p === '.git/objects/info/alternates' ||
    p === '.git/commondir' ||
    p === '.git/gitdir' ||
    (p.startsWith('.git/hooks/') && !p.endsWith('.sample'))
  )
    throw new Error('Unsupported Git runtime data: ' + p);
  if (p === '.git/config') {
    const config = new TextDecoder().decode(node.content);
    if (
      /^\s*\[\s*(?:include|includeIf|filter|credential|alias|diff|merge|url|protocol|core\s+")/im.test(
        config,
      ) ||
      /^\s*(?:hooksPath|worktree|fsmonitor|sshCommand|pager|editor|askpass)\s*=/im.test(
        config,
      ) ||
      /^\s*bare\s*=\s*true/im.test(config) ||
      /^\s*url\s*=\s*(?:ext::|[^\s]*[;&`])/im.test(config)
    )
      throw new Error('Unsupported executable or external Git configuration');
  }
}

/** Publish a whole import container atomically; source databases are never changed. */
export async function importBrowserBackup(
  backup: BrowserBackup,
  parent: string,
  dataRoot: string,
  manager: ReturnType<typeof createLocalWorkspaceManager>,
  host: ReturnType<typeof createFsWorkspaceHost>,
) {
  if (
    backup?.format !== 'verd-browser-backup' ||
    backup.version !== 1 ||
    !Array.isArray(backup.databases) ||
    !Array.isArray(backup.files)
  )
    throw new Error('Unsupported browser backup');
  const bytes = JSON.stringify(encodeServiceValue(backup));
  const id = digest(JSON.stringify(encodeServiceValue(backup.databases))).slice(
    7,
  );
  const ledgerRoot = path.join(dataRoot, 'migrations');
  await fs.mkdir(ledgerRoot, { recursive: true });
  return withWorkspaceLock(ledgerRoot, async () => {
    const ledger = path.join(ledgerRoot, id + '.json');
    const writeLedger = async (record: unknown) => {
      const temporary = ledger + '.' + randomUUID() + '.tmp';
      try {
        await fs.writeFile(temporary, JSON.stringify(record), { flag: 'wx' });
        await fs.rename(temporary, ledger);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    };
    const prior = (await fs.readFile(ledger, 'utf8').then(
      (text) => JSON.parse(text),
      (error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      },
    )) as {
      path: string;
      count: number;
      phase: 'prepared' | 'published' | 'complete';
    } | null;
    const canonical = await fs.realpath(parent);
    const target = path.join(canonical, 'browser-import-' + id.slice(0, 12));
    if (prior && prior.path !== target)
      throw new Error('This backup was already imported into ' + prior.path);
    await fs
      .writeFile(
        path.join(
          ledgerRoot,
          id + '.' + digest(bytes).slice(7, 19) + '.backup.json',
        ),
        bytes,
        {
          flag: 'wx',
        },
      )
      .catch((error) => {
        if (error.code !== 'EEXIST') throw error;
      });
    const records = <T>(name: string) =>
      (
        backup.databases
          .find((db) => db.name === 'verdboard-host')
          ?.stores.find((store) => store.name === name)?.records ?? []
      ).map((record) => record.value as T);
    const workspaces = records<Workspace>('workspaces');
    const nodes = records<Node>('files');
    const metas = records<Meta>('meta');
    const trash = records<Trash>('trash');
    if (
      new Set(
        backup.files.map((file) => JSON.stringify([file.workspace, file.path])),
      ).size !== backup.files.length
    )
      throw new Error('Duplicate checksum entry');
    if (
      backup.files.length !==
      nodes.filter((node) => node.kind === 'file').length
    )
      throw new Error('Backup file manifest is incomplete');
    const indexed = new Map(
      backup.files.map((file) => [
        JSON.stringify([file.workspace, file.path]),
        file,
      ]),
    );
    if (new Set(workspaces.map((ws) => ws.key)).size !== workspaces.length)
      throw new Error('Duplicate workspace identity');
    for (const node of nodes) {
      safePath(node.path);
      if (!workspaces.some((ws) => ws.key === node.wsKey))
        throw new Error('Orphaned file: ' + node.path);
      if (node.kind !== 'file' && node.kind !== 'directory')
        throw new Error('Unknown node kind');
      if (node.kind === 'file') {
        const expected = indexed.get(JSON.stringify([node.wsKey, node.path]));
        if (
          !(node.content instanceof Uint8Array) ||
          !expected ||
          expected.size !== node.content.length ||
          expected.digest !== digest(node.content)
        )
          throw new Error('Backup checksum mismatch: ' + node.path);
      }
      validateGitNode(node);
    }
    const staging = path.join(canonical, '.browser-import-' + randomUUID());
    const roots: { name: string; source: Workspace }[] = [];
    const targetExists = await fs.lstat(target).then(
      (entry) => {
        if (!entry.isDirectory() || entry.isSymbolicLink())
          throw new Error('Invalid migration destination');
        return true;
      },
      (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    if (targetExists && !prior)
      throw new Error('Migration destination already exists');
    if (!targetExists) {
      await fs.mkdir(staging);
      try {
        for (const [index, workspace] of workspaces.entries()) {
          const meta = metas.find((item) => item.wsKey === workspace.key);
          if (!meta?.config?.value)
            throw new Error('Missing project metadata: ' + workspace.key);
          const name = `${index + 1}-${String(
            meta.config.value.name || workspace.name || 'workspace',
          )
            .replace(/[^\p{L}\p{N}_.-]/gu, '_')
            .slice(0, 80)}`;
          roots.push({ name, source: workspace });
          const root = path.join(staging, name);
          await fs.mkdir(root);
          const paths = new Set<string>();
          for (const node of nodes
            .filter((item) => item.wsKey === workspace.key)
            .sort((a, b) => a.path.localeCompare(b.path))) {
            if (paths.has(node.path))
              throw new Error('Duplicate file path: ' + node.path);
            paths.add(node.path);
            if (
              !runtime(node.path) &&
              node.path !== '.verdscrolls/config.json' &&
              node.path !== '.verdscrolls/session.json'
            )
              await write(root, node);
          }
          await fs.mkdir(path.join(root, '.verdscrolls'), { recursive: true });
          await fs.writeFile(
            path.join(root, '.verdscrolls/config.json'),
            JSON.stringify(meta.config),
          );
          const session = normalizeWorkspaceSessionState(meta.session);
          if (session)
            await fs.writeFile(
              path.join(root, '.verdscrolls/session.json'),
              JSON.stringify({
                format: 'verd-workspace-session',
                version: 1,
                ...session,
              }),
            );
          for (const entry of trash.filter(
            (item) => item.wsKey === workspace.key,
          )) {
            const entryId = normalizeTrashEntryId(entry.entryId);
            const original = normalizeWorkspacePath(entry.originalPath);
            const entryRoot = path.join(root, '.verdscrolls/trash', entryId);
            await fs.mkdir(entryRoot, { recursive: true });
            await fs.writeFile(
              path.join(entryRoot, 'entry.json'),
              JSON.stringify({
                entryId,
                originalPath: original,
                trashedAt: entry.trashedAt,
              }),
            );
            const parentPath = path.posix.dirname(original);
            for (const [p, node] of Object.entries(entry.nodes)) {
              safePath(p);
              if (p !== original && !p.startsWith(original + '/'))
                throw new Error('Trash subtree escapes its entry');
              await write(
                entryRoot,
                node,
                parentPath === '.' ? p : p.slice(parentPath.length + 1),
              );
            }
          }
          if (paths.has('.git/HEAD')) {
            const env = {
              ...process.env,
              GIT_CONFIG_NOSYSTEM: '1',
              GIT_CONFIG_GLOBAL:
                process.platform === 'win32' ? 'NUL' : '/dev/null',
              GIT_TERMINAL_PROMPT: '0',
            };
            await exec(
              'git',
              [
                '-C',
                root,
                '-c',
                'core.hooksPath=' + path.join(staging, '.empty-hooks'),
                'fsck',
                '--full',
              ],
              { env },
            );
            await exec('git', ['-C', root, 'status', '--porcelain'], { env });
          }
          // Use the existing fs migration and initialization rules on the staged copy.
          const validator = createFsWorkspaceHost({ defaultRoot: () => root });
          const handle = await validator.openWorkspace({
            path: root,
            create: false,
          });
          if (!handle)
            throw new Error('Migrated workspace could not be opened');
          try {
            await validator.readSnapshot(handle);
          } finally {
            await validator.closeWorkspace(handle);
          }
        }
        const legacyRecords = new Map<string, unknown>();
        for (const db of [...backup.databases].reverse())
          if (['VerdBoard', 'Drawnix'].includes(db.name))
            for (const store of db.stores)
              if (['verdboard_store', 'drawnix_store'].includes(store.name))
                for (const record of store.records)
                  if (typeof record.key === 'string')
                    legacyRecords.set(record.key, record.value);
        if (legacyRecords.size) {
          const snapshot = await migrateLegacyCellWorkspace({
            listKeys: async () => [...legacyRecords.keys()],
            getItem: async (key) => legacyRecords.get(key) ?? null,
            setItem: async (key, value) => {
              legacyRecords.set(key, value);
            },
            removeItem: async (key) => {
              legacyRecords.delete(key);
            },
          });
          const name = 'legacy-workspace';
          const root = path.join(staging, name);
          await fs.mkdir(root);
          for (const file of partitionCellStore(snapshot.store).files)
            await fs.writeFile(
              path.join(
                root,
                file.frame.id.replace(/[^\w.-]/g, '_') + '.verd.json',
              ),
              JSON.stringify(file),
            );
          roots.push({
            name,
            source: { key: 'legacy', name: '旧浏览器工作区' },
          });
        }
        if (!roots.length) throw new Error('Backup contains no workspaces');
        await fs.writeFile(
          path.join(staging, '.migration.json'),
          JSON.stringify({ id, roots }),
        );
        await writeLedger({
          path: target,
          count: roots.length,
          phase: 'prepared',
        });
        await fs.rename(staging, target);
        await writeLedger({
          path: target,
          count: roots.length,
          phase: 'published',
        });
      } finally {
        await fs.rm(staging, { recursive: true, force: true });
      }
    }
    const manifest = JSON.parse(
      await fs.readFile(path.join(target, '.migration.json'), 'utf8'),
    ) as { id: string; roots: typeof roots };
    if (manifest.id !== id) throw new Error('Migration identity mismatch');
    if (prior?.phase === 'complete')
      return { path: target, count: manifest.roots.length };
    for (const entry of manifest.roots) {
      if (!entry.source.hidden)
        await manager.rememberBackup(path.join(target, entry.name), {
          name: entry.source.name,
          pinned: entry.source.pinned,
          lastOpenedAt: entry.source.lastOpenedAt,
        });
    }
    const global = backup.databases
      .find((db) => db.name === 'verdboard-host')
      ?.stores.find((store) => store.name === 'global')
      ?.records.find((record) => record.key === 'config')?.value as
      { value?: Record<string, unknown> } | undefined;
    if (global?.value)
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = await host.readGlobalConfig();
        const value = { ...current.value };
        const privateKeys = new Set([
          'desktopWorkspace',
          'desktopWorkspaceHistory',
          'desktopLegacyHistoryImported',
        ]);
        const fillMissing = (
          source: unknown,
          destination: unknown,
        ): unknown => {
          if (destination === undefined) return source;
          if (
            !source ||
            !destination ||
            typeof source !== 'object' ||
            typeof destination !== 'object' ||
            Array.isArray(source) ||
            Array.isArray(destination)
          )
            return destination;
          const result: Record<string, unknown> = { ...destination };
          for (const [key, item] of Object.entries(source))
            result[key] = fillMissing(item, result[key]);
          return result;
        };
        for (const [key, item] of Object.entries(global.value))
          if (!privateKeys.has(key)) value[key] = fillMissing(item, value[key]);
        if ((await host.writeGlobalConfig(value, current.version)).applied)
          break;
        if (attempt === 4)
          throw new Error('Could not merge migrated preferences');
      }
    await writeLedger({
      path: target,
      count: manifest.roots.length,
      phase: 'complete',
    });
    return { path: target, count: manifest.roots.length };
  });
}
