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
import {
  addWorkflowTask,
  createWorkflowFrameSnapshot,
  createWorkflowTaskCell,
} from '../../../workflow/src/public-api';
import { createTestCellRegistry } from '../../../../../tests/fixtures/plugins/registry';
import { createSwimlaneCell, setSwimlaneCount } from '../cell-table';

function fixture(direction: 'horizontal' | 'vertical' = 'horizontal') {
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
    direction,
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

it.each(['horizontal', 'vertical'] as const)(
  'joins only fully contained %s drops and releases partial or outside drops with reversible membership',
  (direction) => {
    const { runtime, registry, commit } = fixture(direction);
    const [first, second] = frameLanes(runtime.store, 'frame', registry);
    const dropAt = (x: number, y: number) => {
      const node = runtime.store.cells.a as NodeCell;
      commit(
        planLaneDrop(
          runtime.store,
          'frame',
          ['a'],
          translateCellSelection(
            runtime.store,
            ['a'],
            [x - node.geometry.x, y - node.geometry.y],
            registry,
          ),
          registry,
        ),
      );
    };
    const members = () =>
      frameLanes(runtime.store, 'frame', registry).map((lane) => lane.members);
    // The centre is inside, but the left edge crosses the lane boundary.
    dropAt(first.bounds.x - 10, first.bounds.y + 20);
    expect(members()).toEqual([[], []]);
    dropAt(first.bounds.x, first.bounds.y + 20);
    expect(members()).toEqual([['a'], []]);
    const contained = structuredClone(runtime.store);
    dropAt(first.bounds.x - 10, first.bounds.y + 20);
    expect(members()).toEqual([[], []]);
    expect((runtime.store.cells.a as NodeCell).geometry.x).toBe(
      first.bounds.x - 10,
    );
    const released = structuredClone(runtime.store);
    runtime.undo();
    expect(runtime.store).toEqual(contained);
    runtime.redo();
    expect(runtime.store).toEqual(released);
    dropAt(first.bounds.x - 200, first.bounds.y + 20);
    expect(members()).toEqual([[], []]);
    dropAt(first.bounds.x + 20, first.bounds.y + 20);
    dropAt(second.bounds.x + 20, second.bounds.y + 20);
    expect(members()).toEqual([[], ['a']]);
    expect(runtime.store.cells.edge).toEqual(contained.cells.edge);
    const restored = createCellRuntime(
      JSON.parse(JSON.stringify(runtime.snapshot)),
      createTestCellRegistry(),
    );
    expect(restored.store).toEqual(runtime.store);
  },
);

it.each(['horizontal', 'vertical'] as const)(
  'releases and transfers a %s group as a rigid block rather than assigning individual leaves',
  (direction) => {
    const { runtime, registry, commit } = fixture(direction);
    const [first, second] = frameLanes(runtime.store, 'frame', registry);
    commit(groupCells(runtime.store, 'frame', ['a', 'b'], 'group', registry));
    const drop = (dx: number, dy: number) =>
      commit(
        planLaneDrop(
          runtime.store,
          'frame',
          ['group'],
          translateCellSelection(runtime.store, ['group'], [dx, dy], registry),
          registry,
        ),
      );
    drop(
      first.bounds.x + 20 - (runtime.store.cells.a as NodeCell).geometry.x,
      0,
    );
    expect(frameLanes(runtime.store, 'frame', registry)[0].members).toEqual([
      'a',
      'b',
    ]);
    const a = runtime.store.cells.a as NodeCell;
    const spacing =
      (runtime.store.cells.b as NodeCell).geometry.x - a.geometry.x;
    drop(first.bounds.x - 10 - a.geometry.x, 0);
    expect(
      frameLanes(runtime.store, 'frame', registry).every(
        (lane) => !lane.members.length,
      ),
    ).toBe(true);
    const before = structuredClone(runtime.store);
    const released = runtime.store.cells.a as NodeCell;
    drop(
      second.bounds.x + 20 - released.geometry.x,
      second.bounds.y + 20 - released.geometry.y,
    );
    expect(frameLanes(runtime.store, 'frame', registry)[1].members).toEqual([
      'a',
      'b',
    ]);
    expect(
      (runtime.store.cells.b as NodeCell).geometry.x -
        (runtime.store.cells.a as NodeCell).geometry.x,
    ).toBe(spacing);
    expect(runtime.store.cells.group).toEqual(before.cells.group);
    runtime.undo();
    expect(runtime.store).toEqual(before);
  },
);

it('keeps explicit assignment placement and capacity checks and removes membership without moving nodes', () => {
  const { runtime, registry, commit } = fixture();
  const target = frameLanes(runtime.store, 'frame', registry)[0];
  const assignment = { containerId: target.containerId, laneId: target.id };
  const node = runtime.store.cells.a as NodeCell;
  commit(
    translateCellSelection(
      runtime.store,
      ['a'],
      [target.bounds.x - 10 - node.geometry.x, 0],
      registry,
    ),
  );
  commit(planLaneDrop(runtime.store, 'frame', ['a'], [], registry, assignment));
  expect((runtime.store.cells.a as NodeCell).geometry.x).toBe(target.bounds.x);
  const assigned = runtime.store.cells.a;
  commit(planLaneDrop(runtime.store, 'frame', ['a'], [], registry, null));
  expect(runtime.store.cells.a).toEqual(assigned);
  expect(frameLanes(runtime.store, 'frame', registry)[0].members).toEqual([]);
  commit([
    {
      type: 'replace_cell',
      cell: {
        ...node,
        geometry: { ...node.geometry, width: target.bounds.width + 1 },
      },
    },
  ]);
  const before = runtime.store;
  expect(() =>
    planLaneDrop(runtime.store, 'frame', ['a'], [], registry, assignment),
  ).toThrow('Swimlane has insufficient space');
  expect(runtime.store).toBe(before);
});

it('keeps locked containers and members atomic when releasing a lane assignment', () => {
  const { runtime, registry, commit } = fixture();
  const target = frameLanes(runtime.store, 'frame', registry)[0];
  commit(
    planLaneDrop(runtime.store, 'frame', ['a'], [], registry, {
      containerId: target.containerId,
      laneId: target.id,
    }),
  );
  commit([
    {
      type: 'replace_cell',
      cell: { ...runtime.store.cells.lanes, locked: true },
    },
  ]);
  const node = runtime.store.cells.a as NodeCell;
  const before = runtime.store;
  expect(() =>
    planLaneDrop(
      runtime.store,
      'frame',
      ['a'],
      translateCellSelection(
        runtime.store,
        ['a'],
        [target.bounds.x - 10 - node.geometry.x, 0],
        registry,
      ),
      registry,
    ),
  ).toThrow('Swimlane is locked');
  expect(runtime.store).toBe(before);
  commit([
    {
      type: 'replace_cell',
      cell: { ...runtime.store.cells.lanes, locked: false },
    },
    { type: 'replace_cell', cell: { ...node, locked: true } },
  ]);
  expect(() =>
    planLaneDrop(runtime.store, 'frame', ['a'], [], registry, null),
  ).toThrow('Swimlane member is locked');
});

it('moves a workflow start outside a swimlane without moving or releasing its lane task', () => {
  const registry = createTestCellRegistry();
  const runtime = createCellRuntime(
    createWorkflowFrameSnapshot('frame', 'start'),
    registry,
  );
  runtime.transact({
    id: 'task',
    operations: addWorkflowTask(
      runtime.store,
      'start',
      createWorkflowTaskCell('task'),
    ),
  });
  const lane = createSwimlaneCell(
    'lanes',
    [
      [0, 200],
      [600, 700],
    ],
    'horizontal',
    false,
    1,
  );
  lane.data!.laneMembers = {};
  runtime.transact({
    id: 'lane',
    operations: [{ type: 'insert_cell', parentId: 'frame', cell: lane }],
  });
  const target = frameLanes(runtime.store, 'frame', registry)[0];
  runtime.transact({
    id: 'assign',
    operations: planLaneDrop(runtime.store, 'frame', ['task'], [], registry, {
      containerId: target.containerId,
      laneId: target.id,
    }),
  });
  const before = structuredClone(runtime.store);
  const start = runtime.store.cells.start as NodeCell;
  runtime.transact({
    id: 'move',
    operations: planLaneDrop(
      runtime.store,
      'frame',
      ['start'],
      registry.get(start.kind)!.move!(runtime.store, start, {
        ...start.geometry,
        x: start.geometry.x + 600,
      }),
      registry,
    ),
  });
  expect(runtime.store.cells.task).toEqual(before.cells.task);
  expect(runtime.store.cells.lanes).toEqual(before.cells.lanes);
  expect(runtime.store.cells.start).toMatchObject({
    geometry: { x: start.geometry.x + 600 },
    data: start.data,
  });
  runtime.undo();
  expect(runtime.store).toEqual(before);
});

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
