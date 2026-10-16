declare global {
  interface Window {
    electronAPI: {
      onShutdown: (flush: () => Promise<void>) => () => void;
      storage: {
        keys: () => Promise<string[]>;
        get: (key: string) => Promise<unknown>;
        set: (key: string, value: unknown) => Promise<boolean>;
        remove: (key: string) => Promise<boolean>;
        clear: () => Promise<boolean>;
        reset: (record: Record<string, unknown>) => Promise<boolean>;
      };
    };
  }
}

export const storage = {
  onShutdown: (flush: () => Promise<void>) =>
    window.electronAPI.onShutdown(flush),
  async listKeys(): Promise<string[]> {
    return window.electronAPI.storage.keys();
  },
  async getItem(key: string): Promise<unknown> {
    return window.electronAPI.storage.get(key);
  },

  async setItem(key: string, value: unknown): Promise<void> {
    await window.electronAPI.storage.set(key, value);
  },

  async removeItem(key: string): Promise<void> {
    await window.electronAPI.storage.remove(key);
  },

  async clear(): Promise<void> {
    await window.electronAPI.storage.clear();
  },
  async resetWorkspace(record: Record<string, unknown>): Promise<void> {
    await window.electronAPI.storage.reset(record);
  },
};
