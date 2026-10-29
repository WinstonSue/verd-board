import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import type {
  OpenWorkspaceRequest,
  WorkspaceHandle,
  WorkspaceHost,
  WorkspaceHistoryEntry,
} from '../../../packages/product/app/src/host/workspace-host';
import { listStorageKeys } from './storage-file';

const selectionKey = 'desktopWorkspace';
const historyKey = 'desktopWorkspaceHistory';

interface StoredWorkspaceHistory extends WorkspaceHistoryEntry {
  path: string;
}

const historyIdFor = (root: string) =>
  createHash('sha256').update(root).digest('hex');

async function hasWorkspaceState(target: string): Promise<boolean> {
  try {
    // Runtime metadata also preserves a deliberately emptied workspace.
    return (await fs.readdir(target)).length > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function validateBuiltinFiles(root: string): Promise<void> {
  const identities = new Set<string>();
  const frames = new Set<string>();
  const references: string[] = [];
  const addIdentity = (id: unknown, file: string) => {
    if (typeof id !== 'string' || !id || identities.has(id))
      throw new Error(`Invalid or duplicate built-in identity: ${file}`);
    identities.add(id);
    return id;
  };
  const visit = async (dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
        continue;
      }
      const value = JSON.parse(await fs.readFile(file, 'utf8'));
      if (entry.name.endsWith('.verd-doc.json')) {
        const id = addIdentity(value.id, file);
        if (
          value.format !== 'verd-document' ||
          value.version !== 1 ||
          typeof value.title !== 'string' ||
          value.text?.id !== id ||
          value.text?.kind !== 'block' ||
          value.text?.schemaVersion !== 1 ||
          value.text?.content?.type !== 'doc'
        )
          throw new Error(`Invalid built-in document: ${file}`);
      } else {
        if (
          value.format !== 'verd-frame' ||
          value.version !== 2 ||
          value.frame?.cellType !== 'frame' ||
          !Array.isArray(value.frame.children) ||
          !Array.isArray(value.frame.groups) ||
          !value.cells ||
          typeof value.cells !== 'object' ||
          Array.isArray(value.cells)
        )
          throw new Error(`Invalid built-in canvas: ${file}`);
        frames.add(addIdentity(value.frame.id, file));
        for (const [key, cell] of Object.entries(value.cells)) {
          const candidate = cell as {
            id?: unknown;
            cellType?: unknown;
            kind?: unknown;
            data?: { targetFrameId?: unknown };
          };
          if (
            addIdentity(candidate.id, file) !== key ||
            candidate.cellType === 'frame'
          )
            throw new Error(`Invalid built-in cell: ${file}`);
          if (candidate.kind === 'frame-reference') {
            if (typeof candidate.data?.targetFrameId !== 'string')
              throw new Error(`Invalid built-in reference: ${file}`);
            references.push(candidate.data.targetFrameId);
          }
        }
      }
    }
  };
  await visit(root);
  if (!frames.has('board-root') || references.some((id) => !frames.has(id)))
    throw new Error(
      'Built-in workspace is missing its entry or a referenced canvas',
    );
}

