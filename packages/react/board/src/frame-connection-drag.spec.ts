import {
  createCellStore,
  createFrameCell,
  nodeShapeGeometry,
  resolveAnchor,
  snapTerminal,
  unrotateNodePoint,
  type Anchor,
  type EdgeCell,
  type NodeCell,
  type NodeGeometry,
  type Point,
} from '@sue/board-core';
import { describe, expect, it } from 'vitest';
import { createTestCellRegistry } from '../../../../tests/fixtures/plugins/registry';
import { createWorkflowStartCell } from '../../../engine/workflow/src/cell-commands';
import {
  createArchitectureFrameSnapshot,
  createArchitectureLayerCell,
  createArchitectureModuleCell,
} from '../../../engine/architecture/src/cell-commands';
import {
  connectionDragState,
  connectionPreviewAnchor,
  projectConnectionOutline,
  resolveConnectionDrag,
} from './frame-connection-drag';

const fixture = () => {
  const frame = createFrameCell('root');
  const store = createCellStore(frame);
  const node: NodeCell = {
    id: 'node',
    cellType: 'node',
    kind: 'workflow-task',
    geometry: { x: 0, y: 0, width: 160, height: 100, outline: 'rectangle' },
    ports: (['top', 'right', 'bottom', 'left'] as const).map((side) => ({
      id: side,
      side,
      direction: 'both',
    })),
  };
  const other = {
    ...node,
    id: 'other',
    geometry: { ...node.geometry, x: 400 },
  };
  const graph = createWorkflowStartCell('graph', [-200, -100]);
  graph.data!.memberIds = ['graph', 'node', 'other'];
  const edge: EdgeCell = {
    id: 'edge',
    cellType: 'edge',
    kind: 'workflow-edge',
    source: { cellId: 'node', portId: 'top' },
    target: { cellId: 'other', portId: 'left' },
    route: { mode: 'auto' },
  };
  Object.assign(store.cells, { graph, node, other, edge });
  frame.children = ['graph', 'node', 'other', 'edge'];
  const registry = createTestCellRegistry();
  const state = connectionDragState(edge.source);
  const options = {
    store,
    frameId: frame.id,
    edge,
    end: 'source' as const,
    scale: 1,
    registry,
    state,
    query: () => frame.children,
    getGeometry: (id: string) => {
      const cell = store.cells[id];
      return cell?.cellType === 'node' || cell?.cellType === 'frame'
        ? cell.geometry
        : undefined;
    },
    locked: () => false,
  };
  const move = (point: Point, commit = false) =>
    resolveConnectionDrag({ ...options, point, commit });
  return { ...options, frame, node, other, move };
};

