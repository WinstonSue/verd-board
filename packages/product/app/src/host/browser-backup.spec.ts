// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  clearMigratedBrowserData,
  exportBrowserBackup,
} from './browser-backup';

async function put(
  factory: IDBFactory,
  name: string,
  key: string,
  value: unknown,
) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('records', 'readwrite');
      transaction.objectStore('records').put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
const records = (backup: Awaited<ReturnType<typeof exportBrowserBackup>>) =>
  backup.databases.flatMap((db) => db.stores.flatMap((store) => store.records));

describe('browser source cleanup after migration', () => {
  it('clears the backed-up records, including binary data, while keeping the full backup and unrelated databases', async () => {
    const factory = new IDBFactory();
    await put(
      factory,
      'verdboard-host',
      'binary',
      new Uint8Array([0, 255, 128]),
    );
    await put(factory, 'VerdBoard', 'blob', new Blob(['Legacy bytes']));
    await put(factory, 'unrelated', 'keep', 'Unrelated data');
    const backup = await exportBrowserBackup(factory);
    expect(records(backup)).toHaveLength(2);
    await clearMigratedBrowserData(backup, factory);
    expect(records(await exportBrowserBackup(factory))).toEqual([]);
    expect(records(backup)).toHaveLength(2);
    expect(records(backup)[0].value).toEqual(new Uint8Array([0, 255, 128]));
    const request = factory.open('unrelated');
    const db = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    const stored = db.transaction('records').objectStore('records').get('keep');
    expect(
      await new Promise((resolve) => {
        stored.onsuccess = () => resolve(stored.result);
      }),
    ).toBe('Unrelated data');
    db.close();
  });
  it('preserves changed source records and permits a new backup and retry', async () => {
    const factory = new IDBFactory();
    await put(factory, 'verdboard-host', 'old', 'Backed up');
    const backup = await exportBrowserBackup(factory);
    await put(factory, 'verdboard-host', 'old', 'Updated existing record');
    await put(factory, 'verdboard-host', 'new', 'New edit');
    await expect(clearMigratedBrowserData(backup, factory)).rejects.toThrow(
      '已发生变化',
    );
    expect(records(await exportBrowserBackup(factory))).toHaveLength(2);
    await clearMigratedBrowserData(await exportBrowserBackup(factory), factory);
    expect(records(await exportBrowserBackup(factory))).toEqual([]);
  });
  it('refuses to clear a new legacy database that appeared after export', async () => {
    const factory = new IDBFactory();
    await put(factory, 'verdboard-host', 'old', 'Backed up');
    const backup = await exportBrowserBackup(factory);
    await put(factory, 'Drawnix', 'new', 'Unexported workspace');
    await expect(clearMigratedBrowserData(backup, factory)).rejects.toThrow(
      '已发生变化',
    );
    expect(records(await exportBrowserBackup(factory))).toHaveLength(2);
  });
  it('retains a write committed after the preflight read but before the exclusive cleanup transaction', async () => {
    const factory = new IDBFactory();
    await put(factory, 'verdboard-host', 'old', 'Backed up');
    const backup = await exportBrowserBackup(factory);
    const open = factory.open.bind(factory);
    let opened = 0;
    const concurrent = vi
      .spyOn(factory, 'open')
      .mockImplementation((name, version) => {
        const request = open(name, version);
        if (++opened === 2)
          request.addEventListener('success', () => {
            const transaction = request.result.transaction(
              'records',
              'readwrite',
            );
            transaction.objectStore('records').put('Concurrent edit', 'racing');
          });
        return request;
      });
    try {
      await expect(clearMigratedBrowserData(backup, factory)).rejects.toThrow(
        '已发生变化',
      );
    } finally {
      concurrent.mockRestore();
    }
    expect(records(await exportBrowserBackup(factory))).toHaveLength(2);
  });
  it('is safe to repeat and does not recreate missing databases', async () => {
    const factory = new IDBFactory();
    await put(factory, 'verdboard-host', 'old', 'Backed up');
    const backup = await exportBrowserBackup(factory);
    await clearMigratedBrowserData(backup, factory);
    await clearMigratedBrowserData(backup, factory);
    const deletion = factory.deleteDatabase('verdboard-host');
    await new Promise<void>((resolve) => {
      deletion.onsuccess = () => resolve();
    });
    await clearMigratedBrowserData(backup, factory);
    expect(await factory.databases()).toEqual([]);
  });
});
