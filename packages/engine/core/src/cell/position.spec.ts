import { describe, expect, it } from 'vitest';
import { applyCellOperations } from './index';
import {
  normalizeCellPositionOperations,
  roundNodePosition,
  roundNodeDimensions,
  roundNodeGeometry,
} from './position';
import { createCellRuntime } from './runtime';
import { translateCellSelection, groupCells } from './commands';
import { copyCellFragment, planCellPaste } from './clipboard';
import {
  createCellStore,
  createFrameCell,
  type NodeCell,
  type EdgeCell,
} from './types';

const fixture = () =>
  applyCellOperations(createCellStore(createFrameCell('root')), [
    {
      type: 'insert_cell',
      parentId: 'root',
      cell: {
        id: 'a',
        kind: 'geometry',
        cellType: 'node',
        geometry: {
          x: -10.4,
          y: 20.7,
          width: 80.5,
          height: 40.25,
          rotation: 0.37,
        },
      },
    },
    {
      type: 'insert_cell',
      parentId: 'root',
      cell: {
        id: 'b',
        kind: 'geometry',
        cellType: 'node',
        geometry: { x: 90.1, y: 21.2, width: 80, height: 40 },
      },
    },
  ]);

describe('authored integer positions', () => {
  it('rounds dimensions without hiding invalid sizes or changing angles', () => {
    expect(
      roundNodeGeometry({
        x: -0.3,
        y: 1.7,
        width: 80.5,
        height: 40.25,
        rotation: 0.37,
      }),
    ).toEqual({ x: 0, y: 2, width: 81, height: 40, rotation: 0.37 });
    const invalid = roundNodeDimensions({
      x: 0,
      y: 0,
      width: -0.2,
      height: NaN,
    });
    expect(invalid.width).toBe(-0.2);
    expect(Number.isNaN(invalid.height)).toBe(true);
  });

  it('normalizes new cells and dimension edits independently of legacy positions', () => {
    const store = fixture(),
      a = store.cells.a as NodeCell;
    const normalize = (type: 'replace_cell' | 'insert_cell') =>
      normalizeCellPositionOperations(store, [
        type === 'insert_cell'
          ? { type, parentId: 'root', cell: a }
          : { type, cell: { ...a, geometry: { ...a.geometry, width: 100.6 } } },
      ])[0];
    expect(normalize('insert_cell')).toMatchObject({
      cell: { geometry: { x: -10, y: 21, width: 81, height: 40 } },
    });
    expect(normalize('replace_cell')).toMatchObject({
      cell: { geometry: { x: -10.4, y: 20.7, width: 101, height: 40 } },
    });
    const operations = normalizeCellPositionOperations(store, [
      {
        type: 'patch_cells',
        cells: { a: { ...a, geometry: { ...a.geometry, height: 50.6 } } },
      },
    ]);
    const runtime = createCellRuntime({ store });
    runtime.transact({ id: 'resize', operations });
    expect((runtime.store.cells.a as NodeCell).geometry).toMatchObject({
      x: -10.4,
      y: 20.7,
      width: 81,
      height: 51,
    });
    runtime.undo();
    expect(runtime.store).toEqual(store);
  });
  it('rounds local placement without changing dimensions, rotation or invalid coordinates', () => {
    expect(
      roundNodePosition({
        x: -0.3,
        y: 1.7,
        width: 80.5,
        height: 40.25,
        rotation: 0.37,
      }),
    ).toEqual({ x: 0, y: 2, width: 80.5, height: 40.25, rotation: 0.37 });
    expect(
      Number.isNaN(roundNodePosition({ x: NaN, y: 0, width: 1, height: 1 }).x),
    ).toBe(true);
  });
  it('does not move an old fractional node when changing only its name', () => {
    const store = fixture();
    const a = store.cells.a as NodeCell;
    const operations = normalizeCellPositionOperations(store, [
      {
        type: 'replace_cell',
        cell: {
          ...a,
          geometry: { ...a.geometry },
          content: { label: 'renamed' },
        },
      },
    ]);
    expect((operations[0] as { cell: NodeCell }).cell.geometry).toEqual(
      a.geometry,
    );
  });
  it('rounds every group member once and undo restores the exact legacy coordinates', () => {
    const store = fixture();
    const runtime = createCellRuntime({
      store: applyCellOperations(
        store,
        groupCells(store, 'root', ['a', 'b'], 'group'),
      ),
    });
    const before = runtime.store;
    runtime.transact({
      id: 'move',
      operations: translateCellSelection(before, ['group', 'a'], [2.2, 3.8]),
    });
    expect((runtime.store.cells.a as NodeCell).geometry).toMatchObject({
      x: -8,
      y: 25,
      width: 80.5,
      height: 40.25,
    });
    expect((runtime.store.cells.b as NodeCell).geometry).toMatchObject({
      x: 92,
      y: 25,
    });
    runtime.undo();
    expect(runtime.store).toEqual(before);
  });
  it('snaps pasted placement but file opening preserves original positions', () => {
    const store = fixture();
    const fragment = copyCellFragment(store, ['a']);
    const request = {
      store,
      frameId: 'root',
      selectionIds: [],
      fragment,
      allocateId: () => 'copy',
      offset: [0, 0] as [number, number],
    };
    const pasted = planCellPaste({ ...request, intent: 'paste' }).operations[0];
    const opened = planCellPaste({ ...request, intent: 'open' }).operations[0];
    expect(pasted).toMatchObject({
      cell: { geometry: { x: -10, y: 21, width: 81, height: 40 } },
    });
    expect(opened).toMatchObject({ cell: { geometry: { x: -10.4, y: 20.7 } } });
  });
  it('snaps free terminals and manual points while retaining relative anchors and curve controls', () => {
    const store = fixture();
    const edge: EdgeCell = {
      id: 'edge',
      kind: 'arrow',
      cellType: 'edge',
      source: { cellId: 'a', anchor: [0.25, 0.75] },
      target: { point: [100.2, 80.7] },
      route: {
        mode: 'curve',
        points: [
          [0.2, 0.4],
          [50.5, 70.25],
          [100.2, 80.7],
        ],
      },
    };
    const curve = normalizeCellPositionOperations(store, [
      { type: 'insert_cell', parentId: 'root', cell: edge },
    ])[0];
    expect(curve).toMatchObject({
      cell: {
        source: edge.source,
        target: { point: [100, 81] },
        route: {
          mode: 'curve',
          points: [
            [0.2, 0.4],
            [50.5, 70.25],
            [100, 81],
          ],
        },
      },
    });
    const manual = normalizeCellPositionOperations(store, [
      {
        type: 'insert_cell',
        parentId: 'root',
        cell: {
          ...edge,
          route: {
            mode: 'fixed',
            points: [
              [0.2, 0.4],
              [50.5, 70.25],
            ],
          },
        },
      },
    ])[0];
    expect(manual).toMatchObject({
      cell: {
        route: {
          points: [
            [0, 0],
            [51, 70],
          ],
        },
      },
    });
  });
});
