import { describe, expect, it } from 'vitest';
import { createCellStore, createFrameCell, type EdgeCell } from './types';
import type { Point } from '../interfaces/point';
import { applyCellOperations } from './index';
import {
  snapEdgeTerminal,
  replaceEdgeTerminal,
  moveEdgeRoutePoint,
  moveEdgeSegment,
  polylineClosestPosition,
  bindEdgeRouteTerminals,
} from './edge-edit';
import { edgePolyline } from '../geometry/edge';
import { normalizeCellPositionOperations } from './position';
describe('native edge editing', () => {
  const store = applyCellOperations(createCellStore(createFrameCell('root')), [
    {
      type: 'insert_cell',
      parentId: 'root',
      cell: {
        id: 'a',
        kind: 'geometry',
        cellType: 'node',
        geometry: {
          x: 100,
          y: 100,
          width: 160,
          height: 100,
          outline: 'diamond',
        },
        ports: [{ id: 'right', side: 'right', direction: 'both' }],
      },
    },
    { type: 'insert_cell', parentId: 'root', cell: createFrameCell('nested') },
    {
      type: 'insert_cell',
      parentId: 'nested',
      cell: {
        id: 'b',
        kind: 'geometry',
        cellType: 'node',
        geometry: { x: 400, y: 100, width: 100, height: 100 },
      },
    },
  ]);
  const edge: EdgeCell = {
    id: 'e',
    kind: 'arrow',
    cellType: 'edge',
    source: { point: [0, 0] },
    target: { point: [300, 0] },
    route: {
      mode: 'fixed',
      points: [
        [0, 0],
        [100, 0],
        [300, 0],
      ],
    },
  };
  it('snaps to actual ports or shape boundaries and never to another Frame child', () => {
    expect(snapEdgeTerminal(store, 'root', [259, 150], 'target')).toEqual({
      cellId: 'a',
      portId: 'right',
    });
    const anchor = snapEdgeTerminal(store, 'root', [180, 101], 'source');
    expect(anchor).toMatchObject({ cellId: 'a' });
    expect(snapEdgeTerminal(store, 'root', [450, 150], 'source')).toEqual({
      point: [450, 150],
    });
    expect(
      snapEdgeTerminal(store, 'root', [102, 102], 'source', 'arrow', 0),
    ).toEqual({ point: [102, 102] });
  });
  it('updates explicit route endpoints when binding and releasing an arrow', () => {
    const bound = replaceEdgeTerminal(store, edge, 'target', {
      cellId: 'a',
      portId: 'right',
    });
    expect(edgePolyline(store, bound).at(-1)).toEqual([260, 150]);
    const released = replaceEdgeTerminal(store, bound, 'target', {
      point: [600, 400],
    });
    expect(edgePolyline(store, released).at(-1)).toEqual([600, 400]);
    expect(edge.route).toEqual({
      mode: 'fixed',
      points: [
        [0, 0],
        [100, 0],
        [300, 0],
      ],
    });
  });
  it('keeps endpoints and orthogonality while moving a bend or segment', () => {
    const points: Point[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [300, 100],
    ];
    const orthogonal = {
      ...edge,
      route: { mode: 'orthogonal' as const, points },
    };
    for (const edited of [
      moveEdgeRoutePoint(orthogonal, points, 1, [80, -40]),
      moveEdgeSegment(orthogonal, points, 1, [160, 50]),
    ]) {
      if (!('points' in edited.route))
        throw new Error('Missing explicit route');
      const result = edited.route.points!;
      expect(result[0]).toEqual(points[0]);
      expect(result.at(-1)).toEqual(points.at(-1));
      result
        .slice(1)
        .forEach((point, i) =>
          expect(point[0] === result[i][0] || point[1] === result[i][1]).toBe(
            true,
          ),
        );
    }
  });
  it('adds curve controls and positions labels by distance along the route', () => {
    expect(
      moveEdgeSegment(
        { ...edge, route: { mode: 'curve' } },
        [
          [0, 0],
          [300, 0],
        ],
        0,
        [150, 80],
      ).route,
    ).toEqual({
      mode: 'curve',
      points: [
        [0, 0],
        [150, 80],
        [300, 0],
      ],
    });
    expect(
      polylineClosestPosition(
        [
          [0, 0],
          [100, 0],
          [100, 100],
        ],
        [100, 50],
      ),
    ).toBe(0.75);
    expect(
      polylineClosestPosition(
        [
          [0, 0],
          [0, 0],
        ],
        [0, 0],
      ),
    ).toBe(0.5);
  });

  it('keeps distributed automatic attachment points when authoring a bend or segment', () => {
    const frame = createFrameCell('frame'),
      graph = createCellStore(frame);
    const cells = [
      {
        id: 'source',
        kind: 'geometry',
        cellType: 'node' as const,
        geometry: { x: 0, y: 0, width: 120, height: 100 },
      },
      {
        id: 'first',
        kind: 'geometry',
        cellType: 'node' as const,
        geometry: { x: 300, y: -60, width: 100, height: 60 },
      },
      {
        id: 'second',
        kind: 'geometry',
        cellType: 'node' as const,
        geometry: { x: 300, y: 120, width: 100, height: 60 },
      },
    ];
    for (const cell of cells) {
      graph.cells[cell.id] = cell;
      frame.children.push(cell.id);
    }
    for (const target of ['first', 'second']) {
      const connector: EdgeCell = {
        id: `edge-${target}`,
        kind: 'arrow',
        cellType: 'edge',
        source: { cellId: 'source' },
        target: { cellId: target },
        route: { mode: 'auto' },
      };
      graph.cells[connector.id] = connector;
      frame.children.push(connector.id);
    }
    const connector = graph.cells['edge-first'] as EdgeCell;
    const points = edgePolyline(graph, connector);
    expect(points[0][0]).toBe(120);
    expect(points[0][1]).toBeCloseTo(100 / 3);
    const bound = bindEdgeRouteTerminals(graph, connector, points);
    expect(bound.source).toMatchObject({ cellId: 'source' });
    if (!('cellId' in bound.source)) throw new Error('Missing bound source');
    expect(bound.source.anchor![0]).toBe(1);
    expect(bound.source.anchor![1]).toBeCloseTo(1 / 3);
    for (const edited of [
      moveEdgeRoutePoint(bound, points, 1, [
        points[1][0] + 16,
        points[1][1] + 12,
      ]),
      moveEdgeSegment(bound, points, 1, [points[1][0] + 16, points[1][1] + 12]),
    ]) {
      const normalized = normalizeCellPositionOperations(graph, [
        { type: 'replace_cell', cell: edited },
      ])[0];
      if (normalized.type !== 'replace_cell')
        throw new Error('Missing edited edge');
      const route = edgePolyline(graph, normalized.cell as EdgeCell);
      expect(route[0]).toEqual(points[0]);
      expect(route.at(-1)).toEqual(points.at(-1));
      route
        .slice(1)
        .forEach((point, i) =>
          expect(point[0] === route[i][0] || point[1] === route[i][1]).toBe(
            true,
          ),
        );
    }
    expect(connector.source).toEqual({ cellId: 'source' });
    for (const mode of ['curve', 'straight', 'fixed'] as const) {
      const authored = { ...connector, route: { mode, points } };
      expect(bindEdgeRouteTerminals(graph, authored, points)).toBe(authored);
    }
    const explicit = {
      ...connector,
      source: { cellId: 'source', portId: 'right' },
      target: { cellId: 'first', anchor: [0, 0.5] as Point },
    };
    expect(bindEdgeRouteTerminals(graph, explicit, points)).toBe(explicit);
  });
});
