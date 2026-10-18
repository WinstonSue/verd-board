import { isFrameFileV2 } from '../frames/frame-files';
import { isDocumentFileV1 } from '../documents/document-files';
import { digestBytes } from './memory-workspace-host';
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
  type FileMoveOp,
  type FileVersion,
  type FileWriteOp,
  type GlobalConfigSnapshot,
  type OpenWorkspaceRequest,
  type RawFileRead,
  type RestoreOp,
  type TrashOp,
  type WorkspaceEntryMeta,
  type WorkspaceHandle,
  type WorkspaceHost,
  type WorkspaceSessionState,
  type WorkspaceHostSnapshot,
} from './workspace-host';

const DB_NAME = 'verdboard-host';
const DB_VERSION = 2;
const KEY_SEPARATOR = '';
const NOTIFY_CHANNEL = 'verdboard-host-notify';

type StoredNode =
  | {
      id: string;
      wsKey: string;
      path: string;
      kind: 'file';
      content: ArrayBuffer;
      version: FileVersion;
      size: number;
      updatedAt: number;
    }
  | { id: string; wsKey: string; path: string; kind: 'directory' };

interface StoredTrashEntry {
  wsKey: string;
  entryId: string;
  originalPath: string;
  trashedAt: number;
  nodes: Record<
    string,
    | { kind: 'file'; content: ArrayBuffer; version: FileVersion }
    | { kind: 'directory' }
  >;
}

interface StoredMeta {
  wsKey: string;
  config: { version: number; value: Record<string, unknown> };
  session: WorkspaceSessionState | null;
}

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB error'));
  });

const done = (txn: IDBTransaction): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    txn.oncomplete = () => resolve();
    txn.onabort = () => reject(txn.error ?? new Error('Transaction aborted'));
    txn.onerror = () => reject(txn.error ?? new Error('Transaction failed'));
  });

