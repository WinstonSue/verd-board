/** JSON document storage; enumeration is required to preserve unmounted legacy documents. */
export interface StorageAdapter {
  /** Desktop hosts wait for this flush before destroying the renderer. */
  onShutdown?(flush: () => Promise<void>): () => void;
  listKeys(): Promise<string[]>;
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: unknown): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** Archives the current host data, then installs an app-validated workspace. */
  resetWorkspace?(record: Record<string, unknown>): Promise<void>;
}
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
