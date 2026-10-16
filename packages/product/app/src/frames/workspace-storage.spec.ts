import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyCellOperations,
  createCellStore,
  createFrameCell,
  type NodeCell,
} from '@sue/board-core';
import {
  loadCellWorkspace,
  saveCellWorkspace,
  workspaceMaintenanceError,
  WORKSPACE_KEY,
} from './workspace-storage';
afterEach(() => vi.restoreAllMocks());
const node: NodeCell = {
  id: 'n',
  kind: 'geometry',
  cellType: 'node',
  geometry: { x: 10, y: 20, width: 40, height: 30 },
};
const makeSnapshot = () => ({
  store: applyCellOperations(createCellStore(createFrameCell('root')), [
    { type: 'insert_cell', cell: createFrameCell('nested'), parentId: 'root' },
    { type: 'insert_cell', cell: node, parentId: 'nested' },
  ]),
  detachedFrameIds: [],
});
const memory = () => {
  const values = new Map<string, unknown>();
  return {
    values,
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
    },
    removeItem: async (key: string) => {
      values.delete(key);
    },
    listKeys: async () => [...values.keys()],
  };
};
describe('partitioned cell workspace', () => {
  it('loads old and invalid timestamp metadata without putting it in the snapshot', async () => {
    const adapter = memory();
    const manifest = await saveCellWorkspace(adapter, makeSnapshot());
    for (const lastSavedAt of [undefined, 'invalid', -1]) {
      adapter.values.set(WORKSPACE_KEY, { ...manifest, lastSavedAt });
      expect(await loadCellWorkspace(adapter)).toEqual(makeSnapshot());
    }
  });
  it('reads legacy cameras without writing them and strips them on a later content save', async () => {
    const adapter = memory(),
      snapshot = makeSnapshot();
    const manifest = await saveCellWorkspace(adapter, snapshot);
    const record = adapter.values.get(manifest.frames.root) as {
      frame: Record<string, unknown>;
    };
    record.frame.view = {
      viewport: { zoom: 8, origination: [100, 200] },
      theme: { boardBackground: '#abcdef' },
    };
    const bytes = JSON.stringify(record),
      writes = vi.spyOn(adapter, 'setItem');
    const loaded = (await loadCellWorkspace(adapter))!;
    expect(loaded.store.cells.root).toMatchObject({
      view: { theme: { boardBackground: '#abcdef' } },
    });
    expect(loaded.store.cells.root.view).not.toHaveProperty('viewport');
    expect(writes).not.toHaveBeenCalled();
    expect(JSON.stringify(record)).toBe(bytes);
    const saved = await saveCellWorkspace(adapter, loaded);
    expect(
      (adapter.values.get(saved.frames.root) as { frame: { view: object } })
        .frame.view,
    ).not.toHaveProperty('viewport');
  });
  it('round trips nested frames without duplicating their content', async () => {
    const adapter = memory(),
      snapshot = makeSnapshot();
    const manifest = await saveCellWorkspace(adapter, snapshot);
    const root = adapter.values.get(manifest.frames.root) as {
      cells: Record<string, unknown>;
    };
    expect(root.cells.n).toBeUndefined();
    expect(root.cells.nested).toBeUndefined();
    expect(await loadCellWorkspace(adapter)).toEqual(snapshot);
  });
  it('does not expose a partial write when a frame write fails', async () => {
    const adapter = memory(),
      snapshot = makeSnapshot();
    await saveCellWorkspace(adapter, snapshot);
    const original = adapter.values.get(WORKSPACE_KEY);
    const set = adapter.setItem;
    const changed = makeSnapshot();
    (changed.store.cells.n as NodeCell).geometry = {
      ...(changed.store.cells.n as NodeCell).geometry,
      x: 99,
    };
    adapter.setItem = async (key, value) => {
      if (
        key.startsWith('frames/') &&
        (value as { frame?: { id: string } }).frame?.id === 'nested'
      )
        throw new Error('disk full');
      await set(key, value);
    };
    await expect(saveCellWorkspace(adapter, changed)).rejects.toThrow(
      'disk full',
    );
    expect(adapter.values.get(WORKSPACE_KEY)).toEqual(original);
    expect(await loadCellWorkspace(adapter)).toEqual(snapshot);
  });
  it('rejects missing documents instead of replacing them with an empty frame', async () => {
    const adapter = memory(),
      manifest = await saveCellWorkspace(adapter, makeSnapshot());
    adapter.values.delete(manifest.frames.nested);
    await expect(loadCellWorkspace(adapter)).rejects.toThrow('Missing');
  });
  it('keeps the old manifest when storage silently corrupts a new record', async () => {
    const adapter = memory();
    await saveCellWorkspace(adapter, makeSnapshot());
    const committed = adapter.values.get(WORKSPACE_KEY);
    const write = adapter.setItem;
    adapter.setItem = async (key, value) => {
      await write(key, key.startsWith('frames/') ? { damaged: true } : value);
    };
    const changed = makeSnapshot();
    (changed.store.cells.n as NodeCell).geometry = {
      ...(changed.store.cells.n as NodeCell).geometry,
      x: 77,
    };
    await expect(saveCellWorkspace(adapter, changed)).rejects.toThrow(
      'verification',
    );
    expect(adapter.values.get(WORKSPACE_KEY)).toEqual(committed);
    expect(await loadCellWorkspace(adapter)).toEqual(makeSnapshot());
  });
  it('rejects documents containing content owned by another frame', async () => {
    const adapter = memory();
    const manifest = await saveCellWorkspace(adapter, makeSnapshot());
    const record = adapter.values.get(manifest.frames.root) as {
      cells: Record<string, unknown>;
    };
    record.cells.n = node;
    await expect(loadCellWorkspace(adapter)).rejects.toThrow('partition');
  });
  it('does not let GC failure fail a committed save', async () => {
    const adapter = memory();
    const snapshot = makeSnapshot();
    await saveCellWorkspace(adapter, snapshot);
    const changed = makeSnapshot();
    (changed.store.cells.n as NodeCell).geometry = {
      ...(snapshot.store.cells.n as NodeCell).geometry,
      x: 9,
    };
    adapter.removeItem = async () => {
      throw new Error('gc failed');
    };
    await expect(saveCellWorkspace(adapter, changed)).resolves.toMatchObject({
      version: 2,
    });
    expect(workspaceMaintenanceError(adapter)?.message).toBe('gc failed');
    expect((await loadCellWorkspace(adapter))?.store.cells.n).toMatchObject({
      geometry: { x: 9 },
    });
  });
});
