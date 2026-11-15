import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createWebWorkspaceHost } from './web-workspace-host';
import { digestBytes } from '@sue/verd-board-workspace';

async function legacyWorkspace(conflict = false) {
  const factory = new IDBFactory();
  const name = 'resources-' + crypto.randomUUID();
  const host = createWebWorkspaceHost({ indexedDB: factory, dbName: name });
  const handle = (await host.openWorkspace({ path: 'legacy' }))!;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const transaction = db.transaction(['files', 'meta'], 'readwrite');
  const finished = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  const meta = transaction.objectStore('meta');
  const request = meta.get(handle.key);
  request.onsuccess = () => {
    const value = request.result;
    delete value.resourceLayoutVersion;
    meta.put(value);
  };
  const files = transaction.objectStore('files');
  for (const path of [
    '.verd-resources/assets/image.bin',
    '.verd-resources/history/index.json',
    ...(conflict ? ['.verdscrolls/resources/assets/image.bin'] : []),
  ]) {
    const bytes = new TextEncoder().encode(
      path.includes('history')
        ? '{"version":1,"revisions":[]}'
        : path.startsWith('.verdscrolls')
          ? 'current bytes'
          : 'legacy bytes',
    );
    files.put({
      id: handle.key + path,
      wsKey: handle.key,
      path,
      kind: 'file',
      content: bytes.buffer,
      version: digestBytes(bytes),
      size: bytes.length,
      updatedAt: 1,
    });
  }
  await finished;
  db.close();
  return { host, handle, factory, name };
}

describe('Web resource layout migration', () => {
  it('moves old bytes and history once without changing project config or exposing internal entries', async () => {
    const { host, handle } = await legacyWorkspace();
    const before = (await host.readSnapshot(handle)).config;
    await host.openWorkspace({ path: 'legacy' });
    const snapshot = await host.readSnapshot(handle);
    expect(snapshot.config).toEqual(before);
    expect(snapshot.entries).toEqual([]);
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.resources?.map((entry) => entry.key).sort()).toEqual([
      'assets/image.bin',
      'history/index.json',
    ]);
    expect(
      new TextDecoder().decode(
        (await host.readResource(handle, 'assets/image.bin')).content,
      ),
    ).toBe('legacy bytes');
    await host.openWorkspace({ path: 'legacy' });
    expect((await host.readSnapshot(handle)).resources).toEqual(
      snapshot.resources,
    );
  });
  it('preserves both layouts on conflict and refuses new resource writes', async () => {
    const { host, handle, factory, name } = await legacyWorkspace(true);
    await host.openWorkspace({ path: 'legacy' });
    expect((await host.readSnapshot(handle)).diagnostics[0]?.message).toContain(
      'conflict',
    );
    expect(
      (
        await host.commit(handle, {
          transactionId: 'must-fail',
          resourceWrites: [
            { path: 'assets/new.bin', content: 'new', expectedVersion: null },
          ],
        })
      ).outcome,
    ).toBe('rejected');
    expect(
      new TextDecoder().decode(
        (await host.readResource(handle, 'assets/image.bin')).content,
      ),
    ).toBe('current bytes');
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = factory.open(name);
      req.onsuccess = () => resolve(req.result);
    });
    const original = await new Promise<any>((resolve) => {
      const req = db
        .transaction('files')
        .objectStore('files')
        .get(handle.key + '.verd-resources/assets/image.bin');
      req.onsuccess = () => resolve(req.result);
    });
    expect(new TextDecoder().decode(original.content)).toBe('legacy bytes');
    db.close();
  });
});
