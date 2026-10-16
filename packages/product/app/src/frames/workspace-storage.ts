import {
  stripFrameViewports,
  isFrameCell,
  validateCellStore,
  type Cell,
  type CellRegistry,
  type FrameCell,
  type FrameSnapshot,
} from '@sue/board-core';
import type { StorageAdapter } from '../storage-adapter';

export const WORKSPACE_KEY = 'main_board_content';
export const MIGRATION_BACKUP_KEY = 'legacy_workspace_backup';
export interface FrameRecord {
  format: 'verd-frame';
  version: 1;
  frame: FrameCell;
  cells: Record<string, Cell>;
}
export interface WorkspaceManifest {
  format: 'verd-workspace';
  /** v1 is the pre-repair manifest. Writers emit v2 after this round's fixes. */
  version: 1 | 2;
  rootId: string;
  frames: Record<string, string>;
  detachedFrameIds: string[];
  /** Timestamp of the last successful manifest commit, in Unix milliseconds. */
  lastSavedAt?: number;
}
export interface WorkspaceSnapshot extends FrameSnapshot {
  detachedFrameIds: string[];
}
export type WorkspaceStorageAdapter = StorageAdapter;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const isWorkspaceManifest = (
  value: unknown,
): value is WorkspaceManifest => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as WorkspaceManifest;
  return (
    candidate.format === 'verd-workspace' &&
    (candidate.version === 1 || candidate.version === 2) &&
    typeof candidate.rootId === 'string' &&
    !!candidate.frames &&
    typeof candidate.frames === 'object' &&
    !Array.isArray(candidate.frames) &&
    Object.values(candidate.frames).every(
      (key) =>
        typeof key === 'string' &&
        /^frames\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(key),
    ) &&
    new Set(Object.values(candidate.frames)).size ===
      Object.keys(candidate.frames).length &&
    Array.isArray(candidate.detachedFrameIds) &&
    candidate.detachedFrameIds.every((id) => typeof id === 'string')
  );
};
const assertWorkspace = (
  snapshot: WorkspaceSnapshot,
  registry?: CellRegistry,
) => {
  const errors = validateCellStore(snapshot.store, registry);
  if (errors.length)
    throw new Error(errors.map((error) => error.message).join('; '));
  const roots = Object.values(snapshot.store.cells)
    .filter(isFrameCell)
    .filter(
      (frame) =>
        !Object.values(snapshot.store.cells).some(
          (parent) => isFrameCell(parent) && parent.children.includes(frame.id),
        ),
    )
    .map((frame) => frame.id);
  if (
    new Set(snapshot.detachedFrameIds).size !==
      snapshot.detachedFrameIds.length ||
    snapshot.detachedFrameIds.includes(snapshot.store.rootId) ||
    snapshot.detachedFrameIds.some((id) => !roots.includes(id)) ||
    roots.some(
      (id) =>
        id !== snapshot.store.rootId && !snapshot.detachedFrameIds.includes(id),
    )
  )
    throw new Error('Invalid detached frame list');
};
const recordKey = (id: string, revision: string) => {
  // Cell ids may contain punctuation; encode all code units without ambiguity.
  const encoded = Array.from(id)
    .map((character) => character.codePointAt(0)!.toString(16))
    .join('_');
  return `frames/${encoded}/${revision}`;
};

const channels = new WeakMap<StorageAdapter, Promise<void>>();
const busyKeys = new WeakMap<StorageAdapter, Set<string>>();
const maintenanceErrors = new WeakMap<StorageAdapter, Error>();