describe('manual connection outline dragging', () => {
  it('skips an enclosing layer when a module edge targets the module inside it', () => {
    const snapshot = createArchitectureFrameSnapshot('root', 'layer');
    const store = snapshot.store;
    const frame = store.cells.root;
    if (frame.cellType !== 'frame') throw new Error('Expected frame');
    const layer = createArchitectureLayerCell('layer', '0');
    layer.geometry = {
      ...layer.geometry,
      x: 300,
      y: 0,
      width: 400,
      height: 300,
      derived: false,
    };
    const source = createArchitectureModuleCell('source');
    source.geometry = { ...source.geometry, x: 0, y: 100, derived: false };
    const target = createArchitectureModuleCell('target');
    target.geometry = { ...target.geometry, x: 400, y: 100, derived: false };
    layer.data!.memberIds = [target.id];
    Object.assign(store.cells, { layer, source, target });
    frame.children = ['source', 'target', 'layer'];
    const edge: EdgeCell = {
      id: 'draft',
      kind: 'architecture-edge',
      cellType: 'edge',
      route: { mode: 'orthogonal' },
      source: { cellId: source.id, portId: 'right' },
      target: { point: [400, 130] },
      data: { relation: 'dependency' },
    };
    const result = resolveConnectionDrag({
      store,
      frameId: frame.id,
      edge,
      end: 'target',
      point: [400, 130],
      scale: 1,
      registry: createTestCellRegistry(),
      state: {},
      commit: true,
      query: () => frame.children,
      getGeometry: (id) => (store.cells[id] as NodeCell).geometry,
      locked: () => false,
    });
    expect(result.terminal).toEqual({ cellId: 'target', portId: 'left' });
  });
  it('follows the interior without the Workflow default-side jump', () => {
    const test = fixture();
    expect(test.registry.validateEdge(test.store, test.edge)).toBeUndefined();
    expect(
      snapTerminal(
        test.store,
        'root',
        [100, 12.5],
        'source',
        'workflow-edge',
        18,
        test.registry,
        undefined,
        { terminal: test.edge.target, edgeId: test.edge.id },
      ),
    ).toEqual({ cellId: 'node', portId: 'right' });
    expect(test.move([80, 0]).terminal).toEqual({
      cellId: 'node',
      portId: 'top',
    });
    for (const [pointer, expected] of [
      [
        [100, 12.5],
        [102.917631, 7.0294416],
      ],
      [
        [120, 25],
        [120, 25],
      ],
      [
        [140, 37.5],
        [140, 37.5],
      ],
    ] as [Point, Point][]) {
      const terminal = test.move(pointer).terminal!;
      expect(terminal).toMatchObject({
        cellId: 'node',
        anchor: expect.any(Array),
      });
      expect(terminal).not.toHaveProperty('portId');
      const point = resolveAnchor(
        test.node.geometry,
        'anchor' in terminal ? terminal.anchor! : [0, 0],
      ).point;
      expect(point[0]).toBeCloseTo(expected[0], 4);
      expect(point[1]).toBeCloseTo(expected[1], 4);
    }
    expect(test.move([156, 47.5]).terminal).toEqual({
      cellId: 'node',
      portId: 'right',
    });
    expect(test.move([140, 37.5], true).terminal).toEqual({
      cellId: 'node',
      portId: 'right',
    });
    expect(test.move([100, 12.5], true).terminal).toEqual({
      cellId: 'node',
      portId: 'top',
    });
  });

  it('uses pointer distance and distinct enter/release radii with stable re-entry', () => {
    const test = fixture();
    expect(test.move([160, 59]).terminal).toHaveProperty('portId', 'right');
    expect(test.move([160, 63]).terminal).toHaveProperty('portId', 'right');
    expect(test.move([160, 65]).terminal).not.toHaveProperty('portId');
    expect(test.move([160, 61]).terminal).not.toHaveProperty('portId');
    expect(test.move([160, 59]).terminal).toHaveProperty('portId', 'right');
    // The radial projection is exactly on top, but the pointer is far from it.
    expect(test.move([80, 45]).terminal).not.toHaveProperty('portId');
    expect(test.move([80, 50]).terminal).toHaveProperty('anchor', [0.5, 0.5]);
    expect(test.move([176, 50]).nodeId).toBe('node');
    expect(test.move([180, 50]).nodeId).toBeNull();
    expect(test.state).toEqual({
      nodeId: undefined,
      snappedPortId: undefined,
      lastSnappedPortId: undefined,
      anchor: undefined,
    });
  });

  it.each([0.25, 0.5, 2, 4])(
    'keeps magnetic distances in screen pixels at scale %s',
    (scale) => {
      const test = fixture();
      const resolve = (distance: number) =>
        resolveConnectionDrag({
          ...test,
          scale,
          point: [160 + distance / scale, 50],
        });
      expect(resolve(9).terminal).toHaveProperty('portId', 'right');
      expect(resolve(13).terminal).toHaveProperty('portId', 'right');
      expect(resolve(15).terminal).not.toHaveProperty('portId');
      expect(resolve(11).terminal).not.toHaveProperty('portId');
      expect(resolve(9).terminal).toHaveProperty('portId', 'right');
    },
  );

  it('chooses the nearest legal port at release and honors remembered ties', () => {
    const test = fixture();
    test.move([80, 0]);
    expect(test.move([80, 50], true).terminal).toHaveProperty('portId', 'top');
    test.state.lastSnappedPortId = undefined;
    expect(test.move([80, 50], true).terminal).toHaveProperty(
      'portId',
      'bottom',
    );
    test.node.ports![0].direction = 'input';
    test.node.ports![1].maxConnections = 0;
    expect(test.move([80, 0], true).terminal).toHaveProperty('portId', 'left');
  });

  it.each(['workflow-edge', 'arrow'])(
    'keeps an unavailable target visible and cancels %s release instead of leaving a free endpoint',
    (kind) => {
      const test = fixture();
      test.edge.kind = kind;
      for (const port of test.node.ports!) port.maxConnections = 0;
      const before = structuredClone(test.store);
      const preview = test.move([100, 12.5]);
      expect(preview).toMatchObject({
        nodeId: 'node',
        terminal: { cellId: 'node', anchor: expect.any(Array) },
      });
      expect(preview.terminal).not.toHaveProperty('portId');
      expect(test.move([100, 12.5], true).terminal).toBeNull();
      expect(test.store).toEqual(before);
    },
  );

  it('rejects domain-invalid releases and keeps existing blank-space behavior', () => {
    const test = fixture();
    const self = resolveConnectionDrag({
      ...test,
      end: 'target',
      point: [80, 0],
      commit: true,
    });
    expect(self.terminal).toBeNull();
    expect(test.move([300, 200], true).terminal).toBeNull();
    const arrow = resolveConnectionDrag({
      ...test,
      edge: { ...test.edge, kind: 'arrow' },
      point: [300, 200],
      commit: true,
    });
    expect(arrow.terminal).toEqual({ point: [300, 200] });
    const locked = resolveConnectionDrag({
      ...test,
      point: [80, 0],
      locked: () => true,
    });
    expect(locked.nodeId).toBeNull();
    test.frame.children = test.frame.children.filter((id) => id !== 'node');
    const foreign = resolveConnectionDrag({
      ...test,
      point: [80, 0],
      query: () => ['node'],
    });
    expect(foreign.nodeId).toBeNull();
  });
});

