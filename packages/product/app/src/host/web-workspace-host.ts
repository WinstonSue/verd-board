import { withGitVersioning } from '../git/version-provider';
import { isWorkspaceContentPath } from '../workspace-skills';
import { type GitWorkspaceData } from '../git/workspace-git-engine';
import { createBrowserGitEngine } from '../git/browser-git-engine';
import { isFolderIdentityPath, readFolderIdentity } from './folder-identity';
import { isFrameFileV2 } from '../frames/frame-files';
import { isDocumentFileV1 } from '../documents/document-files';
import { digestBytes } from './memory-workspace-host';
import {
  baseName,
  isProjectInternalPath,
  normalizeResourceKey,
  resourceStoragePath,
  RESOURCE_DIR,
  LEGACY_RESOURCE_DIR,
  workspaceDisplayName,
  conflictCommit,
  isCanvasPath,
  isDocumentPath,
  normalizeWorkspacePath,
  normalizeTrashEntryId,
  parentWorkspacePath,
  type ChangeHint,
  type CommitReceipt,
  type CommitRequest,
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
  resourceLayoutVersion?: 1;
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
      writes = [
        ...(request_.writes ?? []).map((op) => ({
          ...op,
          path: normalizeWorkspacePath(op.path),
          bytes: encode(op.content),
        })),
        ...(request_.resourceWrites ?? []).map((op) => ({
          ...op,
          path: resourceStoragePath(op.path),
          bytes: encode(op.content),
        })),
      ];
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
    const resourceVersions: Record<string, FileVersion> = {};
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
        touched.add(`.verdscrolls/trash/${entryId}`);
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
        if (
          isFolderIdentityPath(op.path) &&
          (await get(parentWorkspacePath(op.path) ?? ''))?.kind !== 'directory'
        )
          return reject(request_.transactionId, 'source-missing', {
            path: op.path,
          });
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
        if (op.path.startsWith(RESOURCE_DIR + '/'))
          resourceVersions[op.path.slice(RESOURCE_DIR.length + 1)] =
            writeVersions.get(op.path)!;
        else versions[op.path] = writeVersions.get(op.path)!;
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
      if (
        request_.resourceWrites?.length &&
        (await allFilesIn(files, wsKey)).some(
          (node) =>
            node.path === LEGACY_RESOURCE_DIR ||
            node.path.startsWith(LEGACY_RESOURCE_DIR + '/'),
        )
      ) {
        txn.abort();
        await completion.catch(() => {});
        return {
          receipt: reject(request_.transactionId, 'invalid', {
            path: 'Resource migration conflict',
          }),
          touched: [],
        };
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
        resourceVersions,
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

  // Git runs against a disposable overlay; both its metadata and user files are
  // published into this existing database in the same compare-and-swap batch.
  type GitSource = {
    stored: StoredNode[];
    trash: (StoredTrashEntry & { id: string })[];
    meta: StoredMeta;
  };
  const fingerprint = (source: GitSource) =>
    JSON.stringify({
      files: source.stored
        .map((node) =>
          node.kind === 'file'
            ? [node.path, node.version, node.size]
            : [node.path],
        )
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      trash: source.trash
        .map((entry) => [
          entry.entryId,
          entry.originalPath,
          Object.entries(entry.nodes)
            .map(([path, node]) => [
              path,
              node.kind === 'file' ? node.version : 'directory',
            ])
            .sort(),
        ])
        .sort(),
      config: source.meta.config,
    });
  const gitEngines = new Map<
    string,
    ReturnType<typeof createBrowserGitEngine>
  >();
  const gitEngine = (handle: WorkspaceHandle) => {
    const wsKey = workspaceOf(handle);
    let engine = gitEngines.get(wsKey);
    if (engine) return engine;
    engine = createBrowserGitEngine({
      now,
      async load(): Promise<GitWorkspaceData> {
        const { txn, stores } = await store(
          ['files', 'trash', 'meta'],
          'readonly',
        );
        const completion = done(txn);
        const [stored, trash, meta] = await Promise.all([
          allFilesIn(stores[0], wsKey),
          request(stores[1].index('ws').getAll(wsKey)) as Promise<
            (StoredTrashEntry & { id: string })[]
          >,
          request(stores[2].get(wsKey)) as Promise<StoredMeta | undefined>,
        ]);
        await completion;
        if (!meta) throw new Error('Unknown workspace: ' + wsKey);
        const files = new Map<string, Uint8Array>();
        for (const node of stored)
          if (node.kind === 'file')
            files.set(node.path, (await decode(node.content)).slice());
        files.set(
          '.verdscrolls/config.json',
          encode(JSON.stringify(meta.config)),
        );
        const entries: GitWorkspaceData['trash'] = new Map();
        for (const entry of trash) {
          const files = new Map<string, Uint8Array>();
          for (const [path, node] of Object.entries(entry.nodes))
            if (node.kind === 'file')
              files.set(path, (await decode(node.content)).slice());
          entries.set(entry.entryId, { files });
        }
        return {
          files,
          directories: new Set(
            stored
              .filter((node) => node.kind === 'directory')
              .map((node) => node.path),
          ),
          trash: entries,
          source: { stored, trash, meta } satisfies GitSource,
        };
      },
      async publish(before, after) {
        const source = before.source as GitSource;
        const timestamp = now();
        const fileRecords = new Map<string, StoredNode>();
        for (const [path, content] of after.files) {
          if (path === '.verdscrolls/config.json') continue;
          fileRecords.set(path, {
            id: fileKey(wsKey, path),
            wsKey,
            path,
            kind: 'file',
            content: content.slice().buffer as ArrayBuffer,
            size: content.length,
            version: await sha256(content),
            updatedAt: timestamp,
          });
          let parent = parentWorkspacePath(path);
          while (parent) {
            if (!fileRecords.has(parent))
              fileRecords.set(parent, {
                id: fileKey(wsKey, parent),
                wsKey,
                path: parent,
                kind: 'directory',
              });
            parent = parentWorkspacePath(parent);
          }
        }
        const trashRecords = new Map<
          string,
          StoredTrashEntry & { id: string }
        >();
        for (const [id, entry] of after.trash) {
          const old = source.trash.find((item) => item.entryId === id);
          if (!old) throw new Error('Trash changed during Git operation');
          const nodes: StoredTrashEntry['nodes'] = {};
          for (const [path, node] of Object.entries(old.nodes))
            if (node.kind === 'directory') nodes[path] = node;
          for (const [path, content] of entry.files)
            nodes[path] = {
              kind: 'file',
              content: content.slice().buffer as ArrayBuffer,
              version: await sha256(content),
            };
          trashRecords.set(id, { ...old, nodes });
        }
        const configBytes = after.files.get('.verdscrolls/config.json');
        const config = configBytes
          ? (JSON.parse(
              new TextDecoder().decode(configBytes),
            ) as StoredMeta['config'])
          : source.meta.config;
        if (
          typeof config?.version !== 'number' ||
          !config.value ||
          typeof config.value !== 'object'
        )
          throw new Error('Invalid restored workspace configuration');
        const { txn, stores } = await store(
          ['files', 'trash', 'meta'],
          'readwrite',
        );
        const completion = done(txn);
        try {
          const [stored, trash, meta] = await Promise.all([
            allFilesIn(stores[0], wsKey),
            request(stores[1].index('ws').getAll(wsKey)) as Promise<
              (StoredTrashEntry & { id: string })[]
            >,
            request(stores[2].get(wsKey)) as Promise<StoredMeta>,
          ]);
          if (fingerprint({ stored, trash, meta }) !== fingerprint(source))
            throw new Error(
              'Workspace changed while preparing Git operation; retry',
            );
          for (const node of stored)
            if (node.kind === 'file' && !after.files.has(node.path))
              await request(stores[0].delete(node.id));
          for (const node of fileRecords.values())
            await request(stores[0].put(node));
          for (const entry of trash)
            if (!trashRecords.has(entry.entryId))
              await request(stores[1].delete(entry.id));
          for (const entry of trashRecords.values())
            await request(stores[1].put(entry));
          // Keep navigation state from the current transaction; only portable config is versioned.
          await request(stores[2].put({ ...meta, config }));
          await completion;
        } catch (error) {
          try {
            txn.abort();
          } catch {
            /* The transaction may already have aborted. */
          }
          await completion.catch(() => {});
          throw error;
        }
        notify(wsKey, [
          ...new Set([...before.files.keys(), ...after.files.keys()]),
        ]);
      },
    });
    gitEngines.set(wsKey, engine);
    return engine;
  };

  return withGitVersioning({
    storageKind: 'browser',
    capabilities: {
      pickWorkspace: false,
      openBuiltinWorkspace: false,
      openPatternWorkspace: false,
    },
    git: (handle, request) => gitEngine(handle)(request),
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
    async openWorkspace(request_: OpenWorkspaceRequest = {}) {
      if (request_.pick || request_.patterns)
        throw new Error('Workspace operation is not supported by this host');
      let key =
        request_.historyId ??
        (request_.default
          ? 'default'
          : request_.path
            ? normalizeWorkspacePath(request_.path)
            : 'default');
      if (
        !request_.default &&
        !request_.path &&
        !request_.historyId &&
        !request_.pick
      ) {
        const history = await this.listWorkspaceHistory?.();
        if (history?.[0]?.lastOpenedAt) key = history[0].id;
      }
      const { txn, stores } = await store(
        ['workspaces', 'meta', 'files'],
        'readwrite',
      );
      const completion = done(txn);
      const existing = (await request(stores[0].get(key))) as
        { key: string; name: string } | undefined;
      if (existing) {
        const meta = (await request(stores[1].get(key))) as
          StoredMeta | undefined;
        if (meta && !meta.resourceLayoutVersion) {
          const nodes = await allFilesIn(stores[2], key);
          const legacy = nodes.filter(
            (node) =>
              node.path === LEGACY_RESOURCE_DIR ||
              node.path.startsWith(LEGACY_RESOURCE_DIR + '/'),
          );
          const current = nodes.filter(
            (node) =>
              node.path === RESOURCE_DIR ||
              node.path.startsWith(RESOURCE_DIR + '/'),
          );
          const oldHasContent = legacy.some((node) => node.kind === 'file');
          const currentHasContent = current.some(
            (node) => node.kind === 'file',
          );
          if (!oldHasContent || !currentHasContent) {
            for (const node of legacy) await request(stores[2].delete(node.id));
            if (oldHasContent) {
              for (const node of current)
                await request(stores[2].delete(node.id));
              for (const node of legacy) {
                const target =
                  RESOURCE_DIR + node.path.slice(LEGACY_RESOURCE_DIR.length);
                await request(
                  stores[2].put({
                    ...node,
                    id: fileKey(key, target),
                    path: target,
                  }),
                );
              }
            }
            await request(
              stores[1].put({
                ...meta,
                resourceLayoutVersion: 1,
              } satisfies StoredMeta),
            );
          }
        }
        await completion;
        return {
          key,
          name: workspaceDisplayName(meta?.config.value['name'], existing.name),
          historyId: key,
        };
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
            value: {
              identity: globalThis.crypto.randomUUID(),
              ...(request_.name
                ? { name: request_.name, workspaceInitialized: true }
                : {}),
            },
          },
          session: null,
          resourceLayoutVersion: 1,
        } satisfies StoredMeta),
      );
      await completion;
      return { key, name, historyId: key };
    },
    async createWorkspace({ name }) {
      if (!name.trim()) throw new Error('Workspace name is empty');
      return this.openWorkspace({
        path: globalThis.crypto.randomUUID(),
        name: name.trim(),
      });
    },
    async listWorkspaceHistory() {
      const { stores } = await store(['workspaces', 'meta'], 'readonly');
      const metadataRequest = request(stores[1].getAll()) as Promise<
        StoredMeta[]
      >;
      const items = (await request(stores[0].getAll())) as {
        key: string;
        name: string;
        lastOpenedAt?: number;
        pinned?: boolean;
        hidden?: boolean;
      }[];
      const metadata = new Map(
        (await metadataRequest).map((meta) => [meta.wsKey, meta]),
      );
      return items
        .filter((i) => !i.hidden)
        .map((i) => ({
          id: i.key,
          name: workspaceDisplayName(
            metadata.get(i.key)?.config.value['name'],
            i.name,
          ),
          lastOpenedAt: i.lastOpenedAt ?? 0,
          pinned: i.pinned,
          availability: 'available' as const,
        }))
        .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    },
    async activateWorkspace(handle) {
      const { txn, stores } = await store('workspaces', 'readwrite');
      const completion = done(txn);
      const item = (await request(stores[0].get(handle.key))) as
        Record<string, unknown> | undefined;
      if (item)
        await request(
          stores[0].put({ ...item, hidden: false, lastOpenedAt: now() }),
        );
      await completion;
    },
    async updateWorkspaceHistory({ id, pinned, remove }) {
      const { txn, stores } = await store('workspaces', 'readwrite');
      const completion = done(txn);
      const item = (await request(stores[0].get(id))) as
        Record<string, unknown> | undefined;
      if (item)
        await request(
          stores[0].put({
            ...item,
            ...(pinned !== undefined ? { pinned } : {}),
            ...(remove ? { hidden: true } : {}),
          }),
        );
      await completion;
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
      const folderIds = new Map<string, string>();
      for (const node of stored) {
        if (node.kind !== 'file' || !isFolderIdentityPath(node.path)) continue;
        const id = readFolderIdentity(
          new TextDecoder().decode(await decode(node.content)),
        );
        const parent = parentWorkspacePath(node.path);
        if (id && parent) folderIds.set(parent, id);
      }
      const entries: WorkspaceEntryMeta[] = stored
        .filter(
          (node) =>
            !isProjectInternalPath(node.path) &&
            node.path !== '.git' &&
            !node.path.startsWith('.git/') &&
            (node.kind !== 'file' || !isFolderIdentityPath(node.path)),
        )
        .map((node) => ({
          path: node.path,
          kind: node.kind,
          ...(node.kind === 'directory'
            ? { folderId: folderIds.get(node.path) }
            : {}),
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
      if (
        stored.some(
          (node) =>
            node.path === LEGACY_RESOURCE_DIR ||
            node.path.startsWith(LEGACY_RESOURCE_DIR + '/'),
        )
      )
        diagnostics.push({
          path: LEGACY_RESOURCE_DIR,
          message:
            'Resource migration conflict: preserve both directories and close older writers before reopening.',
        });
      for (const node of stored) {
        if (
          node.kind !== 'file' ||
          !isWorkspaceContentPath(node.path, entries) ||
          !isCanvasPath(node.path)
        )
          continue;
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
        if (
          node.kind !== 'file' ||
          !isWorkspaceContentPath(node.path, entries) ||
          !isDocumentPath(node.path)
        )
          continue;
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
        resources: stored.flatMap((node) => {
          if (node.kind !== 'file' || !node.path.startsWith(RESOURCE_DIR + '/'))
            return [];
          const key = node.path.slice(RESOURCE_DIR.length + 1);
          try {
            normalizeResourceKey(key);
          } catch {
            return [];
          }
          return [{ key, version: node.version, size: node.size }];
        }),
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
    async readResource(handle, key) {
      const wsKey = workspaceOf(handle);
      const { stores } = await store('files', 'readonly');
      const node = (await request(
        stores[0].get(fileKey(wsKey, resourceStoragePath(key))),
      )) as StoredNode | undefined;
      if (!node || node.kind !== 'file')
        throw new Error('Missing resource: ' + key);
      return {
        path: normalizeResourceKey(key),
        version: node.version,
        content: await decode(node.content),
      };
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
    async closeWorkspace(handle) {
      gitEngines.get(handle.key)?.dispose();
      gitEngines.delete(handle.key);
    },
    onShutdown() {
      return () => {};
    },
  });
};
