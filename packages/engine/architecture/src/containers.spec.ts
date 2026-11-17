import { describe, expect, it } from 'vitest';
import {
  createCellRuntime,
  translateCellSelection,
  createEdgeRoutingContext,
  edgePolyline,
  edgeRoutingContextFor,
  validateCellStore,
  groupCells,
  frameLanes,
  planLaneDrop,
  updateCellAppearance,
  type EdgeCell,
  type NodeCell,
} from '@sue/board-core';
import { createCardCell } from '../../draw/src/cell-commands';
import { createSwimlaneCell } from '../../draw/src/cell-table';
import { createTestCellRegistry } from '../../../../tests/fixtures/plugins/registry';
import {
  addArchitectureModule,
  createArchitectureFrameSnapshot,
  createArchitectureLayerCell,
  createArchitectureModuleCell,
  moveArchitectureModuleToLayer,
} from './cell-commands';
import { layoutArchitectureCells } from './cell-utils';
import { layoutArchitectureEdges } from './relations';
import type { ArchitectureLayerData } from './types';
import { styleColorWorkspaceFixture } from '../../../../tests/fixtures/style-color-workspace';

function fixture() {
  const registry = createTestCellRegistry();
  const snapshot = createArchitectureFrameSnapshot('frame', 'a');
  const a = snapshot.store.cells.a as NodeCell;
  a.geometry = {
    ...a.geometry,
    x: 20,
    y: 30,
    width: 420,
    height: 240,
    derived: false,
  };
  const runtime = createCellRuntime(snapshot, registry);
  const b = createArchitectureLayerCell('b', '1');
  b.geometry = {
    ...b.geometry,
    x: 540,
    y: 30,
    width: 420,
    height: 240,
    derived: false,
  };
  runtime.transact({
    id: 'layers',
    operations: [{ type: 'insert_cell', parentId: 'frame', cell: b }],
  });
  const module = createArchitectureModuleCell('module');
  module.geometry = { ...module.geometry, x: 60, y: 110, derived: false };
  runtime.transact({
    id: 'member',
    operations: addArchitectureModule(runtime.store, 'a', module),
  });
  return { runtime, registry };
}
const memberIds = (runtime: ReturnType<typeof createCellRuntime>, id: string) =>
  (runtime.store.cells[id] as NodeCell<ArchitectureLayerData>).data!.memberIds;