describe('radial outline projection', () => {
  it.each(['vertical', 'horizontal'] as const)(
    'crosses the %s center continuously and follows interior pointer positions',
    (axis) => {
      const geometry: NodeGeometry = {
        x: 0,
        y: 0,
        width: 160,
        height: 100,
        outline: 'rectangle',
      };
      let previous: Point | undefined;
      for (let index = 0; index <= 400; index++) {
        const t = index / 400;
        const pointer: Point =
          axis === 'vertical' ? [80, t * 100] : [t * 160, 50];
        const anchor = connectionPreviewAnchor(geometry, pointer, 1);
        const point = resolveAnchor(geometry, anchor).point;
        if (t >= 0.25 && t <= 0.75) {
          expect(point[0]).toBeCloseTo(pointer[0], 5);
          expect(point[1]).toBeCloseTo(pointer[1], 5);
        }
        if (previous)
          expect(
            Math.hypot(point[0] - previous[0], point[1] - previous[1]),
          ).toBeLessThan(1);
        previous = point;
      }
    },
  );
  it.each([0.25, 1, 4])(
    'keeps rotated and small-node interior previews under the pointer at scale %s',
    (scale) => {
      for (const [width, height] of [
        [160, 100],
        [20, 10],
      ]) {
        const geometry = {
          x: 10,
          y: 20,
          width,
          height,
          rotation: Math.PI / 3,
          outline: 'ellipse',
        };
        for (const position of [
          [0.5, 0.5],
          [0.5, 0.4],
          [0.4, 0.5],
        ] as Anchor[]) {
          const pointer = resolveAnchor(geometry, position).point;
          const anchor = connectionPreviewAnchor(geometry, pointer, scale);
          expect(anchor[0]).toBeCloseTo(position[0], 5);
          expect(anchor[1]).toBeCloseTo(position[1], 5);
        }
      }
    },
  );
  it.each(['rectangle', 'roundRectangle', 'ellipse', 'diamond'])(
    'stays on the actual %s contour while rotating and reversing direction',
    (outline) => {
      for (const rotation of [0, Math.PI / 3]) {
        const geometry: NodeGeometry = {
          x: 10,
          y: 20,
          width: 160,
          height: 100,
          outline,
          rotation,
        };
        const shape = nodeShapeGeometry(outline)!;
        let previous: ReturnType<typeof projectConnectionOutline> | undefined;
        for (const t of [0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25, 0]) {
          const pointer = resolveAnchor(geometry, [
            0.5 + 0.5 * t,
            0.5 * t,
          ]).point;
          const anchor = projectConnectionOutline(geometry, pointer, previous);
          const point = resolveAnchor(geometry, anchor).point;
          expect(
            shape.hit(
              geometry,
              unrotateNodePoint(geometry, point),
              false,
              0.001,
            ),
          ).toBe(true);
          previous = anchor;
        }
        const center = resolveAnchor(geometry, [0.5, 0.5]).point;
        expect(projectConnectionOutline(geometry, center, previous)).toEqual(
          previous,
        );
      }
    },
  );
  it('retains the nearest-point fallback for open outlines', () => {
    const geometry = {
      x: 0,
      y: 0,
      width: 160,
      height: 100,
      outline: 'underline',
    };
    expect(projectConnectionOutline(geometry, [80, 40])).toEqual([0.5, 1]);
  });
});
