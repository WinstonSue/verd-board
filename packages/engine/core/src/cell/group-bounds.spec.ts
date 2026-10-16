import { afterEach, describe, expect, it, vi } from 'vitest';
import * as routing from '../geometry/edge';
import { applyCellOperations, groupCells } from './index';
import { cellArrangementBounds, groupBounds, unionCellBounds } from './group';
import {
  createCellStore,
  createFrameCell,
  type EdgeCell,
  type NodeCell,
} from './types';

afterEach(() => vi.restoreAllMocks());

const arrow = (id: string, y: number): EdgeCell => ({
  id,
  kind: 'arrow',
  cellType: 'edge',
  source: { point: [0, y] },
  target: { point: [440, y] },
  route: { mode: 'auto' },
});
const fixture = () => {
  let store = applyCellOperations(createCellStore(createFrameCell('root')), [
    {
      type: 'insert_cell',
      parentId: 'root',
      cell: {
        id: 'obstacle',
        cellType: 'node',
        kind: 'geometry',
        geometry: { x: 160, y: -50, width: 100, height: 160 },
      },
    },
    ...Array.from({ length: 8 }, (_, i) => ({
      type: 'insert_cell' as const,
      parentId: 'root',
      cell: arrow(`edge-${i}`, i * 5),
    })),
  ]);
  store = applyCellOperations(
    store,
    groupCells(store, 'root', ['edge-0', 'edge-1'], 'inner'),
  );
  store = applyCellOperations(
    store,
    groupCells(store, 'root', ['inner', 'edge-2', 'edge-3'], 'middle'),
  );
  store = applyCellOperations(
    store,
    groupCells(
      store,
      'root',
      ['middle', 'edge-4', 'edge-5', 'edge-6', 'edge-7'],
      'outer',
    ),
  );
  return store;
};

describe('group route bounds', () => {
  it('plans a Frame once for all nested-group arrows and includes their obstacle detours', () => {
    const store = fixture();
    const context = routing.createEdgeRoutingContext(store, 'root');
    const expected = unionCellBounds(
      Array.from({ length: 8 }, (_, i) =>
        routing
          .edgePolyline(
            store,
            store.cells[`edge-${i}`] as EdgeCell,
            undefined,
            context,
          )
          .map(([x, y]) => ({ x, y, width: 0, height: 0 })),
      ).flat(),
    );
    const create = vi.spyOn(routing, 'createEdgeRoutingContext');
    const polyline = vi.spyOn(routing, 'edgePolyline');
    const bounds = groupBounds(store, 'outer')!;
    expect(bounds).toEqual(expected);
    expect(bounds.y < 0 || bounds.y + bounds.height > 35).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(polyline).toHaveBeenCalledTimes(8);
    const shared = create.mock.results[0].value;
    expect(polyline.mock.calls.every((call) => call[3] === shared)).toBe(true);
    expect(shared.routes.size).toBe(8);

    const obstacle = store.cells.obstacle as NodeCell;
    const moved = applyCellOperations(store, [
      {
        type: 'replace_cell',
        cell: {
          ...obstacle,
          geometry: { ...obstacle.geometry, y: 300 },
        },
      },
    ]);
    const next = groupBounds(moved, 'outer')!;
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.results[1].value).not.toBe(shared);
    expect(next).not.toEqual(bounds);
  });

  it('uses independent Frame contexts for separate groups', () => {
    let store = fixture();
    store = applyCellOperations(store, [
      { type: 'insert_cell', parentId: 'root', cell: createFrameCell('other') },
      { type: 'insert_cell', parentId: 'other', cell: arrow('other-1', 0) },
      { type: 'insert_cell', parentId: 'other', cell: arrow('other-2', 40) },
    ]);
    store = applyCellOperations(
      store,
      groupCells(store, 'other', ['other-1', 'other-2'], 'other-group'),
    );
    const create = vi.spyOn(routing, 'createEdgeRoutingContext');
    groupBounds(store, 'outer');
    expect(groupBounds(store, 'other-group')).toEqual({
      x: 0,
      y: 0,
      width: 440,
      height: 40,
    });
    expect(create.mock.calls.map((call) => call[1])).toEqual(['root', 'other']);
  });

  it('keeps fixed curves, rotated nodes and Frame shells in bounds without routing hidden or nested content', () => {
    let store = applyCellOperations(createCellStore(createFrameCell('root')), [
      {
        type: 'insert_cell',
        parentId: 'root',
        cell: {
          id: 'rotated',
          kind: 'geometry',
          cellType: 'node',
          geometry: {
            x: 10,
            y: 10,
            width: 40,
            height: 20,
            rotation: Math.PI / 2,
          },
        },
      },
      {
        type: 'insert_cell',
        parentId: 'root',
        cell: createFrameCell('shell', {
          x: 100,
          y: 100,
          width: 80,
          height: 60,
        }),
      },
      { type: 'insert_cell', parentId: 'shell', cell: arrow('nested', -1000) },
      {
        type: 'insert_cell',
        parentId: 'root',
        cell: {
          ...arrow('hidden', -2000),
          hidden: true,
        },
      },
      {
        type: 'insert_cell',
        parentId: 'root',
        cell: {
          id: 'curve',
          kind: 'arrow',
          cellType: 'edge',
          source: { point: [0, 0] },
          target: { point: [80, 0] },
          route: {
            mode: 'curve',
            points: [
              [0, 0],
              [40, 80],
              [80, 0],
            ],
          },
        } as EdgeCell,
      },
    ]);
    store = applyCellOperations(
      store,
      groupCells(
        store,
        'root',
        ['rotated', 'shell', 'hidden', 'curve'],
        'group',
      ),
    );
    const create = vi.spyOn(routing, 'createEdgeRoutingContext');
    expect(cellArrangementBounds(store, 'group')).toEqual({
      x: 0,
      y: 0,
      width: 180,
      height: 160,
    });
    expect(create).not.toHaveBeenCalled();
    const curve = cellArrangementBounds(store, 'curve')!;
    expect(curve.height).toBeGreaterThan(0);
    expect(curve.height).toBeLessThanOrEqual(80);
  });
});
