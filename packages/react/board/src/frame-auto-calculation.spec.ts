import { describe, expect, it } from 'vitest';
import {
  applyCellOperations,
  createCellStore,
  createFrameCell,
  createCellRuntime,
  groupCells,
  type CellOperation,
  type EdgeCell,
  type NodeCell,
} from '@sue/board-core';
import { createTestCellRegistry } from '../../../../tests/fixtures/plugins/registry';
import {
  captureAutoCalculationScope,
  createFrameAutoCalculationSession,
  prepareAutoCalculation,
  pruneAutoCalculationConfig,
  type FrameAutoCalculationConfig,
} from './frame-auto-calculation';
const registry = createTestCellRegistry();
const node = (id: string, x = 0, y = 0): NodeCell => ({
  id,
  cellType: 'node',
  kind: 'geometry',
  geometry: { x, y, width: 80, height: 40 },
});
const edge: EdgeCell = {
  id: 'e',
  cellType: 'edge',
  kind: 'arrow',
  source: { cellId: 'a', anchor: [1, 0.5] },
  target: { cellId: 'b', anchor: [0, 0.5] },
  route: { mode: 'auto' },
};
function fixture() {
  return applyCellOperations(
    createCellStore(createFrameCell('root')),
    [node('a'), node('b', 400, 200), node('outside', 2000, 0), edge].map(
      (cell) => ({ type: 'insert_cell', parentId: 'root', cell }),
    ),
    registry,
  );
}
const scope = (store = fixture()) =>
  captureAutoCalculationScope(store, { focus: ['root'], ids: ['a', 'b'] });
const change = (cell: NodeCell): CellOperation[] => [
  { type: 'replace_cell', cell },
];

