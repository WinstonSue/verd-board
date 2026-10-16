import { describe, expect, it } from 'vitest';
import {
  applyCellOperations,
  type CellStore,
  type NodeCell,
  type NodeGeometry,
} from '@sue/board-core';
import { MindLayoutType } from '@sue/board-layouts';
import {
  addMindChild,
  createMindChildCell,
  createMindFrameSnapshot,
  createMindRootCell,
} from './cell-commands';
import { layoutMindCells, mindChildIds } from './cell-utils';
import { mindGrowthSide } from './cell-link';
import { resolveMindChildMove } from './cell-drag';

const fixture = (layout: string = 'right') => {
  let { store } = createMindFrameSnapshot('frame', 'root');
  store.cells.root = { ...store.cells.root, data: { layout } } as NodeCell;
  for (const [parent, id] of [
    ['root', 'a'],
    ['root', 'b'],
    ['a', 'a1'],
  ])
    store = applyCellOperations(
      store,
      addMindChild(store, parent, createMindChildCell(id), `edge-${id}`),
    );
  return store;
};

const near = (
  store: CellStore,
  positions: Map<string, NodeGeometry>,
  target: string,
  distance: number,
) => {
  const b = positions.get(target)!;
  const moving = { ...positions.get('a')! };
  switch (mindGrowthSide(store, target)) {
    case 'right':
      return {
        ...moving,
        x: b.x + b.width + distance,
        y: b.y + b.height / 2 - moving.height / 2,
      };
    case 'left':
      return {
        ...moving,
        x: b.x - distance - moving.width,
        y: b.y + b.height / 2 - moving.height / 2,
      };
    case 'top':
      return {
        ...moving,
        x: b.x + b.width / 2 - moving.width / 2,
        y: b.y - distance - moving.height,
      };
    case 'bottom':
      return {
        ...moving,
        x: b.x + b.width / 2 - moving.width / 2,
        y: b.y + b.height + distance,
      };
  }
};

