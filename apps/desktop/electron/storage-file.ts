import * as fs from 'fs/promises';
import * as path from 'path';

export const ALLOWED_STORAGE_KEYS = [
  'main_board_content',
  'main_workflow_content',
  'main_workflow_registry',
  'main_mind_content',
  'legacy_workspace_backup',
] as const;

/** 值可以是旧文档，也可以是 `{ format: 'verd-cells', version: 1, store }`。 */
export type StorageRecord = Record<string, unknown>;

const FRAME_CONTENT_KEY =
  /^(mind|architecture)\/[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export function isAllowedStorageKey(key: string): boolean {
  return (
    (ALLOWED_STORAGE_KEYS as readonly string[]).includes(key) ||
    FRAME_CONTENT_KEY.test(key) ||
    /^frames\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(key)
  );
}

export function assertAllowedStorageKey(key: string): void {
  if (!isAllowedStorageKey(key)) {
    throw new Error(`Unsupported storage key: ${key}`);
  }
}

export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();

  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

export async function backupCorruptFile(filePath: string): Promise<string> {
  const backupPath = `${filePath}.bak`;
  await fs.copyFile(filePath, backupPath);
  return backupPath;
}

/** Replaces a corrupt file without reading it. Previous bytes are copied aside. */
export async function archiveAndReplaceStorage(
  filePath: string,
  data: StorageRecord,
): Promise<void> {
  try {
    await fs.access(filePath);
    const archive = `${filePath}.archive-${Date.now()}`;
    await fs.copyFile(filePath, archive);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await writeStorageAtomic(filePath, data);
}

export async function writeStorageAtomic(
  filePath: string,
  data: StorageRecord,
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  await fs.writeFile(tmpPath, payload, 'utf-8');
  await fs.rename(tmpPath, filePath);
}

async function readRaw(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

export async function readStorageRecord(
  filePath: string,
): Promise<StorageRecord | null> {
  try {
    const record: unknown = JSON.parse(await readRaw(filePath));
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new SyntaxError('Storage must contain an object');
    }
    return record as StorageRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    if (error instanceof SyntaxError) {
      const backupPath = await backupCorruptFile(filePath);
      throw new Error(
        `Corrupt storage file; original data preserved at ${backupPath}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export async function getStorageValue(
  filePath: string,
  key: string,
): Promise<unknown> {
  assertAllowedStorageKey(key);
  const storage = await readStorageRecord(filePath);
  if (!storage) {
    return null;
  }
  return storage[key] ?? null;
}

export async function setStorageValue(
  filePath: string,
  key: string,
  value: unknown,
): Promise<void> {
  assertAllowedStorageKey(key);
  const storage = (await readStorageRecord(filePath)) ?? {};
  storage[key] = value;
  await writeStorageAtomic(filePath, storage);
}

export async function removeStorageValue(
  filePath: string,
  key: string,
): Promise<void> {
  assertAllowedStorageKey(key);
  const storage = await readStorageRecord(filePath);
  if (!storage) return;
  delete storage[key];
  await writeStorageAtomic(filePath, storage);
}

export async function clearStorage(filePath: string): Promise<void> {
  await writeStorageAtomic(filePath, {});
}

export async function listStorageKeys(filePath: string): Promise<string[]> {
  const record = await readStorageRecord(filePath);
  return Object.keys(record ?? {}).filter(isAllowedStorageKey);
}