describe('session auto calculation', () => {
  it('defaults off, shares logical frame settings, isolates files, and clears on close', () => {
    const session = createFrameAutoCalculationSession((frameId) =>
      frameId === 'root' ? 'file-a' : 'file-b',
    );
    const config: FrameAutoCalculationConfig = {
      layout: { scope: scope(), style: 'horizontal' },
    };
    expect(session.get('root')).toEqual({});
    session.set('root', config);
    expect(session.get('root')).toBe(config);
    expect(session.get('other')).toEqual({});
    session.clearFile('file-a');
    expect(session.get('root')).toEqual({});
    expect(createFrameAutoCalculationSession().get('root')).toEqual({});
  });
  it('preserves manual moves, ignores text, and layouts once on size changes in the captured selection', () => {
    const before = fixture(),
      config: FrameAutoCalculationConfig = {
        layout: { scope: scope(before), style: 'horizontal' },
      };
    const a = before.cells.a as NodeCell;
    const moved = change({ ...a, geometry: { ...a.geometry, x: 95, y: 85 } });
    expect(
      prepareAutoCalculation(before, moved, config, registry).operations,
    ).toEqual(moved);
    const text = change({ ...a, name: 'renamed' });
    expect(
      prepareAutoCalculation(before, text, config, registry).operations,
    ).toEqual(text);
    const sized = change({ ...a, geometry: { ...a.geometry, width: 140 } });
    const planned = prepareAutoCalculation(before, sized, config, registry);
    expect((planned.expected.cells.a as NodeCell).geometry.y).toBe(
      (planned.expected.cells.b as NodeCell).geometry.y,
    );
    expect(planned.expected.cells.outside).toBe(before.cells.outside);
    const runtime = createCellRuntime({ store: before }, registry);
    runtime.transact({
      id: 'resize-and-layout',
      operations: planned.operations,
    });
    expect(runtime.history.undos).toHaveLength(1);
    runtime.undo();
    expect(runtime.store).toEqual(before);
    runtime.redo();
    expect(runtime.store).toEqual(planned.expected);
  });
  it('optimizes after node changes, without moving nodes or reacting to authored points alone', () => {
    const before = fixture(),
      config: FrameAutoCalculationConfig = { edges: { scope: scope(before) } };
    const move = change({
      ...(before.cells.a as NodeCell),
      geometry: { ...(before.cells.a as NodeCell).geometry, x: 30 },
    });
    const planned = prepareAutoCalculation(before, move, config, registry);
    expect((planned.expected.cells.e as EdgeCell).route).toMatchObject({
      mode: 'orthogonal',
      points: expect.any(Array),
    });
    expect(planned.expected.cells.b).toBe(before.cells.b);
    const authored: CellOperation[] = [
      {
        type: 'replace_cell',
        cell: {
          ...edge,
          route: {
            mode: 'orthogonal',
            points: [
              [80, 20],
              [300, 20],
              [400, 220],
            ],
          },
        },
      },
    ];
    expect(
      prepareAutoCalculation(before, authored, config, registry).operations,
    ).toEqual(authored);
  });
  it('includes new group members and related boundary edges but does not expand a deleted selection', () => {
    const before = fixture();
    const grouped = applyCellOperations(
      before,
      groupCells(before, 'root', ['a', 'b'], 'g', registry),
      registry,
    );
    const groupScope = captureAutoCalculationScope(grouped, {
      focus: ['root'],
      ids: ['g'],
    });
    const group = grouped.cells.g;
    if (group.cellType !== 'group') throw new Error('group');
    const operations: CellOperation[] = [
      {
        type: 'insert_cell',
        parentId: 'root',
        index: 2,
        cell: node('new', 200, 500),
      },
      {
        type: 'replace_cell',
        cell: { ...group, members: [...group.members, 'new'] },
      },
    ];
    const planned = prepareAutoCalculation(
      grouped,
      operations,
      { layout: { scope: groupScope, style: 'horizontal' } },
      registry,
    );
    expect((planned.expected.cells.new as NodeCell).geometry.y).toBe(
      (planned.expected.cells.a as NodeCell).geometry.y,
    );
    expect(planned.expected.cells.outside).toEqual(before.cells.outside);
    const empty = captureAutoCalculationScope(before, {
      focus: ['root'],
      ids: ['outside'],
    });
    const deleted: CellOperation[] = [
      { type: 'remove_cell', cellId: 'outside' },
    ];
    expect(
      prepareAutoCalculation(
        before,
        deleted,
        { layout: { scope: empty, style: 'vertical' } },
        registry,
      ).operations,
    ).toEqual(deleted);
  });
  it('plans nodes before routes, leaves source immutable, and rejects a conflicting candidate atomically', () => {
    const before = fixture(),
      original = JSON.stringify(before);
    const config: FrameAutoCalculationConfig = {
      layout: { scope: scope(before), style: 'horizontal' },
      edges: { scope: scope(before) },
    };
    const operations = change({
      ...(before.cells.a as NodeCell),
      geometry: { ...(before.cells.a as NodeCell).geometry, width: 120 },
    });
    const planned = prepareAutoCalculation(
      before,
      operations,
      config,
      registry,
    );
    const path = (planned.expected.cells.e as EdgeCell).route;
    expect(path).toMatchObject({ mode: 'orthogonal' });
    if ('points' in path) expect(path.points?.[0]).toEqual([120, 20]);
    expect(JSON.stringify(before)).toBe(original);
    const obstacle = node('outside', 230, 0);
    const blocked = applyCellOperations(before, change(obstacle), registry);
    expect(() =>
      prepareAutoCalculation(blocked, operations, config, registry),
    ).toThrow('layout-overlap');
    expect(blocked.cells.outside).toEqual(obstacle);
  });
});

it('prunes accepted deletions without enlarging a frozen scope', () => {
  const before = fixture();
  const config: FrameAutoCalculationConfig = {
    layout: { scope: scope(before), style: 'horizontal' },
    edges: { scope: scope(before) },
  };
  const after = applyCellOperations(
    before,
    [
      { type: 'remove_cell', cellId: 'e' },
      { type: 'remove_cell', cellId: 'a' },
    ],
    registry,
  );
  const pruned = pruneAutoCalculationConfig(after, config);
  expect(pruned.layout?.scope.ids).toEqual(['b']);
  expect(pruned.edges?.scope.ids).toEqual(['b']);
  expect(config.layout?.scope.ids).toEqual(['a', 'b']);
});

it('retains frozen object identities through grouping', () => {
  const before = fixture();
  const config: FrameAutoCalculationConfig = {
    layout: { scope: scope(before), style: 'horizontal' },
  };
  const grouped = applyCellOperations(
    before,
    groupCells(before, 'root', ['a', 'b'], 'g', registry),
    registry,
  );
  expect(pruneAutoCalculationConfig(grouped, config)).toBe(config);
});