describe('Mind attachment hotzones', () => {
  it('chooses the nearest overlapping target, breaking equal distances by Frame order', () => {
    let store = fixture();
    store = applyCellOperations(store, [
      {
        type: 'insert_cell',
        parentId: 'frame',
        cell: createMindRootCell('other'),
      },
    ]);
    const positions = layoutMindCells(store, 'frame');
    positions.forEach((bounds, id) =>
      positions.set(id, { ...bounds, x: -5000, y: -5000 }),
    );
    positions.set('b', { x: 500, y: 100, width: 100, height: 40 });
    positions.set('other', { x: 500, y: 110, width: 100, height: 40 });
    const context = {
      point: [-10000, -10000] as [number, number],
      geometry: positions,
    };
    const move = (y: number) =>
      resolveMindChildMove(
        store,
        store.cells.a,
        { x: 620, y: y - 20, width: 100, height: 40 },
        undefined,
        context,
      );
    expect(move(125).parentId).toBe('b');
    expect(move(128).parentId).toBe('other');
  });

  it.each(['left', 'right'] as const)(
    'uses the %s hotzone of another standard root independently of the pointer',
    (side) => {
      let store = fixture();
      store = applyCellOperations(store, [
        {
          type: 'insert_cell',
          parentId: 'frame',
          cell: {
            ...createMindRootCell('other', [1000, 600]),
            data: { layout: 'standard' },
          },
        },
      ]);
      const positions = layoutMindCells(store, 'frame'),
        target = positions.get('other')!;
      const preview = {
        ...positions.get('a')!,
        x:
          side === 'left'
            ? target.x - 20 - positions.get('a')!.width
            : target.x + target.width + 20,
        y: target.y + target.height / 2 - positions.get('a')!.height / 2,
      };
      const plan = resolveMindChildMove(
        store,
        store.cells.a,
        preview,
        undefined,
        { point: [-10000, -10000], geometry: positions },
      );
      expect(plan.parentId).toBe('other');
      const next = applyCellOperations(store, plan.operations);
      expect(
        (next.cells.other as NodeCell<{ rightNodeCount: number }>).data
          ?.rightNodeCount ?? Math.ceil(mindChildIds(next, 'other').length / 2),
      ).toBe(side === 'left' ? 0 : 1);
    },
  );

  it.each(Object.values(MindLayoutType))(
    'captures by the facing node edge in %s without needing the pointer inside',
    (layout) => {
      const store = fixture(layout),
        positions = layoutMindCells(store, 'frame');
      const plan = resolveMindChildMove(
        store,
        store.cells.a,
        near(store, positions, 'b', 20),
        undefined,
        {
          point: [-10000, -10000],
          geometry: positions,
          scale: 1,
        },
      );
      expect(plan.parentId).toBe('b');
      expect(mindChildIds(store, 'b')).toEqual([]);
      const next = applyCellOperations(store, plan.operations);
      expect(mindChildIds(next, 'b')).toEqual(['a']);
      expect(mindChildIds(next, 'a')).toEqual(['a1']);
    },
  );

  it.each([0.01, 0.25, 0.75, 1, 2, 4])(
    'uses CSS pixel depth at scale %s and the displayed embedded offset',
    (scale) => {
      const store = fixture(),
        positions = layoutMindCells(store, 'frame');
      positions.forEach((b, id) =>
        positions.set(id, { ...b, x: b.x + 700, y: b.y + 800 }),
      );
      const context = {
        point: [-10000, -10000] as [number, number],
        geometry: positions,
        scale,
      };
      expect(
        resolveMindChildMove(
          store,
          store.cells.a,
          near(store, positions, 'b', 39 / scale),
          undefined,
          context,
        ).parentId,
      ).toBe('b');
      expect(
        resolveMindChildMove(
          store,
          store.cells.a,
          near(store, positions, 'b', 41 / scale),
          undefined,
          context,
        ).parentId,
      ).toBeUndefined();
    },
  );

  it('blocks descendants and locked destinations without a sibling reorder fallback', () => {
    let store = fixture();
    const positions = layoutMindCells(store, 'frame');
    for (const [id, x, y] of [
      ['root', 0, 0],
      ['a', 500, 0],
      ['b', 500, 500],
      ['a1', 1000, 0],
    ] as const)
      positions.set(id, { ...positions.get(id)!, x, y });
    const context = {
      point: [-10000, -10000] as [number, number],
      geometry: positions,
      scale: 1,
    };
    expect(
      resolveMindChildMove(
        store,
        store.cells.a,
        near(store, positions, 'a1', 20),
        undefined,
        context,
      ),
    ).toEqual({ operations: [] });
    store = applyCellOperations(store, [
      { type: 'replace_cell', cell: { ...store.cells.b, locked: true } },
    ]);
    expect(
      resolveMindChildMove(
        store,
        store.cells.a,
        near(store, positions, 'b', 20),
        undefined,
        context,
      ),
    ).toEqual({ operations: [] });
  });

  it('allows another tree in the same Frame, and rejects an explicit cross-Frame target', () => {
    let store = fixture();
    store = applyCellOperations(store, [
      {
        type: 'insert_cell',
        parentId: 'frame',
        cell: createMindRootCell('other', [1000, 600]),
      },
    ]);
    const positions = layoutMindCells(store, 'frame');
    const plan = resolveMindChildMove(
      store,
      store.cells.a,
      near(store, positions, 'other', 20),
      undefined,
      {
        point: [-10000, -10000],
        geometry: positions,
      },
    );
    expect(plan.parentId).toBe('other');
    const foreign = createMindFrameSnapshot('foreign', 'foreign-root');
    store = { ...store, cells: { ...store.cells, ...foreign.store.cells } };
    expect(
      resolveMindChildMove(
        store,
        store.cells.a,
        positions.get('a')!,
        'foreign-root',
        { point: [0, 0], geometry: positions },
      ).operations,
    ).toEqual([]);
  });

  it('keeps the current parent in reorder mode rather than appending a child', () => {
    const store = fixture(),
      positions = layoutMindCells(store, 'frame');
    const plan = resolveMindChildMove(
      store,
      store.cells.b,
      near(store, positions, 'root', 20),
      undefined,
      {
        point: [0, -1000],
        geometry: positions,
      },
    );
    expect(plan.parentId).toBeUndefined();
    expect(
      mindChildIds(applyCellOperations(store, plan.operations), 'root'),
    ).toEqual(['b', 'a']);
  });
});
