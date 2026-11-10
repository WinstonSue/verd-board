import { encodeServiceValue, type BrowserBackup } from './service-protocol';

const databaseNames = ['verdboard-host', 'VerdBoard', 'Drawnix'];

const read = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const hash = async (bytes: Uint8Array) =>
  'sha256-' +
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        bytes.slice().buffer as ArrayBuffer,
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
async function portable(value: unknown): Promise<unknown> {
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    ).slice();
  if (Array.isArray(value)) return Promise.all(value.map(portable));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([key, item]) => [
          key,
          await portable(item),
        ]),
      ),
    );
  return value;
}

/** Read raw stores without opening the old host, which would migrate them. */
export async function exportBrowserBackup(
  factory: IDBFactory = indexedDB,
): Promise<BrowserBackup> {
  const databases: BrowserBackup['databases'] = [];
  const known = factory.databases
    ? new Set((await factory.databases()).map((db) => db.name))
    : undefined;
  for (const name of databaseNames) {
    if (known && !known.has(name)) continue;
    const db = await new Promise<IDBDatabase | null>((resolve, reject) => {
      const request = factory.open(name);
      request.onupgradeneeded = () => {
        request.transaction!.abort();
      };
      request.onerror = () =>
        request.error?.name === 'AbortError'
          ? resolve(null)
          : reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    if (!db) continue;
    try {
      const names = Array.from(db.objectStoreNames);
      if (!names.length) continue;
      const transaction = db.transaction(names, 'readonly');
      const complete = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
      const stores = await Promise.all(
        names.map(async (name) => {
          const store = transaction.objectStore(name);
          const [keys, values] = await Promise.all([
            read(store.getAllKeys()),
            read(store.getAll()),
          ]);
          return {
            name,
            records: keys.map((key, index) => ({
              key,
              value: values[index] as unknown,
            })),
          };
        }),
      );
      await complete;
      databases.push({
        name,
        stores: (await portable(stores)) as typeof stores,
      });
    } finally {
      db.close();
    }
  }
  const files: BrowserBackup['files'] = [];
  const stored =
    databases
      .find((db) => db.name === 'verdboard-host')
      ?.stores.find((store) => store.name === 'files')?.records ?? [];
  for (const { value } of stored) {
    const node = value as {
      wsKey: string;
      path: string;
      kind: string;
      content: Uint8Array;
    };
    if (node.kind === 'file')
      files.push({
        workspace: node.wsKey,
        path: node.path,
        size: node.content.byteLength,
        digest: await hash(node.content),
      });
  }
  return {
    format: 'verd-browser-backup',
    version: 1,
    createdAt: Date.now(),
    origin: typeof location === 'undefined' ? '' : location.origin,
    databases,
    files,
  };
}

/** Clear only the records already backed up and successfully imported. */
export async function clearMigratedBrowserData(
  backup: BrowserBackup,
  factory: IDBFactory = indexedDB,
): Promise<void> {
  if (
    backup.format !== 'verd-browser-backup' ||
    backup.version !== 1 ||
    backup.databases.some((db) => !databaseNames.includes(db.name)) ||
    new Set(backup.databases.map((db) => db.name)).size !==
      backup.databases.length ||
    (typeof location !== 'undefined' && backup.origin !== location.origin)
  )
    throw new Error('只能清理当前访问地址已迁移的浏览器数据');
  const empty = (db: BrowserBackup['databases'][number]) =>
    db.stores.every((store) => !store.records.length);
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(encodeServiceValue(a)) ===
    JSON.stringify(encodeServiceValue(b));
  const changed = () =>
    new Error('源 IndexedDB 已发生变化，未清理新数据。请重新备份并迁移。');
  const current = await exportBrowserBackup(factory);
  for (const db of current.databases) {
    const expected = backup.databases.find((item) => item.name === db.name);
    if (!empty(db) && !same(db, expected)) throw changed();
  }
  for (const expected of backup.databases) {
    if (
      !current.databases.some((db) => db.name === expected.name && !empty(db))
    )
      continue;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(expected.name);
      request.onupgradeneeded = () => request.transaction!.abort();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = Array.from(db.objectStoreNames);
      if (!names.length) continue;
      const transaction = db.transaction(names, 'readwrite');
      const complete = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('清理已取消'));
        transaction.onerror = () => reject(transaction.error);
      });
      void complete.catch(() => {});
      // Blob conversion is asynchronous. Keep this exclusive transaction alive
      // until comparison and clearing have both been queued.
      let comparing = true;
      const keepAlive = () => {
        if (!comparing) return;
        transaction.objectStore(names[0]).count().onsuccess = keepAlive;
      };
      keepAlive();
      try {
        const stores = await Promise.all(
          names.map(async (name) => {
            const store = transaction.objectStore(name);
            const [keys, values] = await Promise.all([
              read(store.getAllKeys()),
              read(store.getAll()),
            ]);
            return {
              name,
              records: keys.map((key, index) => ({
                key,
                value: values[index] as unknown,
              })),
            };
          }),
        );
        const snapshot = {
          name: db.name,
          stores: await portable(stores),
        } as BrowserBackup['databases'][number];
        if (!empty(snapshot) && !same(snapshot, expected)) throw changed();
        for (const name of names) transaction.objectStore(name).clear();
        comparing = false;
        await complete;
      } catch (error) {
        comparing = false;
        try {
          transaction.abort();
        } catch {
          /* Already finished. */
        }
        await complete.catch(() => {});
        throw error;
      }
    } finally {
      db.close();
    }
  }
}
