import { describe, expect, it } from 'vitest';
import { applyCellOperations } from './index';
import { createCellRuntime } from './runtime';
import {
  createCellStore,
  createFrameCell,
  type FrameCell,
  type NodeCell,
  type EdgeCell,
} from './types';
import {
  alignCells,
  groupCells,
  moveGroup,
  reorderCells,
  translateCellSelection,
  updateCellAppearance,
  selectionAllows,
} from './commands';

const fixture = () =>
  applyCellOperations(
    createCellStore(createFrameCell('root')),
    ['a', 'b', 'c', 'd'].map((id, index) => ({
      type: 'insert_cell' as const,
      parentId: 'root',
      cell: {
        id,
        kind: 'geometry',
        cellType: 'node' as const,
        geometry: { x: index * 100, y: 0, width: 80, height: 50 },
      },
    })),
  );

describe('selection commands', () => {
  it('distinguishes owned Frame shells from global and mounted roots without changing ordinary node capabilities', () => {
    const store = applyCellOperations(fixture(), [
      { type: 'insert_cell', parentId: 'root', cell: createFrameCell('outer') },
      {
        type: 'insert_cell',
        parentId: 'outer',
        cell: createFrameCell('inner'),
      },
    ]);
    const runtime = createCellRuntime({ store });
    for (const capability of ['move', 'resize', 'delete'] as const) {
      expect(
        selectionAllows(store, ['root'], runtime.registry, capability),
      ).toBe(false);
      expect(
        selectionAllows(store, ['root'], runtime.registry, capability, 'outer'),
      ).toBe(false);
      expect(
        selectionAllows(store, ['outer'], runtime.registry, capability),
      ).toBe(true);
      expect(
        selectionAllows(store, ['inner'], runtime.registry, capability),
      ).toBe(true);
      expect(
        selectionAllows(
          store,
          ['outer'],
          runtime.registry,
          capability,
          'outer',
        ),
      ).toBe(false);
      expect(
        selectionAllows(
          store,
          ['inner'],
          runtime.registry,
          capability,
          'outer',
        ),
      ).toBe(true);
    }
    for (const capability of ['rotate', 'connect'] as const)
      expect(
        selectionAllows(store, ['outer'], runtime.registry, capability),
      ).toBe(false);
    const mounts: string[] = [];
    runtime.registry.register({
      kind: 'geometry',
      capabilities: (_store, _cell, mount) => {
        mounts.push(mount);
        return { move: true };
      },
    });
    expect(
      selectionAllows(store, ['a'], runtime.registry, 'move', 'outer'),
    ).toBe(true);
    expect(mounts).toEqual(['root']);
    runtime.mount('outer');
    expect(() =>
      runtime.select({ focus: ['outer'], ids: ['outer'] }),
    ).toThrow();
  });

  it('blocks Frame modifications under a locked ancestor or group and preserves whole-selection capability checks', () => {
    let store = applyCellOperations(fixture(), [
      { type: 'insert_cell', parentId: 'root', cell: createFrameCell('outer') },
      {
        type: 'insert_cell',
        parentId: 'outer',
        cell: createFrameCell('inner'),
      },
    ]);
    const runtime = createCellRuntime({ store });
    const locked = applyCellOperations(store, [
      { type: 'replace_cell', cell: { ...store.cells.outer, locked: true } },
    ]);
    for (const capability of ['move', 'resize', 'delete', 'edit'] as const) {
      expect(
        selectionAllows(locked, ['outer'], runtime.registry, capability),
      ).toBe(false);
      expect(
        selectionAllows(locked, ['inner'], runtime.registry, capability),
      ).toBe(false);
      expect(
        selectionAllows(locked, ['a', 'outer'], runtime.registry, capability),
      ).toBe(false);
    }
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['a', 'outer'], 'group'),
    );
    const lockedGroup = applyCellOperations(store, [
      { type: 'replace_cell', cell: { ...store.cells.group, locked: true } },
    ]);
    expect(
      selectionAllows(lockedGroup, ['outer'], runtime.registry, 'move'),
    ).toBe(false);
  });

  it('translates selected groups and Frame shells once, keeps nested coordinates and restores the whole selection in one undo', () => {
    let store = fixture();
    store = applyCellOperations(store, [
      ...groupCells(store, 'root', ['b', 'c'], 'group'),
      {
        type: 'insert_cell',
        parentId: 'root',
        cell: createFrameCell('nested'),
      },
      {
        type: 'insert_cell',
        parentId: 'nested',
        cell: { ...store.cells.a, id: 'inner' },
      },
      {
        type: 'insert_cell',
        parentId: 'root',
        cell: {
          id: 'edge',
          kind: 'arrow',
          cellType: 'edge',
          source: { cellId: 'a' },
          target: { point: [50, 50] },
          route: {
            mode: 'fixed',
            points: [
              [25, 30],
              [50, 50],
            ],
          },
        },
      },
    ]);
    const runtime = createCellRuntime({ store });
    runtime.transact({
      id: 'move',
      operations: translateCellSelection(
        store,
        ['a', 'group', 'b', 'nested', 'edge'],
        [20, 40],
      ),
    });
    for (const id of ['a', 'b', 'c', 'nested'])
      expect((runtime.store.cells[id] as NodeCell).geometry.x).toBe(
        (store.cells[id] as NodeCell).geometry.x + 20,
      );
    expect(runtime.store.cells.inner).toEqual(store.cells.inner);
    expect(runtime.store.cells.edge).toMatchObject({
      source: { cellId: 'a' },
      target: { point: [70, 90] },
      route: {
        points: [
          [45, 70],
          [70, 90],
        ],
      },
    });
    runtime.undo();
    expect(runtime.store).toEqual(store);
    const locked = applyCellOperations(store, [
      { type: 'replace_cell', cell: { ...store.cells.c, locked: true } },
    ]);
    expect(translateCellSelection(locked, ['group'], [20, 40])).toEqual([]);
    expect(moveGroup(locked, 'group', [20, 40])).toEqual([]);
    expect(translateCellSelection(locked, ['a', 'c'], [20, 40])).toEqual([]);
    expect(alignCells(locked, ['a', 'c'], 'left')).toEqual([]);
  });
  it('aligns a group bounding block without changing the spacing of its members', () => {
    const store = applyCellOperations(
      fixture(),
      groupCells(fixture(), 'root', ['b', 'c'], 'group'),
    );
    const runtime = createCellRuntime({ store });
    runtime.transact({
      id: 'align',
      operations: alignCells(store, ['a', 'group', 'd'], 'right'),
    });
    const nodes = runtime.store.cells as Record<string, NodeCell>;
    expect(nodes.a.geometry.x).toBe(300);
    expect(nodes.b.geometry.x).toBe(200);
    expect(nodes.c.geometry.x).toBe(300);
    expect(nodes.c.geometry.x - nodes.b.geometry.x).toBe(100);
    runtime.undo();
    expect(runtime.store).toEqual(store);
  });
  it('moves a group as a contiguous layer block with one-step history', () => {
    const runtime = createCellRuntime({
      store: applyCellOperations(
        fixture(),
        groupCells(fixture(), 'root', ['b', 'c'], 'group'),
      ),
    });
    for (const [direction, expected] of [
      ['front', ['a', 'd', 'b', 'c']],
      ['back', ['b', 'c', 'a', 'd']],
      ['forward', ['a', 'd', 'b', 'c']],
      ['backward', ['b', 'c', 'a', 'd']],
    ] as const) {
      runtime.transact({
        id: direction,
        operations: reorderCells(runtime.store, 'root', ['b'], direction),
      });
      expect((runtime.store.cells.root as FrameCell).children).toEqual(
        expected,
      );
      expect(runtime.index.membersOf.get('c')).toBe('group');
      runtime.undo();
      expect((runtime.store.cells.root as FrameCell).children).toEqual([
        'a',
        'b',
        'c',
        'd',
      ]);
      runtime.redo();
      expect((runtime.store.cells.root as FrameCell).children).toEqual(
        expected,
      );
      runtime.undo();
    }
  });
  it('formats mixed groups, edges and nested Frames atomically without editing locked cells or Frame descendants', () => {
    let store = fixture();
    store = applyCellOperations(store, [
      ...groupCells(store, 'root', ['a', 'b'], 'group'),
      { type: 'replace_cell', cell: { ...store.cells.b, locked: true } },
      {
        type: 'insert_cell',
        parentId: 'root',
        cell: createFrameCell('nested'),
      },
      {
        type: 'insert_cell',
        parentId: 'nested',
        cell: { ...store.cells.c, id: 'inner' },
      },
      {
        type: 'insert_cell',
        parentId: 'root',
        cell: {
          id: 'edge',
          kind: 'arrow',
          cellType: 'edge',
          source: { point: [0, 0] },
          target: { point: [50, 50] },
          route: { mode: 'straight' },
        },
      },
    ]);
    const runtime = createCellRuntime({ store });
    runtime.transact({
      id: 'appearance',
      operations: updateCellAppearance(
        store,
        ['group', 'a', 'edge', 'nested'],
        { fill: '#ff0000', shadow: 'lg', opacity: 0.5, strokeColor: '#0000ff' },
      ),
    });
    expect(runtime.store.cells.a).toEqual(store.cells.a);
    expect((runtime.store.cells.nested as FrameCell).appearance?.shadow).toBe(
      'lg',
    );
    expect((runtime.store.cells.edge as EdgeCell).appearance).toEqual({
      shadow: 'lg',
      opacity: 0.5,
      strokeColor: '#0000ff',
    });
    expect(runtime.store.cells.b).toEqual(store.cells.b);
    expect(runtime.store.cells.inner).toEqual(store.cells.inner);
    runtime.undo();
    expect(runtime.store).toEqual(store);
    runtime.redo();
    expect((runtime.store.cells.edge as EdgeCell).appearance?.shadow).toBe(
      'lg',
    );
    expect(runtime.store.cells.a).toEqual(store.cells.a);
  });
  it('keeps locked group members in place when changing layer order', () => {
    let store = fixture();
    store = applyCellOperations(store, [
      ...groupCells(store, 'root', ['b', 'c'], 'group'),
      { type: 'replace_cell', cell: { ...store.cells.c, locked: true } },
    ]);
    const next = applyCellOperations(
      store,
      reorderCells(store, 'root', ['group'], 'front'),
    );
    expect((next.cells.root as FrameCell).children).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });
});