/** Publishes the complete built-in workspace once; existing workspaces win. */
export async function seedBuiltinWorkspace(
  source: string,
  target: string,
  legacyStorage: string,
): Promise<void> {
  if (await hasWorkspaceState(target)) return;
  // Reading corrupt legacy storage throws and preserves its backup. A template
  // must never make recoverable user data disappear behind seeded files.
  if ((await listStorageKeys(legacyStorage)).length) return;
  await fs.mkdir(path.dirname(target), { recursive: true });
  const staging = await fs.mkdtemp(`${target}.seed-`);
  try {
    await fs.cp(source, staging, {
      recursive: true,
      filter: async (entry) => {
        if (
          path
            .relative(source, entry)
            .split(path.sep)
            .some((part) => part === '.verdboard' || part === '.DS_Store')
        )
          return false;
        const stat = await fs.lstat(entry);
        return (
          stat.isDirectory() ||
          (stat.isFile() && entry.endsWith('.verd.json')) ||
          (stat.isFile() && entry.endsWith('.verd-doc.json'))
        );
      },
    });
    await validateBuiltinFiles(staging);
    if (await hasWorkspaceState(target)) return;
    // rmdir only succeeds for an empty target; racing user content survives.
    try {
      await fs.rmdir(target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOTEMPTY' || code === 'EEXIST') return;
      if (code !== 'ENOENT') throw error;
    }
    await fs.rename(staging, target);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

/** Desktop-only startup policy; filesystem paths stay in the main process. */
export function createDesktopWorkspaceManager(options: {
  host: WorkspaceHost;
  defaultRoot(): string;
  builtinSource(): string;
  legacyStorage(): string;
  /** Former shared development/production data; recover as history, never select. */
  legacyUserDataRoot?: string;
  explicitRoot?: string;
  pickDirectory(): Promise<string | null>;
  now?(): number;
}) {
  const candidates = new Map<string, { root: string; isDefault: boolean }>();
  const opening = new Map<string, Promise<WorkspaceHandle | null>>();
  let preparing: Promise<void> | undefined;
  let recovering: Promise<void> | undefined;
  const readHistory = (value: Record<string, unknown>) => {
    const entries = new Map<string, StoredWorkspaceHistory>();
    const builtin = path.resolve(options.defaultRoot());
    const add = (item: Partial<StoredWorkspaceHistory>) => {
      if (typeof item.path !== 'string' || !path.isAbsolute(item.path)) return;
      const root = path.resolve(item.path);
      if (root === builtin || entries.has(root)) return;
      entries.set(root, {
        id: historyIdFor(root),
        path: root,
        name:
          typeof item.name === 'string' && item.name
            ? item.name
            : path.basename(root),
        lastOpenedAt:
          typeof item.lastOpenedAt === 'number' &&
          Number.isFinite(item.lastOpenedAt)
            ? item.lastOpenedAt
            : 0,
      });
    };
    const stored = value[historyKey];
    if (Array.isArray(stored))
      for (const item of stored)
        if (item && typeof item === 'object') add(item);
    // Old releases already confirmed this selection by activating it. Keep
    // that one recoverable entry even when its directory is now unavailable.
    const selected = value[selectionKey] as
      { kind?: unknown; path?: unknown } | undefined;
    if (selected?.kind === 'directory' && typeof selected.path === 'string')
      add({ path: selected.path });
    return [...entries.values()].sort(
      (a, b) => b.lastOpenedAt - a.lastOpenedAt,
    );
  };
  const recoverLegacyHistory = async () => {
    if (!options.legacyUserDataRoot) return;
    recovering ??= (async () => {
      const marker = 'desktopLegacyHistoryImported';
      if ((await options.host.readGlobalConfig()).value[marker]) return;
      const oldRoot = options.legacyUserDataRoot!;
      let oldConfig: Record<string, unknown> = {};
      try {
        const stored = JSON.parse(
          await fs.readFile(
            path.join(oldRoot, 'verdboard-global-config.json'),
            'utf8',
          ),
        );
        if (stored?.value && typeof stored.value === 'object')
          oldConfig = stored.value;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          console.warn(
            'Could not read old workspace history; original file preserved',
            error,
          );
      }
      const recovered = readHistory(oldConfig);
      const oldDefault = path.join(oldRoot, 'workspaces', 'default');
      if (await hasWorkspaceState(oldDefault))
        recovered.push({
          id: historyIdFor(oldDefault),
          path: oldDefault,
          name: '旧工作区 (desktop)',
          lastOpenedAt: 0,
        });
      for (let attempt = 0; attempt < 3; attempt++) {
        const config = await options.host.readGlobalConfig();
        if (config.value[marker]) return;
        const history = readHistory({
          [historyKey]: [...readHistory(config.value), ...recovered],
        });
        const result = await options.host.writeGlobalConfig(
          { ...config.value, [historyKey]: history, [marker]: true },
          config.version,
        );
        if (result.applied) return;
      }
      throw new Error('Could not recover old workspace history');
    })().catch((error) => {
      recovering = undefined;
      throw error;
    });
    await recovering;
  };
  return {
    async listHistory(): Promise<WorkspaceHistoryEntry[]> {
      await recoverLegacyHistory();
      const entries = readHistory(
        (await options.host.readGlobalConfig()).value,
      );
      return entries.map((entry) => {
        const peers = entries.filter((item) => item.name === entry.name);
        let description: string | undefined;
        if (peers.length > 1) {
          const parents = peers.map((item) =>
            path.dirname(item.path).split(path.sep).filter(Boolean),
          );
          const own = path.dirname(entry.path).split(path.sep).filter(Boolean);
          let depth = 1;
          while (
            depth < own.length &&
            parents.filter(
              (parts) =>
                parts.slice(-depth).join('/') === own.slice(-depth).join('/'),
            ).length > 1
          )
            depth++;
          description = own.slice(-depth).join('/');
        }
        return {
          id: entry.id,
          name: entry.name,
          lastOpenedAt: entry.lastOpenedAt,
          ...(description ? { description } : {}),
        };
      });
    },
    async open(
      request?: OpenWorkspaceRequest,
    ): Promise<WorkspaceHandle | null> {
      await recoverLegacyHistory();
      let root: string;
      let name = request?.name;
      let isDefault = false;
      let create = request?.create !== false;
      if (request?.historyId !== undefined) {
        const entries = readHistory(
          (await options.host.readGlobalConfig()).value,
        );
        const entry = entries.find((item) => item.id === request.historyId);
        if (!entry) throw new Error('Unknown workspace history entry');
        root = entry.path;
        name = entry.name;
        create = false;
      } else if (request?.pick) {
        const picked = await options.pickDirectory();
        if (!picked) return null;
        root = path.resolve(picked);
      } else if (request?.path) {
        root = path.resolve(request.path);
      } else if (!request?.default && options.explicitRoot) {
        root = path.resolve(options.explicitRoot);
      } else if (!request?.default) {
        const config = await options.host.readGlobalConfig();
        const selected = config.value[selectionKey] as
          { kind?: unknown; path?: unknown } | undefined;
        if (
          selected?.kind === 'directory' &&
          typeof selected.path === 'string'
        ) {
          root = selected.path;
          create = false;
        } else {
          root = options.defaultRoot();
          isDefault = true;
        }
      } else {
        root = options.defaultRoot();
        isDefault = true;
      }
      root = path.resolve(root);
      const explicitEnvironment =
        !request?.historyId &&
        !request?.path &&
        !request?.pick &&
        !request?.default &&
        !!options.explicitRoot;
      if (
        !explicitEnvironment &&
        path.resolve(root) === path.resolve(options.defaultRoot())
      )
        isDefault = true;
      if (isDefault) {
        preparing ??= seedBuiltinWorkspace(
          options.builtinSource(),
          root,
          options.legacyStorage(),
        ).finally(() => {
          preparing = undefined;
        });
        await preparing;
      }
      let pending = opening.get(root);
      if (!pending) {
        pending = options.host.openWorkspace({
          path: root,
          create,
          name,
        });
        opening.set(root, pending);
      }
      let handle: WorkspaceHandle | null;
      try {
        handle = await pending;
      } finally {
        if (opening.get(root) === pending) opening.delete(root);
      }
      if (!handle) throw new Error(`Workspace folder is unavailable: ${root}`);
      candidates.set(handle.key, { root, isDefault });
      return {
        ...handle,
        isDefault,
        ...(!isDefault ? { historyId: historyIdFor(root) } : {}),
      };
    },
    async activate(handle: WorkspaceHandle): Promise<void> {
      const candidate = candidates.get(handle.key);
      if (!candidate) throw new Error('Unknown workspace');
      for (let attempt = 0; attempt < 3; attempt++) {
        const config = await options.host.readGlobalConfig();
        const next = candidate.isDefault
          ? { kind: 'default' }
          : { kind: 'directory', path: candidate.root };
        const history = readHistory(config.value);
        if (!candidate.isDefault) {
          const existing = history.find((item) => item.path === candidate.root);
          // A monotonic timestamp keeps repeated activations ordered even
          // when the clock resolution is coarse or the device clock moves.
          const lastOpenedAt = Math.max(
            (options.now ?? Date.now)(),
            (history[0]?.lastOpenedAt ?? 0) + 1,
          );
          if (existing) {
            existing.name = handle.name;
            existing.lastOpenedAt = lastOpenedAt;
          } else
            history.push({
              id: historyIdFor(candidate.root),
              path: candidate.root,
              name: handle.name,
              lastOpenedAt,
            });
          history.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
        }
        const result = await options.host.writeGlobalConfig(
          { ...config.value, [selectionKey]: next, [historyKey]: history },
          config.version,
        );
        if (result.applied) return;
      }
      throw new Error('Could not remember the selected workspace');
    },
  };
}
