import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  OpenWorkspaceRequest,
  WorkspaceHandle,
  WorkspaceHost,
} from '../../../packages/product/app/src/host/workspace-host';
import { listStorageKeys } from './storage-file';

const selectionKey = 'desktopWorkspace';

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
  development: boolean;
  explicitRoot?: string;
  pickDirectory(): Promise<string | null>;
}) {
  const candidates = new Map<string, { root: string; isDefault: boolean }>();
  const opening = new Map<string, Promise<WorkspaceHandle | null>>();
  let preparing: Promise<void> | undefined;
  return {
    async open(
      request?: OpenWorkspaceRequest,
    ): Promise<WorkspaceHandle | null> {
      let root: string;
      let isDefault = false;
      let create = request?.create !== false;
      if (request?.pick) {
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
      const explicitEnvironment =
        !request?.path &&
        !request?.pick &&
        !request?.default &&
        !!options.explicitRoot;
      if (
        !explicitEnvironment &&
        path.resolve(root) === path.resolve(options.defaultRoot())
      )
        isDefault = true;
      if (isDefault && !options.development) {
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
          name: request?.name,
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
      return { ...handle, isDefault };
    },
    async activate(handle: WorkspaceHandle): Promise<void> {
      const candidate = candidates.get(handle.key);
      if (!candidate) throw new Error('Unknown workspace');
      for (let attempt = 0; attempt < 3; attempt++) {
        const config = await options.host.readGlobalConfig();
        const next = candidate.isDefault
          ? { kind: 'default' }
          : { kind: 'directory', path: candidate.root };
        const result = await options.host.writeGlobalConfig(
          { ...config.value, [selectionKey]: next },
          config.version,
        );
        if (result.applied) return;
      }
      throw new Error('Could not remember the selected workspace');
    },
  };
}
