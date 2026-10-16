import { describe, expect, it } from 'vitest';
import { createCellRuntime } from './runtime';
import { applyCellOperations } from './index';
import { createCellStore, createFrameCell } from './types';
describe('mounted frame runtime', () => {
  it('drops legacy frame cameras without changing the input and caches indexes by document identity', () => {
    const frame = createFrameCell('root');
    Object.assign(frame, {
      view: { viewport: { zoom: 7 }, theme: { boardBackground: '#abcdef' } },
    });
    const source = createCellStore(frame),
      runtime = createCellRuntime({ store: source });
    expect(runtime.store.cells.root).toMatchObject({
      view: { theme: { boardBackground: '#abcdef' } },
    });
    expect(runtime.store.cells.root.view).not.toHaveProperty('viewport');
    expect(source.cells.root.view).toHaveProperty('viewport');
    const index = runtime.index,
      revision = runtime.revision;
    runtime.select({ focus: ['root'], ids: [] });
    expect(runtime.revision).toBe(revision);
    expect(runtime.index).toBe(index);
    runtime.transact({
      id: 'insert',
      operations: [
        {
          type: 'insert_cell',
          parentId: 'root',
          cell: {
            id: 'new',
            kind: 'geometry',
            cellType: 'node',
            geometry: { x: 0, y: 0, width: 20, height: 20 },
          },
        },
      ],
    });
    expect(runtime.index).not.toBe(index);
    expect(runtime.index.parentOf.get('new')).toBe('root');
  });
  it('preserves valid selection across host replacements and removes missing selected cells', () => {
    const store = applyCellOperations(
      createCellStore(createFrameCell('root')),
      [
        {
          type: 'insert_cell',
          parentId: 'root',
          cell: {
            id: 'node',
            kind: 'geometry',
            cellType: 'node',
            geometry: { x: 0, y: 0, width: 40, height: 40 },
          },
        },
      ],
    );
    const runtime = createCellRuntime({ store });
    runtime.select({ focus: ['root'], ids: ['node'] });
    const node = store.cells.node;
    runtime.replace({
      store: applyCellOperations(store, [
        {
          type: 'replace_cell',
          cell: { ...node, content: { label: 'Host update' } },
        },
      ]),
    });
    expect(runtime.selection).toEqual({ focus: ['root'], ids: ['node'] });
    runtime.replace({
      store: applyCellOperations(runtime.store, [
        { type: 'remove_cell', cellId: 'node' },
      ]),
    });
    expect(runtime.selection).toEqual({ focus: ['root'], ids: [] });
    runtime.replace({
      store: createCellStore(createFrameCell('another-root')),
    });
    expect(runtime.selection).toEqual({ focus: ['another-root'], ids: [] });
  });
  it('mounts a nested frame as a detail root without changing canonical hierarchy', () => {
    const store = applyCellOperations(
      createCellStore(createFrameCell('root')),
      [
        {
          type: 'insert_cell',
          cell: createFrameCell('nested'),
          parentId: 'root',
        },
        {
          type: 'insert_cell',
          cell: {
            id: 'node',
            kind: 'geometry',
            cellType: 'node',
            geometry: { x: 10, y: 10, width: 20, height: 20 },
          },
          parentId: 'nested',
        },
      ],
    );
    const runtime = createCellRuntime({ store });
    runtime.mount('nested');
    runtime.select({ focus: ['nested'], ids: ['node'] });
    expect(runtime.index.parentOf.get('nested')).toBe('root');
    expect(runtime.selection).toEqual({ focus: ['nested'], ids: ['node'] });
    expect(() => runtime.select({ focus: ['root'], ids: ['nested'] })).toThrow(
      'mounted root',
    );
  });
  it('allows explicit history-free metadata transactions', () => {
    const runtime = createCellRuntime({
      store: createCellStore(createFrameCell('root')),
    });
    const root = runtime.store.cells.root;
    runtime.transact({
      id: 'view',
      history: false,
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...root,
            view: { theme: { boardBackground: '#dddddd' } },
          } as import('./types').FrameCell,
        },
      ],
    });
    expect(runtime.history.undos).toHaveLength(0);
  });
  it('preserves later theme metadata when undo changes frame children', () => {
    const runtime = createCellRuntime({
      store: createCellStore(createFrameCell('root')),
    });
    runtime.transact({
      id: 'insert',
      operations: [
        {
          type: 'insert_cell',
          parentId: 'root',
          cell: {
            id: 'n',
            kind: 'geometry',
            cellType: 'node',
            geometry: { x: 0, y: 0, width: 10, height: 10 },
          },
        },
      ],
    });
    const root = runtime.store.cells.root as import('./types').FrameCell;
    runtime.transact({
      id: 'view',
      history: false,
      operations: [
        {
          type: 'replace_cell',
          cell: { ...root, view: { theme: { boardBackground: '#000000' } } },
        },
      ],
    });
    runtime.undo();
    expect(runtime.store.cells.root).toMatchObject({
      children: [],
      view: { theme: { boardBackground: '#000000' } },
    });
    runtime.redo();
    expect(runtime.store.cells.root).toMatchObject({
      children: ['n'],
      view: { theme: { boardBackground: '#000000' } },
    });
  });
  it('restores the file theme when the transaction asks for it', () => {
    const root = createFrameCell('root');
    root.view = { theme: { boardBackground: '#ffffff' } };
    const runtime = createCellRuntime({
      store: createCellStore(root),
    });
    runtime.transact({
      id: 'open',
      restoreView: true,
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...(runtime.store.cells.root as import('./types').FrameCell),
            view: { theme: { boardBackground: '#dddddd' } },
          },
        },
      ],
    });
    runtime.undo();
    expect(runtime.store.cells.root).toMatchObject({
      view: { theme: { boardBackground: '#ffffff' } },
    });
    runtime.redo();
    expect(runtime.store.cells.root).toMatchObject({
      view: { theme: { boardBackground: '#dddddd' } },
    });
  });
  it('drops selections that move out of their focus boundary', () => {
    const runtime = createCellRuntime({
      store: applyCellOperations(createCellStore(createFrameCell('root')), [
        {
          type: 'insert_cell',
          cell: createFrameCell('nested'),
          parentId: 'root',
        },
        {
          type: 'insert_cell',
          cell: {
            id: 'node',
            kind: 'geometry',
            cellType: 'node',
            geometry: { x: 0, y: 0, width: 10, height: 10 },
          },
          parentId: 'root',
        },
      ]),
    });
    runtime.select({ focus: ['root'], ids: ['node'] });
    runtime.transact({
      id: 'move',
      operations: [
        { type: 'move_cell', cellId: 'node', parentId: 'nested', index: 0 },
      ],
    });
    expect(runtime.selection).toEqual({ focus: ['root'], ids: [] });
  });
  it('retains a valid nested selection through property undo and redo', () => {
    const runtime = createCellRuntime({
      store: applyCellOperations(createCellStore(createFrameCell('root')), [
        {
          type: 'insert_cell',
          cell: createFrameCell('nested'),
          parentId: 'root',
        },
        {
          type: 'insert_cell',
          parentId: 'nested',
          cell: {
            id: 'node',
            kind: 'geometry',
            cellType: 'node',
            geometry: { x: 10, y: 10, width: 20, height: 20 },
          },
        },
      ]),
    });
    runtime.select({ focus: ['root', 'nested'], ids: ['node'] });
    runtime.transact({
      id: 'rename',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...runtime.store.cells.node,
            content: { label: 'changed' },
          } as import('./types').NodeCell,
        },
      ],
    });
    runtime.undo();
    expect(runtime.selection).toEqual({
      focus: ['root', 'nested'],
      ids: ['node'],
    });
    runtime.redo();
    expect(runtime.selection).toEqual({
      focus: ['root', 'nested'],
      ids: ['node'],
    });
    runtime.transact({
      id: 'delete',
      operations: [{ type: 'remove_cell', cellId: 'node' }],
    });
    expect(runtime.selection.ids).toEqual([]);
  });
  it('falls back to an existing root when redo deletes the mounted frame', () => {
    const runtime = createCellRuntime({
      store: applyCellOperations(createCellStore(createFrameCell('root')), [
        {
          type: 'insert_cell',
          cell: createFrameCell('nested'),
          parentId: 'root',
        },
      ]),
    });
    runtime.transact({
      id: 'delete',
      operations: [{ type: 'remove_cell', cellId: 'nested' }],
    });
    runtime.undo();
    runtime.mount('nested');
    runtime.redo();
    expect(runtime.mountedRootId).toBe('root');
    expect(runtime.selection).toEqual({ focus: ['root'], ids: [] });
  });
});
