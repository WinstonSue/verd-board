import { describe, expect, it } from 'vitest';
import * as core from '../public-api';
import {
  anchorFromPoint,
  availablePorts,
  createCellStore,
  createFrameCell,
  isValidAnchor,
  portKey,
  resolveAnchor,
  resolvePort,
  resolveTerminal,
  terminalKey,
  type Anchor,
  type CellStore,
  type EdgeCell,
  type NodeCell,
  type Port,
  type Terminal,
} from '../public-api';

const ports: Port[] = [
  { id: 'input', side: 'left', direction: 'input' },
  { id: 'output', side: 'right', direction: 'output' },
  { id: 'limited', side: 'bottom', direction: 'both', maxConnections: 1 },
];
const makeStore = (): CellStore => {
  const frame = createFrameCell('root');
  const store = createCellStore(frame);
  const node: NodeCell = {
    id: 'node',
    kind: 'geometry',
    cellType: 'node',
    geometry: { x: 10, y: 20, width: 100, height: 80 },
    ports: structuredClone(ports),
  };
  const other: NodeCell = {
    ...node,
    id: 'other',
    geometry: { x: 310, y: 20, width: 100, height: 80 },
  };
  store.cells[node.id] = node;
  store.cells[other.id] = other;
  frame.children.push(node.id, other.id);
  return store;
};

describe('public connection models', () => {
  it('exports the new APIs without legacy aliases', () => {
    expect(core).toHaveProperty('resolveAnchor');
    expect(core).toHaveProperty('resolvePort');
    expect(core).toHaveProperty('resolveTerminal');
    expect(core).toHaveProperty('snapTerminal');
    expect(core).toHaveProperty('replaceTerminal');
    expect(core).toHaveProperty('bindRouteTerminals');
    for (const name of [
      'relativeAnchor',
      'portAnchor',
      'edgeTerminalPosition',
      'availableEdgePorts',
      'snapEdgeTerminal',
      'replaceEdgeTerminal',
      'bindEdgeRouteTerminals',
    ])
      expect(core).not.toHaveProperty(name);
  });

  it('uses stable, distinct identities even when IDs contain separators', () => {
    expect(portKey('a,b', 'c')).not.toBe(portKey('a', 'b,c'));
    expect(portKey('edge', 'source')).not.toBe(terminalKey('edge', 'source'));
    expect(terminalKey('edge', 'source')).not.toBe(
      terminalKey('edge', 'target'),
    );
  });
});

describe('anchors', () => {
  it.each([0, Math.PI / 2, Math.PI / 3, -Math.PI / 4])(
    'round-trips node-relative coordinates through rotation %s',
    (rotation) => {
      const geometry = { x: 20, y: 30, width: 120, height: 80, rotation };
      const anchor: Anchor = [-0.25, 1.5];
      const captured = anchorFromPoint(
        geometry,
        resolveAnchor(geometry, anchor).point,
      );
      expect(captured[0]).toBeCloseTo(anchor[0]);
      expect(captured[1]).toBeCloseTo(anchor[1]);
    },
  );

  it('projects onto the actual rotated outline when capturing an attachment', () => {
    const geometry = {
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      outline: 'diamond',
      rotation: Math.PI / 3,
    };
    const point = resolveAnchor(geometry, [1.2, 0.5]).point;
    const anchor = anchorFromPoint(geometry, point, { snapToOutline: true });
    expect(anchor[0]).toBeCloseTo(1);
    expect(anchor[1]).toBeCloseTo(0.5);
  });

  it('accepts finite out-of-bounds anchors and rejects malformed values', () => {
    expect(isValidAnchor([-0.25, 1.5])).toBe(true);
    for (const value of [
      [0],
      [0, 1, 2],
      [0, NaN],
      [Infinity, 0],
      ['0', 1],
      null,
    ])
      expect(isValidAnchor(value)).toBe(false);
  });
});

describe('port availability', () => {
  it('applies input/output direction, capacity and reconnection exclusion', () => {
    const store = makeStore();
    const node = store.cells['node'] as NodeCell;
    const names = (end: 'source' | 'target', excluding?: string) =>
      availablePorts(store, node, end, excluding).map((port) => port.id);
    expect(names('source')).toEqual(['output', 'limited']);
    expect(names('target')).toEqual(['input', 'limited']);
    const edge: EdgeCell = {
      id: 'edge',
      kind: 'arrow',
      cellType: 'edge',
      source: { cellId: node.id, portId: 'limited', anchor: [0.25, 1] },
      target: { cellId: node.id, portId: 'limited' },
      route: { mode: 'auto' },
    };
    store.cells[edge.id] = edge;
    expect(names('source')).toEqual(['output']);
    expect(names('target')).toEqual(['input']);
    expect(names('source', edge.id)).toEqual(['output', 'limited']);
    node.ports![2].maxConnections = 2;
    expect(names('target')).toEqual(['input', 'limited']);
  });
});

describe('terminal resolution', () => {
  it('uses anchor coordinates with the port exit side, including projected geometry', () => {
    const store = makeStore();
    const terminal: Terminal = {
      cellId: 'node',
      portId: 'output',
      anchor: [0.25, 0],
    };
    const geometry = new Map([
      [
        'node',
        { x: 100, y: 200, width: 160, height: 60, rotation: Math.PI / 2 },
      ],
    ]);
    const projected = geometry.get('node')!;
    const position = resolveTerminal(store, terminal, undefined, { geometry });
    expect(position?.point).toEqual(resolveAnchor(projected, [0.25, 0]).point);
    expect(position?.side).toBe('bottom');
    expect(position?.point).not.toEqual(resolvePort(projected, ports[1]).point);
    expect((store.cells['node'] as NodeCell).geometry.x).toBe(10);
  });

  it('distinguishes automatic facing and explicit center fallback policies', () => {
    const store = makeStore();
    const terminal: Terminal = { cellId: 'node' };
    const other: Terminal = { cellId: 'other' };
    expect(resolveTerminal(store, terminal, other)).toEqual({
      point: [110, 60],
      side: 'right',
    });
    expect(resolveTerminal(store, other, terminal)).toEqual({
      point: [310, 60],
      side: 'left',
    });
    expect(
      resolveTerminal(store, terminal, undefined, { automatic: 'center' }),
    ).toEqual({ point: [60, 60], side: 'right' });
    expect(resolveTerminal(store, terminal)).toBeUndefined();
  });

  it('resolves free points and anchors independently of an opposite terminal', () => {
    const store = makeStore();
    expect(resolveTerminal(store, { point: [12, 34] })).toEqual({
      point: [12, 34],
      side: 'right',
    });
    expect(
      resolveTerminal(store, { cellId: 'node', anchor: [-0.25, 0.5] }),
    ).toEqual({ point: [-15, 60], side: 'left' });
  });

  it('returns an unresolved result for missing or non-node hosts', () => {
    const store = makeStore();
    expect(resolveTerminal(store, { cellId: 'missing' })).toBeUndefined();
    store.cells['edge'] = {
      id: 'edge',
      kind: 'arrow',
      cellType: 'edge',
      source: { point: [0, 0] },
      target: { point: [100, 0] },
      route: { mode: 'straight' },
    };
    expect(
      resolveTerminal(store, { cellId: 'edge' }, { point: [200, 0] }),
    ).toBeUndefined();
  });
});
