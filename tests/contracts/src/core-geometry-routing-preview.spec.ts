import { expect, it, vi } from 'vitest';
import {
  createCellStore,
  createFrameCell,
  type EdgeCell,
  type NodeCell,
} from '../../../packages/engine/core/src/cell/types';
import { createTestCellRegistry } from '../../fixtures/plugins/registry';
import {
  createEdgeRoutingContext,
  edgePolyline,
} from '../../../packages/engine/core/src/geometry/edge';
import * as obstacles from '../../../packages/engine/core/src/geometry/obstacle-route';
const registry = createTestCellRegistry();
it('records settled versus lightweight preview workloads for package and dense diagrams', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { resolve, dirname } = await import('node:path');
  const architecture = JSON.parse(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../fixtures/diagrams/architecture-packages.json',
      ),
      'utf8',
    ),
  ).store;
  const frame = createFrameCell('root'),
    dense = createCellStore(frame);
  for (let i = 0; i < 60; i++) {
    const id = `n${i}`;
    dense.cells[id] = {
      id,
      cellType: 'node',
      kind: 'geometry',
      geometry: {
        x: (i % 10) * 300,
        y: Math.floor(i / 10) * 180,
        width: 80,
        height: 40,
      },
    };
    frame.children.push(id);
  }
  for (let i = 0; i < 120; i++) {
    const id = `e${i}`;
    dense.cells[id] = {
      id,
      cellType: 'edge',
      kind: 'arrow',
      source: { cellId: `n${i % 60}` },
      target: { cellId: `n${(i + 11 + Math.floor(i / 60)) % 60}` },
      route: { mode: 'auto' },
    };
    frame.children.push(id);
  }
  const { frameEdgeCrossingJumps } =
    await import('../../../packages/engine/core/src/geometry/edge-crossings');
  for (const [name, store] of [
    ['packages', architecture],
    ['dense', dense],
  ] as const) {
    const edges = Object.values(store.cells).filter(
      (cell): cell is EdgeCell => (cell as EdgeCell).cellType === 'edge',
    );
    const movedNode = Object.values(store.cells).find(
      (cell): cell is NodeCell =>
        (cell as NodeCell).cellType === 'node' &&
        registry.get((cell as NodeCell).kind)?.routingObstacle !== false,
    )!;
    const base = createEdgeRoutingContext(
      store,
      store.rootId,
      undefined,
      undefined,
      registry,
    );
    edges.forEach((edge) => edgePolyline(store, edge, undefined, base));
    const times: number[] = [];
    const avoid = vi.spyOn(obstacles, 'routeOrthogonalAvoiding');
    for (const preview of [false, true]) {
      avoid.mockClear();
      const started = performance.now();
      for (let i = 0; i < 3; i++) {
        const moved = {
          ...store,
          cells: {
            ...store.cells,
            [movedNode.id]: {
              ...movedNode,
              geometry: {
                ...movedNode.geometry,
                x: movedNode.geometry.x + 10 * (i + 1),
              },
            },
          },
        };
        const routing = createEdgeRoutingContext(
          moved,
          store.rootId,
          undefined,
          base,
          registry,
          { preview },
        );
        edges.forEach((edge) => edgePolyline(moved, edge, undefined, routing));
        if (!preview) frameEdgeCrossingJumps(moved, store.rootId, routing);
      }
      times.push((performance.now() - started) / 3);
      expect(avoid.mock.calls.length > 0).toBe(!preview);
    }
    avoid.mockRestore();
    console.info(
      `[routing-preview] ${name}: ${edges.length} edges; full=${times[0].toFixed(2)}ms/frame, lightweight=${times[1].toFixed(2)}ms/frame`,
    );
    expect(times.every(Number.isFinite)).toBe(true);
  }
}, 20000);
