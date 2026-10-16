import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Routing from './obstacle-route';
import {
  createEdgeRoutingContext,
  edgePolyline,
  edgeRoutePoints,
} from './edge';
import { edgeLabelLayout } from './edge-label';
import {
  createCellStore,
  createFrameCell,
  type NodeCell,
  type EdgeCell,
  type CellStore,
} from '../cell/types';

const fixture = () => {
  const frame = createFrameCell('root'),
    store = createCellStore(frame);
  for (const [id, x, y] of [
    ['a', 0, 0],
    ['b', 400, 0],
    ['c', 180, -10],
  ] as const) {
    const cell: NodeCell = {
      id,
      kind: 'geometry',
      cellType: 'node',
      geometry: { x, y, width: 80, height: 60 },
    };
    store.cells[id] = cell;
    frame.children.push(id);
  }
  const edge: EdgeCell = {
    id: 'e',
    kind: 'arrow',
    cellType: 'edge',
    source: { cellId: 'a' },
    target: { cellId: 'b' },
    route: { mode: 'auto' },
    labels: [{ text: 'Label' }],
  };
  store.cells.e = edge;
  frame.children.push(edge.id);
  return store;
};
const prepare = (
  store: CellStore,
  previous?: ReturnType<typeof createEdgeRoutingContext>,
) => {
  const context = createEdgeRoutingContext(store, 'root', undefined, previous);
  context.prepare!();
  return context;
};
afterEach(() => vi.restoreAllMocks());
describe('geometry-based routing reuse', () => {
  it('skips routing for node/label text changes and keeps current edge and terminal wrappers', () => {
    const store = fixture(),
      first = prepare(store),
      edge = store.cells.e as EdgeCell;
    const points = first.routes.get('e')!.result.points;
    const find = vi.spyOn(Routing, 'routeOrthogonalAvoiding');
    const next = {
      ...store,
      cells: {
        ...store.cells,
        a: { ...(store.cells.a as NodeCell), content: { label: 'Changed' } },
        e: { ...edge, labels: [{ text: 'Changed label' }] },
      },
    };
    const second = prepare(next, first);
    expect(find).not.toHaveBeenCalled();
    expect(second.routes.get('e')!.result.points).toBe(points);
    expect(second.routes.get('e')!.edge).toBe(next.cells.e);
    expect(second.terminals!.get('e')!.edge).toBe(next.cells.e);
    expect(edgePolyline(next, next.cells.e, undefined, second)).toBe(points);
  });
  it.each([
    'move',
    'resize',
    'rotate',
    'hidden',
    'port',
    'stroke',
    'fixed',
    'sibling',
    'clearance',
  ])('invalidates the batch when %s changes routing inputs', (change) => {
    const store = fixture(),
      first = prepare(store),
      next = structuredClone(store);
    const node = next.cells.c as NodeCell,
      edge = next.cells.e as EdgeCell;
    if (change === 'move') node.geometry.x += 30;
    if (change === 'resize') node.geometry.width += 30;
    if (change === 'rotate') node.geometry.rotation = 0.2;
    if (change === 'hidden') node.hidden = true;
    if (change === 'port') {
      (next.cells.a as NodeCell).ports = [
        { id: 'p', direction: 'both', side: 'bottom' },
      ];
      edge.source = { cellId: 'a', portId: 'p' };
    }
    if (change === 'stroke') edge.appearance = { strokeWidth: 8 };
    if (change === 'fixed' || change === 'sibling') {
      next.cells.other = {
        ...edge,
        id: 'other',
        route:
          change === 'fixed'
            ? {
                mode: 'orthogonal',
                points: [
                  [100, 70],
                  [300, 70],
                ],
              }
            : { mode: 'auto' },
      };
      (next.cells.root as ReturnType<typeof createFrameCell>).children.push(
        'other',
      );
    }
    const find = vi.spyOn(Routing, 'routeOrthogonalAvoiding');
    const second = createEdgeRoutingContext(next, 'root', undefined, first);
    if (change === 'clearance')
      Object.defineProperty(second, 'clearance', { value: 40 });
    second.prepare!();
    expect(find).toHaveBeenCalled();
  });
  it('keeps canonical results independent of fallback route overrides and unprepared contexts', () => {
    const store = fixture(),
      first = prepare(store),
      points = first.routes.get('e')!.result.points;
    edgeRoutePoints(
      store.cells.e as EdgeCell,
      { point: [10, 300], side: 'right' },
      { point: [410, 300], side: 'left' },
      first,
    );
    expect(first.routes.get('e')!.result.points).not.toBe(points);
    const find = vi.spyOn(Routing, 'routeOrthogonalAvoiding');
    expect(prepare(store, first).routes.get('e')!.result.points).toEqual(
      points,
    );
    expect(find).not.toHaveBeenCalled();
    const lazy = createEdgeRoutingContext(store, 'root');
    const oldPrepare = vi.spyOn(lazy, 'prepare');
    prepare(store, lazy);
    expect(oldPrepare).not.toHaveBeenCalled();
    expect(find).toHaveBeenCalled();
  });
  it('does not let mutations of published points or labels corrupt the next revision', () => {
    const store = fixture(),
      first = prepare(store),
      edge = store.cells.e as EdgeCell;
    const points = structuredClone(first.routes.get('e')!.result.points);
    const label = edgeLabelLayout(edge, 0, points, first),
      bounds = structuredClone(label);
    first.routes.get('e')!.result.points[0][0] += 1000;
    label.bounds.x += 1000;
    const find = vi.spyOn(Routing, 'routeOrthogonalAvoiding');
    const next = prepare(store, first);
    expect(next.routes.get('e')!.result.points).toEqual(points);
    expect(edgeLabelLayout(edge, 0, points, next)).toEqual(bounds);
    expect(find).not.toHaveBeenCalled();
  });
  it('reuses label layouts for identical batches but recomputes all labels when text changes', () => {
    const store = fixture(),
      first = prepare(store),
      edge = store.cells.e as EdgeCell;
    const old = edgeLabelLayout(
      edge,
      0,
      first.routes.get('e')!.result.points,
      first,
    );
    const second = prepare(store, first);
    expect(
      edgeLabelLayout(edge, 0, second.routes.get('e')!.result.points, second),
    ).toEqual(old);
    const next = {
      ...store,
      cells: {
        ...store.cells,
        e: { ...edge, labels: [{ text: 'A substantially longer label' }] },
      },
    };
    const third = prepare(next, second);
    expect(
      edgeLabelLayout(
        next.cells.e,
        0,
        third.routes.get('e')!.result.points,
        third,
      ),
    ).not.toBe(old);
    expect(third.routes.get('e')!.result.points).toBe(
      second.routes.get('e')!.result.points,
    );
  });
});
