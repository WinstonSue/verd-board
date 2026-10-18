import { isFrameFileV2 } from '../frames/frame-files';
import { isDocumentFileV1 } from '../documents/document-files';
import {
  baseName,
  conflictCommit,
  isCanvasPath,
  isDocumentPath,
  normalizeWorkspacePath,
  normalizeTrashEntryId,
  parentWorkspacePath,
  type ChangeHint,
  type CommitReceipt,
  type CommitRequest,
  type ConflictResolution,
  type FileVersion,
  type GlobalConfigSnapshot,
  type OpenWorkspaceRequest,
  type RawFileRead,
  type WorkspaceEntryMeta,
  type WorkspaceHandle,
  type WorkspaceHost,
  type WorkspaceSessionState,
  type WorkspaceHostSnapshot,
} from './workspace-host';

/** Deterministic content digest shared by non-crypto hosts. */
export const digestBytes = (content: Uint8Array): FileVersion => {
  let hash = 0x811c9dc5;
  for (const byte of content) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, '0')}`;
};

const encode = (content: Uint8Array | string): Uint8Array =>
  typeof content === 'string' ? new TextEncoder().encode(content) : content;

const decode = (content: Uint8Array): string =>
  new TextDecoder().decode(content);

type MemoryNode =
  | { kind: 'file'; content: Uint8Array; version: FileVersion }
  | { kind: 'directory' };

interface MemoryTrashEntry {
  entryId: string;
  originalPath: string;
  trashedAt: number;
  /** Captured subtree keyed by workspace-relative paths. */
  nodes: Record<string, MemoryNode>;
}

interface MemoryWorkspace {
  key: string;
  name: string;
  nodes: Map<string, MemoryNode>;
  trash: Map<string, MemoryTrashEntry>;
  config: { version: number; value: Record<string, unknown> };
  session: WorkspaceSessionState | null;
  receipts: Map<string, CommitReceipt>;
  listeners: Set<(hint: ChangeHint) => void>;
}

export interface MemoryHostOptions {
  pickWorkspace?: () => Promise<string | null>;
  now?: () => number;
}

const cloneNodes = (nodes: Map<string, MemoryNode>): Map<string, MemoryNode> =>
  new Map(
    [...nodes].map(([path, node]) => [
      path,
      node.kind === 'file'
        ? { ...node, content: node.content.slice() }
        : { ...node },
    ]),
  );

const reject = (
  transactionId: string,
  reason: CommitReceipt['reason'],
  extra: Partial<CommitReceipt> = {},
): CommitReceipt => ({ transactionId, outcome: 'rejected', reason, ...extra });

/**
 * In-memory WorkspaceHost used by contract tests and application-layer tests.
 * Commits apply on a cloned tree so a rejection leaves no half-published state.
 */
export const createMemoryWorkspaceHost = (
  options: MemoryHostOptions = {},
): WorkspaceHost & { workspaces: Map<string, MemoryWorkspace> } => {
  const workspaces = new Map<string, MemoryWorkspace>();
  let globalConfig: GlobalConfigSnapshot = { version: 0, value: {} };
  const now = options.now ?? Date.now;

  const materialize = (nodes: Map<string, MemoryNode>, path: string) => {
    let parent = parentWorkspacePath(path);
    const chain: string[] = [];
    while (parent) {
      chain.unshift(parent);
      parent = parentWorkspacePath(parent);
    }
    chain.forEach((dir) => {
      if (!nodes.has(dir)) nodes.set(dir, { kind: 'directory' });
    });
  };

  const createWorkspace = (key: string, name: string): MemoryWorkspace => {
    const workspace: MemoryWorkspace = {
      key,
      name,
      nodes: new Map(),
      trash: new Map(),
      config: {
        version: 1,
        value: { identity: globalThis.crypto?.randomUUID?.() ?? key },
      },
      session: null,
      receipts: new Map(),
      listeners: new Set(),
    };
    workspaces.set(key, workspace);
    return workspace;
  };

  const workspaceOf = (handle: WorkspaceHandle): MemoryWorkspace => {
    const workspace = workspaces.get(handle.key);
    if (!workspace) throw new Error(`Unknown workspace: ${handle.key}`);
    return workspace;
  };

  const readFileInner = (
    handle: WorkspaceHandle,
    path: string,
  ): RawFileRead => {
    const workspace = workspaceOf(handle);
    const normalized = normalizeWorkspacePath(path);
    const node = workspace.nodes.get(normalized);
    if (!node || node.kind !== 'file')
      throw new Error(`Missing file: ${normalized}`);
    return {
      path: normalized,
      version: node.version,
      content: node.content.slice(),
    };
  };

  let trashSequence = 0;
  const applyCommit = (
    workspace: MemoryWorkspace,
    request: CommitRequest,
  ): CommitReceipt => {
    const existing = workspace.receipts.get(request.transactionId);
    if (existing) return existing;
    const nodes = cloneNodes(workspace.nodes);
    const trash = new Map(
      [...workspace.trash].map(([id, entry]) => [
        id,
        { ...entry, nodes: { ...entry.nodes } },
      ]),
    );
    let config = workspace.config;
    let session = workspace.session;
    const versions: Record<string, FileVersion> = {};
    const trashEntries: { path: string; entryId: string }[] = [];
    const fail = (receipt: CommitReceipt): CommitReceipt => {
      workspace.receipts.set(request.transactionId, receipt);
      return receipt;
    };
    try {
      for (const dir of request.mkdirs ?? []) {
        const path = normalizeWorkspacePath(dir);
        if (nodes.has(path))
          return fail(reject(request.transactionId, 'target-exists', { path }));
        materialize(nodes, path);
        nodes.set(path, { kind: 'directory' });
      }
      for (const op of request.trash ?? []) {
        const path = normalizeWorkspacePath(op.path);
        const node = nodes.get(path);
        if (!node)
          return fail(
            reject(request.transactionId, 'version-conflict', {
              path,
              expected: op.expectedVersion ?? null,
              actual: null,
            }),
          );
        if (node.kind === 'file' && node.version !== op.expectedVersion)
          return fail(
            reject(request.transactionId, 'version-conflict', {
              path,
              expected: op.expectedVersion ?? null,
              actual: node.version,
            }),
          );
        if (node.kind === 'directory' && op.expectedVersion !== undefined)
          return fail(reject(request.transactionId, 'invalid', { path }));
        const entryId = `trash-${now().toString(36)}-${++trashSequence}`;
        const removed: Record<string, MemoryNode> = { [path]: node };
        nodes.delete(path);
        [...nodes.keys()]
          .filter((key) => key.startsWith(`${path}/`))
          .forEach((key) => {
            removed[key] = nodes.get(key)!;
            nodes.delete(key);
          });
        trash.set(entryId, {
          entryId,
          originalPath: path,
          trashedAt: now(),
          nodes: removed,
        });
        trashEntries.push({ path, entryId });
      }
      for (const op of request.restore ?? []) {
        const entry = trash.get(normalizeTrashEntryId(op.entryId));
        if (!entry)
          return fail(
            reject(request.transactionId, 'source-missing', {
              path: op.entryId,
            }),
          );
        const to = normalizeWorkspacePath(op.toPath ?? entry.originalPath);
        const prefix = entry.originalPath;
        const targets = Object.entries(entry.nodes).map(
          ([path, node]) =>
            [to + path.slice(prefix.length), node] as [string, MemoryNode],
        );
        const occupied = targets.find(([path]) => nodes.has(path));
        if (occupied)
          return fail(
            reject(request.transactionId, 'target-exists', {
              path: occupied[0],
            }),
          );
        targets.forEach(([path, node]) => {
          materialize(nodes, path);
          nodes.set(path, node);
          if (node.kind === 'file') versions[path] = node.version;
        });
        trash.delete(op.entryId);
      }
      for (const op of request.moves ?? []) {
        const from = normalizeWorkspacePath(op.from);
        const to = normalizeWorkspacePath(op.to);
        const node = nodes.get(from);
        if (!node)
          return fail(
            reject(request.transactionId, 'source-missing', { path: from }),
          );
        if (
          node.kind === 'file' &&
          (op.expectedVersion === undefined ||
            node.version !== op.expectedVersion)
        )
          return fail(
            reject(request.transactionId, 'version-conflict', {
              path: from,
              expected: op.expectedVersion,
              actual: node.version,
            }),
          );
        if (nodes.has(to))
          return fail(
            reject(request.transactionId, 'target-exists', { path: to }),
          );
        if (to === from || to.startsWith(`${from}/`))
          return fail(reject(request.transactionId, 'invalid', { path: to }));
        const moved = [[from, node] as [string, MemoryNode]].concat(
          [...nodes.entries()].filter(([key]) => key.startsWith(`${from}/`)),
        );
        moved.forEach(([key]) => nodes.delete(key));
        moved.forEach(([key, value]) => {
          const target = to + key.slice(from.length);
          materialize(nodes, target);
          nodes.set(target, value);
          if (value.kind === 'file') versions[target] = value.version;
        });
      }
      for (const op of request.writes ?? []) {
        const path = normalizeWorkspacePath(op.path);
        const node = nodes.get(path);
        if (op.expectedVersion === null) {
          if (node !== undefined)
            return fail(
              reject(request.transactionId, 'target-exists', {
                path,
                expected: null,
                actual: node.kind === 'file' ? node.version : 'directory',
              }),
            );
        } else if (
          !node ||
          node.kind !== 'file' ||
          node.version !== op.expectedVersion
        ) {
          return fail(
            reject(request.transactionId, 'version-conflict', {
              path,
              expected: op.expectedVersion,
              actual: node?.kind === 'file' ? node.version : null,
            }),
          );
        }
        const content = encode(op.content);
        const version = digestBytes(content);
        materialize(nodes, path);
        nodes.set(path, { kind: 'file', content, version });
        versions[path] = version;
      }
      for (const entryId of request.purge ?? [])
        trash.delete(normalizeTrashEntryId(entryId));
      if (request.config) {
        if (request.config.expectedVersion !== config.version)
          return fail(
            reject(request.transactionId, 'version-conflict', {
              expected: String(request.config.expectedVersion),
              actual: String(config.version),
            }),
          );
        config = {
          version: config.version + 1,
          value: request.config.value,
        };
      }
      if (request.session) session = request.session;
    } catch (error) {
      return fail(
        reject(request.transactionId, 'invalid', {
          path: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    const receipt: CommitReceipt = {
      transactionId: request.transactionId,
      outcome: 'applied',
      versions,
      trashEntries: trashEntries.length ? trashEntries : undefined,
    };
    workspace.nodes = nodes;
    workspace.trash = trash;
    workspace.config = config;
    workspace.session = session;
    workspace.receipts.set(request.transactionId, receipt);
    const touched = Object.keys(versions).concat(
      trashEntries.map((entry) => entry.path),
    );
    if (touched.length || request.purge?.length || request.restore?.length)
      workspace.listeners.forEach((listener) => listener({ paths: touched }));
    return receipt;
  };

  return {
    workspaces,
    async readGlobalConfig() {
      return globalConfig;
    },
    async writeGlobalConfig(value, expectedVersion) {
      if (expectedVersion !== globalConfig.version)
        return { applied: false, snapshot: globalConfig };
      globalConfig = { version: globalConfig.version + 1, value };
      return { applied: true, snapshot: globalConfig };
    },
    async openWorkspace(request: OpenWorkspaceRequest = { default: true }) {
      if (request.pick) {
        const key = (await options.pickWorkspace?.()) ?? null;
        if (key === null) return null;
        const existing = workspaces.get(key);
        return existing
          ? { key, name: existing.name }
          : { key, name: createWorkspace(key, baseName(key)).name };
      }
      const key = request.default
        ? 'default'
        : request.path
          ? normalizeWorkspacePath(request.path)
          : 'default';
      const existing = workspaces.get(key);
      if (existing) return { key, name: existing.name };
      if (request.create === false) return null;
      const workspace = createWorkspace(key, request.name ?? baseName(key));
      return { key, name: workspace.name };
    },
    async readSnapshot(handle) {
      const workspace = workspaceOf(handle);
      const entries: WorkspaceEntryMeta[] = [...workspace.nodes.entries()]
        .map(([path, node]) => ({
          path,
          kind: node.kind,
          canvas: node.kind === 'file' && isCanvasPath(path),
          document: (node.kind === 'file' && isDocumentPath(path)) || undefined,
          version: node.kind === 'file' ? node.version : undefined,
          size: node.kind === 'file' ? node.content.length : undefined,
        }))
        .sort((a, b) => a.path.localeCompare(b.path));
      const canvases: WorkspaceHostSnapshot['canvases'] = [];
      const documents: WorkspaceHostSnapshot['documents'] = [];
      const diagnostics: WorkspaceHostSnapshot['diagnostics'] = [];
      entries
        .filter((entry) => entry.canvas)
        .forEach((entry) => {
          const node = workspace.nodes.get(entry.path);
          if (!node || node.kind !== 'file') return;
          try {
            const parsed: unknown = JSON.parse(decode(node.content));
            if (!isFrameFileV2(parsed)) {
              canvases.push({
                path: entry.path,
                version: node.version,
                file: null,
                diagnostic: 'Not a v2 frame file',
              });
              diagnostics.push({
                path: entry.path,
                message: 'Not a v2 frame file',
              });
              return;
            }
            canvases.push({
              path: entry.path,
              version: node.version,
              file: parsed,
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            canvases.push({
              path: entry.path,
              version: node.version,
              file: null,
              diagnostic: message,
            });
            diagnostics.push({ path: entry.path, message });
          }
        });
      entries
        .filter((entry) => entry.document)
        .forEach((entry) => {
          const node = workspace.nodes.get(entry.path);
          if (!node || node.kind !== 'file') return;
          try {
            const parsed: unknown = JSON.parse(decode(node.content));
            if (!isDocumentFileV1(parsed)) {
              documents!.push({
                path: entry.path,
                version: node.version,
                file: null,
                diagnostic: 'Not a v1 document file',
              });
              diagnostics.push({
                path: entry.path,
                message: 'Not a v1 document file',
              });
              return;
            }
            documents!.push({
              path: entry.path,
              version: node.version,
              file: parsed,
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            documents!.push({
              path: entry.path,
              version: node.version,
              file: null,
              diagnostic: message,
            });
            diagnostics.push({ path: entry.path, message });
          }
        });
      return {
        config: workspace.config,
        session: workspace.session ? { ...workspace.session } : null,
        entries,
        canvases,
        documents,
        trash: [...workspace.trash.values()].map((entry) => ({
          entryId: entry.entryId,
          originalPath: entry.originalPath,
          trashedAt: entry.trashedAt,
        })),
        diagnostics,
      };
    },
    async readFile(handle, path) {
      return readFileInner(handle, path);
    },
    async commit(handle, request) {
      return applyCommit(workspaceOf(handle), request);
    },
    subscribe(handle, listener) {
      const workspace = workspaceOf(handle);
      workspace.listeners.add(listener);
      return () => workspace.listeners.delete(listener);
    },
    async resolveConflict(handle, request) {
      const workspace = workspaceOf(handle);
      let diskVersion: FileVersion | undefined;
      try {
        diskVersion = readFileInner(handle, request.path).version;
      } catch {
        diskVersion = undefined;
      }
      return applyCommit(workspace, conflictCommit(request, diskVersion));
    },
    async closeWorkspace() {},
    onShutdown() {
      return () => {};
    },
  };
};
