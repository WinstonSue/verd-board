import { describe, expect, it } from 'vitest';
import {
  createCellRegistry,
  createCellRuntime,
  createEdgeRoutingContext,
  edgePolyline,
  type EdgeCell,
} from '@sue/board-core';
import {
  registerArchitectureCells,
  layoutArchitectureCells,
} from './cell-utils';
import {
  createArchitectureFrameSnapshot,
  createArchitectureLayerCell,
  createArchitectureModuleCell,
  addArchitectureModule,
} from './cell-commands';

describe('architecture long-edge routing', () => {
  it('avoids modules across eleven transparent layers without moving any geometry', () => {
    const registry = createCellRegistry();
    registerArchitectureCells(registry);
    const r = createCellRuntime(
      createArchitectureFrameSnapshot('frame', 'layer-0'),
      registry,
    );
    for (let i = 0; i < 11; i++) {
      if (i)
        r.transact({
          id: `layer-${i}`,
          operations: [
            {
              type: 'insert_cell',
              parentId: 'frame',
              cell: createArchitectureLayerCell(
                `layer-${i}`,
                String(i).padStart(4, '0'),
              ),
            },
          ],
        });
      for (let j = 0; j < (i >= 7 ? 2 : 1); j++) {
        const module = createArchitectureModuleCell(
          `module-${i}-${j}`,
          i === 6 ? 'decision' : 'box',
        );
        r.transact({
          id: module.id,
          operations: addArchitectureModule(r.store, `layer-${i}`, module),
        });
      }
    }
    const edge: EdgeCell = {
      id: 'stateUp-rerender',
      kind: 'architecture-edge',
      cellType: 'edge',
      source: { cellId: 'module-5-0' },
      target: { cellId: 'module-9-1' },
      route: { mode: 'orthogonal' },
    };
    r.transact({
      id: 'edge',
      operations: [{ type: 'insert_cell', parentId: 'frame', cell: edge }],
    });
    const before = structuredClone(r.store),
      geometry = layoutArchitectureCells(r.store, 'frame');
    const context = createEdgeRoutingContext(r.store, 'frame', geometry);
    expect(context.obstacles).toHaveLength(15);
    const points = edgePolyline(r.store, edge, geometry, context);
    expect(context.routes.get(edge.id)?.result.status).not.toBe('blocked');
    for (let i = 1; i < points.length; i++)
      for (const box of context.obstacles) {
        if (box.id === 'module-5-0' || box.id === 'module-9-1') continue;
        const a = points[i - 1],
          b = points[i];
        const hit =
          a[1] === b[1]
            ? a[1] > box.y &&
              a[1] < box.y + box.height &&
              Math.max(a[0], b[0]) > box.x &&
              Math.min(a[0], b[0]) < box.x + box.width
            : a[0] > box.x &&
              a[0] < box.x + box.width &&
              Math.max(a[1], b[1]) > box.y &&
              Math.min(a[1], b[1]) < box.y + box.height;
        expect(hit, `crosses ${box.id}`).toBe(false);
      }
    expect(r.store).toEqual(before);
    expect(layoutArchitectureCells(r.store, 'frame')).toEqual(geometry);
  });
});