describe('architecture spatial containers and typed relationships', () => {
  it('keeps an unrelated legacy container and partial-layer group unchanged through color edits and history', () => {
    const { store } = styleColorWorkspaceFixture();
    const registry = createTestCellRegistry();
    const runtime = createCellRuntime({ store }, registry);
    const before = runtime.store;
    expect(
      layoutArchitectureCells(before, 'style-legacy').get('style-layer')!.y,
    ).toBe(96);
    const unchanged = () => {
      for (const id of [
        'style-legacy',
        'style-layer',
        'style-member',
        'style-heading',
        'style-group',
      ])
        expect(runtime.store.cells[id]).toEqual(before.cells[id]);
    };
    for (const id of [
      'style-source',
      'style-member',
      'style-group',
      'style-layer',
    ]) {
      runtime.transact({
        id: `color-${id}`,
        operations: updateCellAppearance(runtime.store, [id], {
          styleColor: 'series-5',
        }),
      });
      expect(
        (
          runtime.store.cells[
            id === 'style-group' ? 'style-member' : id
          ] as NodeCell
        ).appearance?.styleColor,
      ).toBe('series-5');
      for (const [cellId, cell] of Object.entries(before.cells)) {
        const next = runtime.store.cells[cellId];
        if ('geometry' in cell)
          expect((next as NodeCell).geometry).toEqual(cell.geometry);
      }
      if (id === 'style-source') unchanged();
      runtime.undo();
      expect(runtime.store).toEqual(before);
      runtime.redo();
      runtime.transact({
        id: `auto-${id}`,
        operations: updateCellAppearance(runtime.store, [id], {
          styleColor: undefined,
        }),
      });
      expect(
        (
          runtime.store.cells[
            id === 'style-group' ? 'style-member' : id
          ] as NodeCell
        ).appearance?.styleColor,
      ).toBeUndefined();
      runtime.undo();
      runtime.undo();
      expect(runtime.store).toEqual(before);
    }
    expect(() =>
      runtime.transact({
        id: 'partial-layer-move',
        operations: [
          {
            type: 'replace_cell',
            cell: {
              ...(before.cells['style-layer'] as NodeCell),
              geometry: {
                ...(before.cells['style-layer'] as NodeCell).geometry,
                x: 60,
              },
            },
          },
        ],
      }),
    ).toThrow('Ungroup first to move part of a group');
    expect(runtime.store).toEqual(before);
  });
  it('materializes legacy geometry only when a layout input changes', () => {
    const { store } = styleColorWorkspaceFixture();
    const runtime = createCellRuntime({ store }, createTestCellRegistry());
    const before = runtime.store;
    const member = before.cells['style-member'] as NodeCell;
    runtime.transact({
      id: 'manual-colors',
      operations: updateCellAppearance(before, [member.id], {
        fill: '#ffffff',
        strokeColor: '#123456',
      }),
    });
    expect((runtime.store.cells['style-layer'] as NodeCell).geometry).toEqual(
      (before.cells['style-layer'] as NodeCell).geometry,
    );
    runtime.undo();
    runtime.transact({
      id: 'resize-member',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...member, geometry: { ...member.geometry, width: 700 } },
        },
      ],
    });
    expect(
      (runtime.store.cells['style-layer'] as NodeCell).geometry.width,
    ).toBeGreaterThan((before.cells['style-layer'] as NodeCell).geometry.width);
    runtime.undo();
    expect(runtime.store).toEqual(before);
  });
  it('preserves derived members and layer bounds when only their appearance is replaced', () => {
    const { store } = styleColorWorkspaceFixture();
    const layer = store.cells['style-layer'] as NodeCell;
    const member = store.cells['style-member'] as NodeCell;
    layer.geometry = { ...layer.geometry, derived: true };
    member.geometry = { ...member.geometry, derived: true };
    member.data = { shape: 'box' };
    const runtime = createCellRuntime({ store }, createTestCellRegistry());
    const before = runtime.store;
    runtime.transact({
      id: 'derived-color',
      operations: updateCellAppearance(
        before,
        ['style-member', 'style-layer'],
        { styleColor: 'series-5' },
      ),
    });
    for (const id of ['style-member', 'style-layer']) {
      expect((runtime.store.cells[id] as NodeCell).geometry).toEqual(
        (before.cells[id] as NodeCell).geometry,
      );
      expect((runtime.store.cells[id] as NodeCell).data).toEqual(
        (before.cells[id] as NodeCell).data,
      );
    }
    runtime.undo();
    expect(runtime.store).toEqual(before);
  });
  it('keeps old swimlanes editable while moving layer members between tracks', () => {
    const { runtime, registry } = fixture();
    const lane = createSwimlaneCell(
      'legacy-lanes',
      [
        [0, 0],
        [1100, 800],
      ],
      'horizontal',
      false,
      2,
    );
    lane.data!.laneMembers = {};
    runtime.transact({
      id: 'legacy-lanes',
      operations: [{ type: 'insert_cell', parentId: 'frame', cell: lane }],
    });
    runtime.transact({
      id: 'assign-track',
      operations: planLaneDrop(
        runtime.store,
        'frame',
        ['module'],
        [{ type: 'replace_cell', cell: runtime.store.cells.module }],
        registry,
      ),
    });
    expect(frameLanes(runtime.store, 'frame', registry)[0].members).toEqual([
      'module',
    ]);
    runtime.transact({
      id: 'carry-to-next-track',
      operations: translateCellSelection(
        runtime.store,
        ['a'],
        [0, 400],
        registry,
      ),
    });
    const tracks = frameLanes(runtime.store, 'frame', registry);
    expect(tracks[0].members).toEqual([]);
    expect(tracks[1].members).toEqual(['module']);
    expect(memberIds(runtime, 'a')).toEqual(['module']);
    expect(validateCellStore(runtime.store, registry)).toEqual([]);
    runtime.undo();
    expect(frameLanes(runtime.store, 'frame', registry)[0].members).toEqual([
      'module',
    ]);
  });
  it('rejects moving half a cross-layer group and transfers the whole group as one unit', () => {
    const { runtime, registry } = fixture();
    const second = createArchitectureModuleCell('second');
    second.geometry = { ...second.geometry, x: 580, y: 110, derived: false };
    runtime.transact({
      id: 'second',
      operations: addArchitectureModule(runtime.store, 'b', second),
    });
    runtime.transact({
      id: 'group',
      operations: groupCells(
        runtime.store,
        'frame',
        ['module', 'second'],
        'group',
        registry,
      ),
    });
    const before = runtime.store;
    expect(() =>
      translateCellSelection(runtime.store, ['a'], [20, 0], registry),
    ).toThrow();
    expect(runtime.store).toBe(before);
    runtime.transact({
      id: 'group-move',
      operations: translateCellSelection(
        runtime.store,
        ['group'],
        [0, 400],
        registry,
      ),
    });
    expect(memberIds(runtime, 'a')).toEqual([]);
    expect(memberIds(runtime, 'b')).toEqual([]);
    expect((runtime.store.cells.module as NodeCell).geometry.y).toBe(510);
    expect((runtime.store.cells.second as NodeCell).geometry.y).toBe(510);
    runtime.undo();
    expect(runtime.store).toEqual(before);
  });
  it('routes layer relationships around complete intervening containers after a geometry update', () => {
    const { runtime, registry } = fixture();
    runtime.transact({
      id: 'space-layers',
      operations: translateCellSelection(
        runtime.store,
        ['b'],
        [460, 0],
        registry,
      ),
    });
    const blocker = createArchitectureLayerCell('blocker', '2');
    blocker.geometry = {
      ...blocker.geometry,
      x: 600,
      y: 0,
      width: 200,
      height: 360,
      derived: false,
    };
    const edge: EdgeCell = {
      id: 'across',
      kind: 'architecture-edge',
      cellType: 'edge',
      source: { cellId: 'a', portId: 'right' },
      target: { cellId: 'b', portId: 'left' },
      route: { mode: 'orthogonal' },
      data: { relation: 'flow' },
    };
    runtime.transact({
      id: 'setup-routing',
      operations: [blocker, edge].map((cell) => ({
        type: 'insert_cell',
        parentId: 'frame',
        cell,
      })),
    });
    let context = createEdgeRoutingContext(
      runtime.store,
      'frame',
      undefined,
      undefined,
      registry,
    );
    const assertClear = () => {
      const points = edgePolyline(
        runtime.store,
        runtime.store.cells.across as EdgeCell,
        undefined,
        context,
      );
      const box = (runtime.store.cells.blocker as NodeCell).geometry;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        const cuts =
          a[1] === b[1]
            ? a[1] > box.y &&
              a[1] < box.y + box.height &&
              Math.max(a[0], b[0]) > box.x &&
              Math.min(a[0], b[0]) < box.x + box.width
            : a[0] > box.x &&
              a[0] < box.x + box.width &&
              Math.max(a[1], b[1]) > box.y &&
              Math.min(a[1], b[1]) < box.y + box.height;
        expect(cuts).toBe(false);
      }
      expect(context.routes.get(edge.id)?.result.status).not.toBe('blocked');
      return points;
    };
    const first = assertClear();
    runtime.transact({
      id: 'grow-blocker',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...blocker,
            geometry: { ...blocker.geometry, y: -160, height: 700 },
          },
        },
      ],
    });
    context = createEdgeRoutingContext(
      runtime.store,
      'frame',
      undefined,
      context,
      registry,
    );
    expect(assertClear()).not.toEqual(first);
  });
  it('keeps a visible layer as the scene anchor', () => {
    const { runtime } = fixture();
    runtime.transact({
      id: 'hide-other',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...runtime.store.cells.b, hidden: true },
        },
      ],
    });
    const before = runtime.store;
    expect(() =>
      runtime.transact({
        id: 'hide-last',
        operations: [
          {
            type: 'replace_cell',
            cell: { ...runtime.store.cells.a, hidden: true },
          },
        ],
      }),
    ).toThrow('last visible');
    expect(runtime.store).toBe(before);
  });
  it('moves a container and an explicitly selected member once, preserving free cards and undo', () => {
    const { runtime, registry } = fixture();
    runtime.transact({
      id: 'card',
      operations: [
        {
          type: 'insert_cell',
          parentId: 'frame',
          cell: createCardCell('note', [[80, 140]], 'Responsibilities'),
        },
      ],
    });
    const before = structuredClone(runtime.store);
    runtime.transact({
      id: 'move',
      operations: translateCellSelection(
        runtime.store,
        ['a', 'module'],
        [120, 80],
        registry,
      ),
    });
    expect((runtime.store.cells.module as NodeCell).geometry).toMatchObject({
      x: 180,
      y: 190,
    });
    expect((runtime.store.cells.a as NodeCell).geometry).toMatchObject({
      x: 140,
      y: 110,
    });
    expect(runtime.store.cells.note).toEqual(before.cells.note);
    expect(memberIds(runtime, 'a')).toEqual(['module']);
    runtime.undo();
    expect(runtime.store).toEqual(before);
  });
  it('releases a partially outside member without chasing it and supports a later full drop into another layer', () => {
    const { runtime, registry } = fixture();
    const bounds = (runtime.store.cells.a as NodeCell).geometry;
    runtime.transact({
      id: 'out',
      operations: translateCellSelection(
        runtime.store,
        ['module'],
        [300, 0],
        registry,
      ),
    });
    expect(memberIds(runtime, 'a')).toEqual([]);
    expect((runtime.store.cells.a as NodeCell).geometry).toEqual(bounds);
    runtime.transact({
      id: 'in',
      operations: translateCellSelection(
        runtime.store,
        ['module'],
        [230, 0],
        registry,
      ),
    });
    expect(memberIds(runtime, 'b')).toEqual(['module']);
    expect(validateCellStore(runtime.store, registry)).toEqual([]);
    runtime.transact({
      id: 'detach',
      operations: moveArchitectureModuleToLayer(runtime.store, 'module', null),
    });
    expect(memberIds(runtime, 'b')).toEqual([]);
  });
  it('grows for member resizing and rejects a container move with a locked member', () => {
    const { runtime, registry } = fixture();
    const module = runtime.store.cells.module as NodeCell;
    runtime.transact({
      id: 'grow',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...module,
            geometry: { ...module.geometry, width: 600, height: 300 },
          },
        },
      ],
    });
    expect(memberIds(runtime, 'a')).toEqual(['module']);
    expect((runtime.store.cells.a as NodeCell).geometry.width).toBeGreaterThan(
      620,
    );
    runtime.transact({
      id: 'lock',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...runtime.store.cells.module, locked: true },
        },
      ],
    });
    expect(
      translateCellSelection(runtime.store, ['a'], [20, 0], registry),
    ).toEqual([]);
  });
  it('prepares old ports without mutating the supplied snapshot and commits them on first connection', () => {
    const { runtime, registry } = fixture();
    const snapshot = structuredClone(runtime.snapshot);
    delete (snapshot.store.cells.a as NodeCell).ports;
    const before = JSON.stringify(snapshot);
    const old = createCellRuntime(snapshot, registry);
    expect((old.store.cells.a as NodeCell).ports).toHaveLength(4);
    expect(JSON.stringify(snapshot)).toBe(before);
    const edge: EdgeCell = {
      id: 'layer-edge',
      kind: 'architecture-edge',
      cellType: 'edge',
      source: { cellId: 'a', portId: 'right' },
      target: { cellId: 'b', portId: 'left' },
      route: { mode: 'orthogonal' },
      data: { relation: 'dependency' },
    };
    old.transact({
      id: 'connect',
      operations: [{ type: 'insert_cell', parentId: 'frame', cell: edge }],
    });
    const visual = layoutArchitectureEdges(old.store, 'frame').get(edge.id)!;
    expect(visual.appearance).toMatchObject({
      strokeStyle: 'dashed',
      strokeWidth: 2.5,
    });
    const routing = createEdgeRoutingContext(
      old.store,
      'frame',
      layoutArchitectureCells(old.store, 'frame'),
      undefined,
      registry,
    );
    expect(
      edgeRoutingContextFor(routing, edge).obstacles.some((b) => b.id === 'a'),
    ).toBe(true);
    expect(
      edgePolyline(old.store, edge, undefined, routing).length,
    ).toBeGreaterThanOrEqual(2);
    expect(routing.routes.get(edge.id)?.result.status).not.toBe('blocked');
    expect(
      registry.validateEdge(old.store, {
        ...edge,
        target: { cellId: 'module' },
      }),
    ).toBeTruthy();
    const flow = layoutArchitectureEdges(
      {
        ...old.store,
        cells: {
          ...old.store.cells,
          [edge.id]: { ...edge, data: { relation: 'flow' } },
        },
      },
      'frame',
    ).get(edge.id)!;
    expect(flow.appearance?.strokeStyle).toBe('solid');
    expect(flow.data).toMatchObject({ targetMarker: 'solid-triangle' });
    const legacy = { ...edge, data: undefined };
    expect(
      layoutArchitectureEdges(
        { ...old.store, cells: { ...old.store.cells, [edge.id]: legacy } },
        'frame',
      ).get(edge.id),
    ).toBe(legacy);
  });
});
