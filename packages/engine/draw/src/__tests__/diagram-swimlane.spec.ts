import { expect, it } from 'vitest';
import {
  copyCellFragment,
  createCellRuntime,
  edgePolyline,
  frameLanes,
  groupCells,
  isOrthogonalPolyline,
  planCellLayout,
  planCellPaste,
  planLaneDrop,
  translateCellSelection,
  type EdgeCell,
  type NodeCell,
} from '@sue/board-core';
import {
  createUmlClassCell,
  createUmlClassFrameSnapshot,
  createUmlRelationCell,
} from '../../../uml/src/public-api';
import { createTestCellRegistry } from '../../../../../tests/fixtures/plugins/registry';
import { createSwimlaneCell, setSwimlaneCount } from '../cell-table';

function fixture() {
  const registry = createTestCellRegistry();
  const runtime = createCellRuntime(
    createUmlClassFrameSnapshot('frame', 'root'),
    registry,
  );
  const lane = createSwimlaneCell(
    'lanes',
    [
      [0, 0],
      [960, 700],
    ],
    'horizontal',
    false,
    2,
  );
  lane.data!.laneMembers = {};
  const nodes = ['a', 'b', 'c', 'd'].map((id, index) => {
    const cell = createUmlClassCell(id);
    cell.geometry = {
      x: 120 + 190 * index,
      y: index < 3 ? 95 : 470,
      width: 100,
      height: 75,
    };
    return cell;
  });
  const link = createUmlRelationCell('edge', 'a', 'b', 'dependency');
  const commit = (
    operations: Parameters<typeof runtime.transact>[0]['operations'],
  ) => runtime.transact({ id: crypto.randomUUID(), operations });
  commit(
    [lane, ...nodes, link].map((cell) => ({
      type: 'insert_cell',
      parentId: 'frame',
      cell,
    })),
  );
  return { runtime, registry, commit, lane, link };
}

it('moves lane members together, preserves groups and releases removed tracks', () => {
  const { runtime, registry, commit, lane } = fixture();
  const assign = (ids: string[], track: number) => {
    const target = frameLanes(runtime.store, 'frame', registry)[track];
    commit(
      planLaneDrop(runtime.store, 'frame', ids, [], registry, {
        containerId: target.containerId,
        laneId: target.id,
      }),
    );
  };
  assign(['a', 'b'], 0);
  assign(['d'], 1);
  commit(groupCells(runtime.store, 'frame', ['a', 'b'], 'grouped', registry));
  expect(() =>
    commit(
      groupCells(runtime.store, 'frame', ['grouped', 'd'], 'invalid', registry),
    ),
  ).toThrow('Group crosses swimlanes');
  const x = (id: string) => (runtime.store.cells[id] as NodeCell).geometry.x;
  const previousX = x('a');
  commit(translateCellSelection(runtime.store, [lane.id], [40, 20], registry));
  expect(x('a')).toBe(previousX + 40);
  expect(x('c')).toBe(500);
  const beforeRemoval = runtime.store.cells.d;
  const current = runtime.store.cells[lane.id] as typeof lane;
  commit([
    {
      type: 'replace_cell',
      cell: setSwimlaneCount(current, 1, () => crypto.randomUUID()),
    },
  ]);
  expect(frameLanes(runtime.store, 'frame', registry)).toHaveLength(1);
  expect(runtime.store.cells.d).toBe(beforeRemoval);
  runtime.undo();
  expect(frameLanes(runtime.store, 'frame', registry)[1].members).toEqual([
    'd',
  ]);
});

it('layouts inside each lane and remaps a lane with its nested group and relation', () => {
  const { runtime, registry, commit } = fixture();
  const target = frameLanes(runtime.store, 'frame', registry)[0];
  commit(
    planLaneDrop(runtime.store, 'frame', ['a', 'b', 'c'], [], registry, {
      containerId: target.containerId,
      laneId: target.id,
    }),
  );
  commit(groupCells(runtime.store, 'frame', ['a', 'b'], 'inner', registry));
  commit(
    planCellLayout(
      runtime.store,
      { focus: ['frame'], ids: ['inner', 'c'] },
      'horizontal',
      registry,
    ),
  );
  const position = (runtime.store.cells.a as NodeCell).geometry;
  expect(position.x).toBeGreaterThanOrEqual(target.bounds.x);
  expect(position.y).toBeGreaterThanOrEqual(target.bounds.y);
  commit(groupCells(runtime.store, 'frame', ['inner', 'c'], 'outer', registry));
  const fragment = copyCellFragment(runtime.store, ['lanes'], registry);
  const paste = planCellPaste({
    store: runtime.store,
    frameId: 'frame',
    selectionIds: [],
    fragment,
    allocateId: (id) => `copy-${id}`,
    registry,
  });
  commit(paste.operations);
  expect(
    frameLanes(runtime.store, 'frame', registry).find(
      (lane) => lane.containerId === 'copy-lanes',
    )?.members,
  ).toEqual(['copy-a', 'copy-b', 'copy-c']);
  expect(runtime.store.cells['copy-outer']).toMatchObject({
    members: ['copy-inner', 'copy-c'],
  });
  expect(runtime.store.cells['copy-edge']).toMatchObject({
    source: { cellId: 'copy-a' },
    target: { cellId: 'copy-b' },
  });
});

it('normalizes legacy class relationships without changing their endpoints or markers', () => {
  const { runtime, registry, link } = fixture();
  const curve: EdgeCell = {
    ...link,
    route: {
      mode: 'curve',
      points: [
        [0, 0],
        [30, 45],
        [80, 90],
      ],
    },
  };
  const snapshot = {
    store: { ...runtime.store, cells: { ...runtime.store.cells, edge: curve } },
  };
  runtime.replace(snapshot);
  const edge = runtime.store.cells.edge as EdgeCell;
  expect(edge).toEqual({ ...curve, route: { mode: 'orthogonal' } });
  expect(snapshot.store.cells.edge).toBe(curve);
  expect(isOrthogonalPolyline(edgePolyline(runtime.store, edge))).toBe(true);
  const fixed: EdgeCell = {
    ...link,
    route: {
      mode: 'fixed',
      points: [
        [40, 40],
        [40, 100],
        [100, 100],
      ],
    },
  };
  const next = createCellRuntime(
    {
      store: {
        ...runtime.store,
        cells: { ...runtime.store.cells, edge: fixed },
      },
    },
    registry,
  );
  expect(next.store.cells.edge).toEqual({
    ...fixed,
    route: { mode: 'orthogonal', points: fixed.route.points },
  });
});
