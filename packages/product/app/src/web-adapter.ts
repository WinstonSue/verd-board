import localforage from 'localforage';
import type { StorageAdapter } from './storage-adapter';

const NEW_DB = { name: 'VerdBoard', storeName: 'verdboard_store' };
const LEGACY_DB = { name: 'Drawnix', storeName: 'drawnix_store' };

function createInstance(config: { name: string; storeName: string }) {
  return localforage.createInstance({
    ...config,
    driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
  });
}

/**
 * JSON records are returned unchanged. Workspace loading migrates legacy records
 * before assembling the native CellStore.
 */
export function createWebStorageAdapter(): StorageAdapter {
  const current = createInstance(NEW_DB);
  const legacy = createInstance(LEGACY_DB);
  return {
    async listKeys() {
      return [
        ...new Set([...(await current.keys()), ...(await legacy.keys())]),
      ];
    },
    async getItem(key: string) {
      const fresh = await current.getItem(key);
      if (fresh != null) {
        return fresh;
      }
      const old = await legacy.getItem(key);
      if (old != null) {
        await current.setItem(key, old);
      }
      return old;
    },
    async setItem(key: string, value: unknown) {
      await current.setItem(key, value);
    },
    async removeItem(key: string) {
      await current.removeItem(key);
    },
    async resetWorkspace(record: Record<string, unknown>) {
      const stamp = Date.now().toString(36);
      const keys = await current.keys();
      for (const key of keys) {
        if (key.startsWith('archive/')) continue;
        const value = await current.getItem(key);
        await current.setItem(`archive/${stamp}/${key}`, value);
        await current.removeItem(key);
      }
      for (const [key, value] of Object.entries(record))
        await current.setItem(key, value);
    },
  };
}