/** Save, load, upgrade and GC share one serial channel per adapter. */
export const withStorageChannel = <T>(
  adapter: StorageAdapter,
  task: () => Promise<T>,
): Promise<T> => {
  const previous = channels.get(adapter) ?? Promise.resolve();
  const run = previous.then(task, task);
  channels.set(
    adapter,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
};
const markBusy = (adapter: StorageAdapter, key: string) => {
  const keys = busyKeys.get(adapter) ?? new Set<string>();
  keys.add(key);
  busyKeys.set(adapter, keys);
  return () => keys.delete(key);
};
export const workspaceMaintenanceError = (adapter: StorageAdapter) =>
  maintenanceErrors.get(adapter);
const sameRecord = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
const isFrameRecord = (
  record: unknown,
  frameId: string,
): record is FrameRecord => {
  if (!record || typeof record !== 'object' || Array.isArray(record))
    return false;
  const candidate = record as FrameRecord;
  return (
    candidate.format === 'verd-frame' &&
    candidate.version === 1 &&
    !!candidate.frame &&
    candidate.frame.id === frameId &&
    isFrameCell(candidate.frame) &&
    !!candidate.cells &&
    typeof candidate.cells === 'object' &&
    !Array.isArray(candidate.cells)
  );
};
const frameRecord = (
  snapshot: WorkspaceSnapshot,
  cell: FrameCell,
): FrameRecord => {
  const cells: Record<string, Cell> = {};
  [...cell.children, ...cell.groups].forEach((id) => {
    const child = snapshot.store.cells[id];
    if (child && !isFrameCell(child)) cells[id] = child;
  });
  return {
    format: 'verd-frame',
    version: 1,
    frame: stripFrameViewports({ rootId: cell.id, cells: { [cell.id]: cell } })
      .cells[cell.id] as FrameCell,
    cells,
  };
};

/** Records are immutable. The final manifest write is the only commit point. */
const persistCellWorkspace = async (
  adapter: StorageAdapter,
  snapshot: WorkspaceSnapshot,
  registry?: CellRegistry,
): Promise<WorkspaceManifest> => {
  const saved = clone(snapshot);
  assertWorkspace(saved, registry);
  const revision = `${Date.now().toString(36)}-${globalThis.crypto.randomUUID()}`;
  const previousValue = await adapter.getItem(WORKSPACE_KEY);
  const previous = isWorkspaceManifest(previousValue)
    ? previousValue
    : undefined;
  const frames: Record<string, string> = {};
  const written = new Map<string, FrameRecord>();
  for (const cell of Object.values(saved.store.cells)) {
    if (!isFrameCell(cell)) continue;
    const record = frameRecord(saved, cell);
    const existingKey = previous?.frames[cell.id];
    if (existingKey) {
      const release = markBusy(adapter, existingKey);
      let existing: unknown;
      try {
        existing = await adapter.getItem(existingKey);
      } finally {
        release();
      }
      if (isFrameRecord(existing, cell.id) && sameRecord(existing, record)) {
        frames[cell.id] = existingKey;
        continue;
      }
    }
    const key = recordKey(cell.id, revision);
    frames[cell.id] = key;
    written.set(key, record);
    const release = markBusy(adapter, key);
    try {
      await adapter.setItem(key, record);
    } finally {
      release();
    }
  }
  for (const [key, record] of written) {
    const release = markBusy(adapter, key);
    let stored: unknown;
    try {
      stored = await adapter.getItem(key);
    } finally {
      release();
    }
    if (!sameRecord(stored, record))
      throw new Error(`Frame document verification failed: ${record.frame.id}`);
  }
  const manifest: WorkspaceManifest = {
    format: 'verd-workspace',
    version: 2,
    rootId: saved.store.rootId,
    frames,
    detachedFrameIds: saved.detachedFrameIds,
    lastSavedAt: Date.now(),
  };
  await adapter.setItem(WORKSPACE_KEY, manifest);
  try {
    await garbageCollectFrames(adapter);
    maintenanceErrors.delete(adapter);
  } catch (error) {
    maintenanceErrors.set(
      adapter,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
  return manifest;
};
export const saveCellWorkspace = (
  adapter: StorageAdapter,
  snapshot: WorkspaceSnapshot,
  registry?: CellRegistry,
) =>
  withStorageChannel(adapter, () =>
    persistCellWorkspace(adapter, snapshot, registry),
  );

const readCellWorkspace = async (
  adapter: StorageAdapter,
  registry?: CellRegistry,
): Promise<WorkspaceSnapshot | null> => {
  const value = await adapter.getItem(WORKSPACE_KEY);
  if (!value) return null;
  if (!isWorkspaceManifest(value))
    throw new Error('Workspace requires legacy migration');
  const cells: Record<string, Cell> = {};
  for (const [frameId, key] of Object.entries(value.frames)) {
    const release = markBusy(adapter, key);
    let record: unknown;
    try {
      record = await adapter.getItem(key);
    } finally {
      release();
    }
    if (!isFrameRecord(record, frameId))
      throw new Error(`Missing or invalid frame document: ${frameId}`);
    const owned = [...record.frame.children, ...record.frame.groups].filter(
      (id) => !Object.hasOwn(value.frames, id),
    );
    if (
      Object.keys(record.cells).length !== owned.length ||
      owned.some((id) => !Object.hasOwn(record.cells, id)) ||
      Object.values(record.cells).some(isFrameCell)
    )
      throw new Error(`Invalid frame document partition: ${frameId}`);
    for (const [id, cell] of Object.entries({
      ...record.cells,
      [frameId]: record.frame,
    })) {
      if (cells[id]) throw new Error(`Duplicate persisted cell: ${id}`);
      if (!cell || typeof cell !== 'object' || cell.id !== id)
        throw new Error(`Invalid persisted cell: ${id}`);
      cells[id] = cell;
    }
  }
  const snapshot = {
    store: stripFrameViewports({ rootId: value.rootId, cells }),
    detachedFrameIds: [...value.detachedFrameIds],
  };
  assertWorkspace(snapshot, registry);
  return snapshot;
};
export const loadCellWorkspace = (
  adapter: StorageAdapter,
  registry?: CellRegistry,
) =>
  withStorageChannel(adapter, async () => {
    const snapshot = await readCellWorkspace(adapter, registry);
    if (!snapshot) return null;
    try {
      await garbageCollectFrames(adapter);
      maintenanceErrors.delete(adapter);
    } catch (error) {
      maintenanceErrors.set(
        adapter,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    return snapshot;
  });

/**
 * Deletes unreferenced frame records after the manifest is known to be valid.
 * Backups and in-flight keys are kept. A corrupt manifest or record stops GC.
 */
const garbageCollectFrames = async (adapter: StorageAdapter) => {
  const value = await adapter.getItem(WORKSPACE_KEY);
  if (!isWorkspaceManifest(value)) return;
  for (const [frameId, key] of Object.entries(value.frames)) {
    const release = markBusy(adapter, key);
    let record: unknown;
    try {
      record = await adapter.getItem(key);
    } finally {
      release();
    }
    if (!isFrameRecord(record, frameId)) return;
  }
  const live = new Set(Object.values(value.frames));
  const busy = busyKeys.get(adapter) ?? new Set<string>();
  for (const key of await adapter.listKeys()) {
    if (!key.startsWith('frames/') || live.has(key) || busy.has(key)) continue;
    if (key === MIGRATION_BACKUP_KEY || key.startsWith('archive/')) continue;
    await adapter.removeItem(key);
  }
};
