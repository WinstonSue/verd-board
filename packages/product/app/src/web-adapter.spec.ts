import { beforeEach, describe, expect, it, vi } from 'vitest';

const stores = new Map<string, Map<string, unknown>>();

vi.mock('localforage', () => ({
  default: {
    INDEXEDDB: 'indexeddb',
    LOCALSTORAGE: 'localstorage',
    createInstance({ name, storeName }: { name: string; storeName: string }) {
      const id = `${name}:${storeName}`;
      if (!stores.has(id)) {
        stores.set(id, new Map());
      }
      const store = stores.get(id)!;
      return {
        async getItem(key: string) {
          return store.has(key) ? store.get(key) : null;
        },
        async setItem(key: string, value: unknown) {
          store.set(key, value);
        },
        async removeItem(key: string) {
          store.delete(key);
        },
      };
    },
  },
}));

describe('createWebStorageAdapter', () => {
  beforeEach(() => {
    stores.clear();
  });

  it('migrates Drawnix/drawnix_store into VerdBoard/verdboard_store', async () => {
    const { createWebStorageAdapter } = await import('./web-adapter');
    stores.set(
      'Drawnix:drawnix_store',
      new Map([['main_board_content', { children: [{ id: 'legacy' }] }]]),
    );
    const adapter = createWebStorageAdapter();
    const value = await adapter.getItem('main_board_content');
    expect(value).toEqual({ children: [{ id: 'legacy' }] });
    expect(
      stores.get('VerdBoard:verdboard_store')?.get('main_board_content'),
    ).toEqual({ children: [{ id: 'legacy' }] });
  });

  it('prefers the new store when both exist', async () => {
    const { createWebStorageAdapter } = await import('./web-adapter');
    stores.set(
      'Drawnix:drawnix_store',
      new Map([['main_board_content', { children: [{ id: 'old' }] }]]),
    );
    stores.set(
      'VerdBoard:verdboard_store',
      new Map([['main_board_content', { children: [{ id: 'new' }] }]]),
    );
    const adapter = createWebStorageAdapter();
    expect(await adapter.getItem('main_board_content')).toEqual({
      children: [{ id: 'new' }],
    });
  });
});