const sha256 = async (content: Uint8Array): Promise<FileVersion> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return digestBytes(content);
  const buffer = await subtle.digest(
    'SHA-256',
    content.slice().buffer as ArrayBuffer,
  );
  return `sha256-${[...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
};

const encode = (content: Uint8Array | string): Uint8Array =>
  typeof content === 'string' ? new TextEncoder().encode(content) : content;

// Plain files persist as structured-cloned bytes (ArrayBuffer), which is
// binary-faithful like Blob storage without depending on File API support.
// Structured clones can arrive from another realm, so ArrayBuffer is
// detected by shape (byteLength + slice) rather than instanceof.
const decode = async (
  content: ArrayBuffer | ArrayBufferView | Blob,
): Promise<Uint8Array> => {
  if (ArrayBuffer.isView(content))
    return new Uint8Array(
      content.buffer,
      content.byteOffset,
      content.byteLength,
    );
  const candidate = content as ArrayBuffer;
  if (
    typeof candidate?.byteLength === 'number' &&
    typeof candidate?.slice === 'function'
  )
    return new Uint8Array(candidate);
  if (typeof (content as Blob).arrayBuffer === 'function')
    return new Uint8Array(await (content as Blob).arrayBuffer());
  return new Promise<Uint8Array>((resolve, rejectPromise) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => rejectPromise(reader.error);
    reader.readAsArrayBuffer(content as Blob);
  });
};

const reject = (
  transactionId: string,
  reason: CommitReceipt['reason'],
  extra: Partial<CommitReceipt> = {},
): CommitReceipt => ({ transactionId, outcome: 'rejected', reason, ...extra });

const fileKey = (wsKey: string, path: string) =>
  `${wsKey}${KEY_SEPARATOR}${path}`;
const trashKey = (wsKey: string, entryId: string) =>
  `${wsKey}${KEY_SEPARATOR}${entryId}`;
const receiptKey = (wsKey: string, transactionId: string) =>
  `${wsKey}${KEY_SEPARATOR}${transactionId}`;

export interface WebHostOptions {
  indexedDB?: IDBFactory;
  broadcast?: BroadcastChannel;
  dbName?: string;
  now?: () => number;
}

/**
 * Native IndexedDB workspace host. Encoding, digests and blob conversion run
 * outside the transaction; one readwrite transaction performs version checks,
 * writes, deletes, trash, receipts and meta. `transaction.oncomplete` is the
 * only success signal; any failure aborts the whole batch. Committed receipts
 * make same-id retries idempotent, and a BroadcastChannel notifies other pages.
 */
export const createWebWorkspaceHost = (
  options: WebHostOptions = {},
): WorkspaceHost => {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (!factory) throw new Error('IndexedDB is not available');
  const now = options.now ?? Date.now;
  const dbPromise = new Promise<IDBDatabase>(
    (resolvePromise, rejectPromise) => {
      const open = factory.open(options.dbName ?? DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        const txn = open.transaction!;
        const ensure = (name: string, options?: IDBObjectStoreParameters) =>
          db.objectStoreNames.contains(name)
            ? txn.objectStore(name)
            : db.createObjectStore(name, options);
        ensure('global');
        ensure('workspaces', { keyPath: 'key' });
        ensure('meta', { keyPath: 'wsKey' });
        const files = ensure('files', { keyPath: 'id' });
        if (!files.indexNames.contains('ws')) files.createIndex('ws', 'wsKey');
        const trashStore = ensure('trash', { keyPath: 'id' });
        if (!trashStore.indexNames.contains('ws'))
          trashStore.createIndex('ws', 'wsKey');
        ensure('receipts', { keyPath: 'id' });
      };
      open.onsuccess = () => resolvePromise(open.result);
      open.onerror = () =>
        rejectPromise(open.error ?? new Error('Failed to open IndexedDB'));
    },
  );

  const store = async (
    names: string | string[],
    mode: IDBTransactionMode,
  ): Promise<{ txn: IDBTransaction; stores: IDBObjectStore[] }> => {
    const db = await dbPromise;
    const list = Array.isArray(names) ? names : [names];
    const txn = db.transaction(list, mode);
    return { txn, stores: list.map((name) => txn.objectStore(name)) };
  };

  const channel =
    options.broadcast ??
    (typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel(NOTIFY_CHANNEL)
      : undefined);
  const subscribers = new Map<string, Set<(hint: ChangeHint) => void>>();
  if (channel) {
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { wsKey?: string } | undefined;
      if (data?.wsKey)
        subscribers.get(data.wsKey)?.forEach((listener) => listener({}));
    };
  }
  const notify = (wsKey: string, paths: string[]) => {
    // BroadcastChannel never loops back to the sender, so local
    // subscribers get a direct hint while other pages read the message.
    subscribers.get(wsKey)?.forEach((listener) => listener({ paths }));
    try {
      channel?.postMessage({ wsKey, paths });
    } catch {
      /* notifications are best-effort */
    }
  };

  const getMeta = async (wsKey: string): Promise<StoredMeta> => {
    const { stores } = await store('meta', 'readonly');
    const meta = (await request(stores[0].get(wsKey))) as
      StoredMeta | undefined;
    if (!meta) throw new Error(`Unknown workspace: ${wsKey}`);
    return meta;
  };

  const allFiles = async (wsKey: string): Promise<StoredNode[]> => {
    const { stores } = await store('files', 'readonly');
    return (await request(stores[0].index('ws').getAll(wsKey))) as StoredNode[];
  };

  const applyCommit = async (
    wsKey: string,
    request_: CommitRequest,
  ): Promise<{ receipt: CommitReceipt; touched: string[] }> => {
    // Encode and digest outside the transaction.
    let writes: (FileWriteOp & { bytes: Uint8Array })[];
    let ops: {
      mkdirs: string[];
      trash: TrashOp[];
      restore: RestoreOp[];
      moves: FileMoveOp[];
    };
    const writeVersions = new Map<string, FileVersion>();
    try {
      writes = (request_.writes ?? []).map((op) => ({
        ...op,
        path: normalizeWorkspacePath(op.path),
        bytes: encode(op.content),
      }));
      for (const op of writes)
        writeVersions.set(op.path, await sha256(op.bytes));
      (request_.purge ?? []).forEach(normalizeTrashEntryId);
      ops = {
        mkdirs: (request_.mkdirs ?? []).map(normalizeWorkspacePath),
        trash: (request_.trash ?? []).map((op) => ({
          ...op,
          path: normalizeWorkspacePath(op.path),
        })),
        restore: (request_.restore ?? []).map((op) => ({
          ...op,
          entryId: normalizeTrashEntryId(op.entryId),
        })),
        moves: (request_.moves ?? []).map((op) => ({
          ...op,
          from: normalizeWorkspacePath(op.from),
          to: normalizeWorkspacePath(op.to),
        })),
      };
    } catch (error) {
      return {
        receipt: reject(request_.transactionId, 'invalid', {
          path: error instanceof Error ? error.message : String(error),
        }),
        touched: [],
      };
    }
    const { txn, stores } = await store(
      ['files', 'trash', 'receipts', 'meta'],
      'readwrite',
    );
    const [files, trashStore, receipts, metaStore] = stores;
    const completion = done(txn);
    const versions: Record<string, FileVersion> = {};
    const trashEntries: { path: string; entryId: string }[] = [];
    const touched = new Set<string>();
    const get = async (path: string) =>
      (await request(files.get(fileKey(wsKey, path)))) as
        StoredNode | undefined;
    const ensureParents = async (path: string) => {
      const parents: string[] = [];
      let parent = parentWorkspacePath(path);
      while (parent) {
        parents.unshift(parent);
        parent = parentWorkspacePath(parent);
      }
      for (const ancestor of parents) {
        if (!(await get(ancestor)))
          await request(
            files.put({
              id: fileKey(wsKey, ancestor),
              wsKey,
              path: ancestor,
              kind: 'directory',
            } satisfies StoredNode),
          );
      }
    };
    /** Returns a rejection receipt on the first violation, null on success. */
    const run = async (): Promise<CommitReceipt | null> => {
      for (const dir of ops.mkdirs) {
        if (await get(dir))
          return reject(request_.transactionId, 'target-exists', { path: dir });
        await ensureParents(dir);
        await request(
          files.put({
            id: fileKey(wsKey, dir),
            wsKey,
            path: dir,
            kind: 'directory',
          } satisfies StoredNode),
        );
        touched.add(dir);
      }
      for (const op of ops.trash) {
        const node = await get(op.path);
        if (node?.kind === 'directory' && op.expectedVersion !== undefined)
          return reject(request_.transactionId, 'invalid', { path: op.path });
        if (
          !node ||
          (node.kind === 'file' && node.version !== op.expectedVersion)
        )
          return reject(request_.transactionId, 'version-conflict', {
            path: op.path,
            expected: op.expectedVersion ?? null,
            actual: node?.kind === 'file' ? node.version : null,
          });
        const prefix = `${op.path}/`;
        const subtree = (await allFilesIn(files, wsKey)).filter(
          (stored) => stored.path === op.path || stored.path.startsWith(prefix),
        );
        const removed: StoredTrashEntry['nodes'] = {};
        for (const stored of subtree) {
          removed[stored.path] =
            stored.kind === 'file'
              ? {
                  kind: 'file',
                  content: stored.content,
                  version: stored.version,
                }
              : { kind: 'directory' };
          await request(files.delete(fileKey(wsKey, stored.path)));
        }
        const entryId = `trash-${now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        await request(
          trashStore.put({
            id: trashKey(wsKey, entryId),
            wsKey,
            entryId,
            originalPath: op.path,
            trashedAt: now(),
            nodes: removed,
          } satisfies StoredTrashEntry & { id: string }),
        );
        trashEntries.push({ path: op.path, entryId });
        touched.add(op.path);
      }
      for (const op of ops.restore) {
        const entry = (await request(
          trashStore.get(trashKey(wsKey, op.entryId)),
        )) as (StoredTrashEntry & { id: string }) | undefined;
        if (!entry)
          return reject(request_.transactionId, 'source-missing', {
            path: op.entryId,
          });
        const to = normalizeWorkspacePath(op.toPath ?? entry.originalPath);
        const prefix = entry.originalPath;
        const targets = Object.entries(entry.nodes).map(
          ([path, node]) => [to + path.slice(prefix.length), node] as const,
        );
        for (const [path] of targets) {
          if (await get(path))
            return reject(request_.transactionId, 'target-exists', { path });
        }
        for (const [path, node] of targets) {
          await ensureParents(path);
          await request(
            files.put(
              node.kind === 'file'
                ? {
                    id: fileKey(wsKey, path),
                    wsKey,
                    path,
                    kind: 'file',
                    content: node.content,
                    version: node.version,
                    size: node.content.byteLength,
                    updatedAt: now(),
                  }
                : {
                    id: fileKey(wsKey, path),
                    wsKey,
                    path,
                    kind: 'directory',
                  },
            ),
          );
          if (node.kind === 'file') versions[path] = node.version;
          touched.add(path);
        }
        await request(trashStore.delete(trashKey(wsKey, op.entryId)));
      }
      for (const entryId of request_.purge ?? []) {
        await request(trashStore.delete(trashKey(wsKey, entryId)));
        touched.add(`.verdboard/trash/${entryId}`);
      }
      for (const op of ops.moves) {
        const node = await get(op.from);
        if (!node)
          return reject(request_.transactionId, 'source-missing', {
            path: op.from,
          });
        if (
          node.kind === 'file' &&
          (op.expectedVersion === undefined ||
            node.version !== op.expectedVersion)
        )
          return reject(request_.transactionId, 'version-conflict', {
            path: op.from,
            expected: op.expectedVersion ?? null,
            actual: node.version,
          });
        if (await get(op.to))
          return reject(request_.transactionId, 'target-exists', {
            path: op.to,
          });
        if (op.to === op.from || op.to.startsWith(`${op.from}/`))
          return reject(request_.transactionId, 'invalid', { path: op.to });
        const subtree = (await allFilesIn(files, wsKey)).filter(
          (stored) =>
            stored.path === op.from || stored.path.startsWith(`${op.from}/`),
        );
        for (const stored of subtree)
          await request(files.delete(fileKey(wsKey, stored.path)));
        for (const stored of subtree) {
          const target = op.to + stored.path.slice(op.from.length);
          await ensureParents(target);
          await request(
            files.put({ ...stored, id: fileKey(wsKey, target), path: target }),
          );
          if (stored.kind === 'file') versions[target] = stored.version;
          touched.add(target);
        }
        touched.add(op.from);
      }
      for (const op of writes) {
        const node = await get(op.path);
        if (op.expectedVersion === null) {
          if (node !== undefined)
            return reject(request_.transactionId, 'target-exists', {
              path: op.path,
              expected: null,
              actual: node.kind === 'file' ? node.version : 'directory',
            });
        } else if (
          !node ||
          node.kind !== 'file' ||
          node.version !== op.expectedVersion
        ) {
          return reject(request_.transactionId, 'version-conflict', {
            path: op.path,
            expected: op.expectedVersion,
            actual: node?.kind === 'file' ? node.version : null,
          });
        }
        await ensureParents(op.path);
        const bytes = op.bytes;
        await request(
          files.put({
            id: fileKey(wsKey, op.path),
            wsKey,
            path: op.path,
            kind: 'file',
            content: bytes.slice().buffer as ArrayBuffer,
            version: writeVersions.get(op.path)!,
            size: bytes.length,
            updatedAt: now(),
          }),
        );
        versions[op.path] = writeVersions.get(op.path)!;
        touched.add(op.path);
      }
      if (request_.config) {
        const meta = (await request(metaStore.get(wsKey))) as
          StoredMeta | undefined;
        if (!meta || meta.config.version !== request_.config.expectedVersion)
          return reject(request_.transactionId, 'version-conflict', {
            expected: String(request_.config.expectedVersion),
            actual: meta ? String(meta.config.version) : null,
          });
        await request(
          metaStore.put({
            ...meta,
            config: {
              version: meta.config.version + 1,
              value: request_.config.value,
            },
          } satisfies StoredMeta),
        );
      }
      if (request_.session) {
        const meta = (await request(metaStore.get(wsKey))) as
          StoredMeta | undefined;
        if (meta)
          await request(
            metaStore.put({
              ...meta,
              session: request_.session,
            } satisfies StoredMeta),
          );
      }
      return null;
    };
    try {
      const recorded = (await request(
        receipts.get(receiptKey(wsKey, request_.transactionId)),
      )) as (CommitReceipt & { id: string }) | undefined;
      if (recorded) {
        await completion;
        const { id: _id, ...receipt } = recorded;
        return { receipt, touched: [] };
      }
      const violation = await run();
      if (violation) {
        // Rejections roll the whole batch back; the receipt persists alone
        // in a follow-up transaction so retries replay the same result.
        try {
          txn.abort();
        } catch {
          /* already finished */
        }
        await completion.catch(() => undefined);
        const receiptTxn = await store('receipts', 'readwrite');
        const receiptDone = done(receiptTxn.txn);
        await request(
          receiptTxn.stores[0].put({
            ...(violation as object),
            id: receiptKey(wsKey, request_.transactionId),
          }),
        );
        await receiptDone;
        return { receipt: violation, touched: [] };
      }
      const receipt: CommitReceipt = {
        transactionId: request_.transactionId,
        outcome: 'applied',
        versions,
        trashEntries: trashEntries.length ? trashEntries : undefined,
      };
      await request(
        receipts.put({
          ...(receipt as object),
          id: receiptKey(wsKey, request_.transactionId),
        }),
      );
      await completion;
      return { receipt, touched: [...touched] };
    } catch (error) {
      try {
        txn.abort();
      } catch {
        /* already finished */
      }
      await completion.catch(() => undefined);
      return {
        receipt: reject(request_.transactionId, 'io-error', {
          path: error instanceof Error ? error.message : String(error),
        }),
        touched: [],
      };
    }
  };

  const allFilesIn = async (
    files: IDBObjectStore,
    wsKey: string,
  ): Promise<StoredNode[]> =>
    (await request(files.index('ws').getAll(wsKey))) as StoredNode[];

  const workspaceOf = (handle: WorkspaceHandle) => handle.key;

  const readFileInner = async (
    handle: WorkspaceHandle,
    path: string,
  ): Promise<RawFileRead> => {
    const normalized = normalizeWorkspacePath(path);
    const { stores } = await store('files', 'readonly');
    const node = (await request(
      stores[0].get(fileKey(workspaceOf(handle), normalized)),
    )) as StoredNode | undefined;
    if (!node || node.kind !== 'file')
      throw new Error(`Missing file: ${normalized}`);
    return {
      path: normalized,
      version: node.version,
      content: await decode(node.content),
    };
  };

  return {
    async readGlobalConfig() {
      const { stores } = await store('global', 'readonly');
      const snapshot = (await request(stores[0].get('config'))) as
        GlobalConfigSnapshot | undefined;
      return snapshot ?? { version: 0, value: {} };
    },
    async writeGlobalConfig(value, expectedVersion) {
      const { txn, stores } = await store('global', 'readwrite');
      const completion = done(txn);
      const current = ((await request(stores[0].get('config'))) as
        GlobalConfigSnapshot | undefined) ?? { version: 0, value: {} };
      if (current.version !== expectedVersion) {
        await completion;
        return { applied: false, snapshot: current };
      }
      const next = { version: current.version + 1, value };
      await request(stores[0].put(next, 'config'));
      await completion;
      return { applied: true, snapshot: next };
    },
    async openWorkspace(request_: OpenWorkspaceRequest = { default: true }) {
      const key = request_.default
        ? 'default'
        : request_.path
          ? normalizeWorkspacePath(request_.path)
          : 'default';
      const { txn, stores } = await store(['workspaces', 'meta'], 'readwrite');
      const completion = done(txn);
      const existing = (await request(stores[0].get(key))) as
        { key: string; name: string } | undefined;
      if (existing) {
        await completion;
        return { key, name: existing.name };
      }
      if (request_.create === false || request_.pick) {
        await completion;
        return null;
      }
      const name = request_.name ?? baseName(key);
      await request(stores[0].put({ key, name, createdAt: now() }));
      await request(
        stores[1].put({
          wsKey: key,
          config: {
            version: 1,
            value: { identity: globalThis.crypto.randomUUID() },
          },
          session: null,
        } satisfies StoredMeta),
      );
      await completion;
      return { key, name };
    },
    async readSnapshot(handle) {
      const wsKey = workspaceOf(handle);
      const trashList = async () => {
        const { stores } = await store('trash', 'readonly');
        return (await request(
          stores[0].index('ws').getAll(wsKey),
        )) as (StoredTrashEntry & {
          id: string;
        })[];
      };
      const [meta, stored, trashed] = await Promise.all([
        getMeta(wsKey),
        allFiles(wsKey),
        trashList(),
      ]);
      const entries: WorkspaceEntryMeta[] = stored
        .map((node) => ({
          path: node.path,
          kind: node.kind,
          canvas: node.kind === 'file' && isCanvasPath(node.path),
          document:
            (node.kind === 'file' && isDocumentPath(node.path)) || undefined,
          version: node.kind === 'file' ? node.version : undefined,
          size: node.kind === 'file' ? node.size : undefined,
        }))
        .sort((a, b) => a.path.localeCompare(b.path));
      const canvases: WorkspaceHostSnapshot['canvases'] = [];
      const documents: WorkspaceHostSnapshot['documents'] = [];
      const diagnostics: WorkspaceHostSnapshot['diagnostics'] = [];
      for (const node of stored) {
        if (node.kind !== 'file' || !isCanvasPath(node.path)) continue;
        try {
          const parsed: unknown = JSON.parse(
            new TextDecoder().decode(await decode(node.content)),
          );
          if (!isFrameFileV2(parsed)) {
            canvases.push({
              path: node.path,
              version: node.version,
              file: null,
              diagnostic: 'Not a v2 frame file',
            });
            diagnostics.push({
              path: node.path,
              message: 'Not a v2 frame file',
            });
            continue;
          }
          canvases.push({
            path: node.path,
            version: node.version,
            file: parsed,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          canvases.push({
            path: node.path,
            version: node.version,
            file: null,
            diagnostic: message,
          });
          diagnostics.push({ path: node.path, message });
        }
      }
      for (const node of stored) {
        if (node.kind !== 'file' || !isDocumentPath(node.path)) continue;
        try {
          const parsed: unknown = JSON.parse(
            new TextDecoder().decode(await decode(node.content)),
          );
          if (!isDocumentFileV1(parsed)) {
            documents!.push({
              path: node.path,
              version: node.version,
              file: null,
              diagnostic: 'Not a v1 document file',
            });
            diagnostics.push({
              path: node.path,
              message: 'Not a v1 document file',
            });
            continue;
          }
          documents!.push({
            path: node.path,
            version: node.version,
            file: parsed,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          documents!.push({
            path: node.path,
            version: node.version,
            file: null,
            diagnostic: message,
          });
          diagnostics.push({ path: node.path, message });
        }
      }
      return {
        config: meta.config,
        session: meta.session,
        entries,
        canvases,
        documents,
        trash: trashed.map((entry) => ({
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
    async commit(handle, request_) {
      const { receipt, touched } = await applyCommit(
        workspaceOf(handle),
        request_,
      );
      if (receipt.outcome === 'applied') notify(workspaceOf(handle), touched);
      return receipt;
    },
    subscribe(handle, listener) {
      const set =
        subscribers.get(workspaceOf(handle)) ??
        new Set<(hint: ChangeHint) => void>();
      set.add(listener);
      subscribers.set(workspaceOf(handle), set);
      return () => {
        set.delete(listener);
      };
    },
    async resolveConflict(handle, request_) {
      let diskVersion: FileVersion | undefined;
      try {
        diskVersion = (await readFileInner(handle, request_.path)).version;
      } catch {
        diskVersion = undefined;
      }
      const { receipt, touched } = await applyCommit(
        workspaceOf(handle),
        conflictCommit(request_, diskVersion),
      );
      if (receipt.outcome === 'applied') notify(workspaceOf(handle), touched);
      return receipt;
    },
    async closeWorkspace() {},
    onShutdown() {
      return () => {};
    },
  };
};
