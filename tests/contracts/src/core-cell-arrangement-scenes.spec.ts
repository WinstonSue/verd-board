import { describe, expect, it } from 'vitest';
import flowFixture from '../../fixtures/diagrams/architecture-data-flow.json';
import layeredFixture from '../../fixtures/diagrams/architecture-layered.json';
import { createTestCellRegistry as createFixtureRegistry } from '../../fixtures/plugins/registry';
import { type ArchitectureLayerData } from '../../../packages/engine/architecture/src/public-api';
import {
  arrangeCells,
  arrangementAvailability,
} from '../../../packages/engine/core/src/cell/arrangement';
import {
  applyCellOperations,
  groupCells,
  setCellsLocked,
} from '../../../packages/engine/core/src/cell/index';
import { planCellLayout } from '../../../packages/engine/core/src/cell/layout-plan';
import {
  createCellStore,
  createDocumentReferenceCell,
  createFrameCell,
  isNodeCell,
  type CellStore,
  type FrameCell,
  type NodeCell,
} from '../../../packages/engine/core/src/cell/types';
const testCellRegistry = createFixtureRegistry();
const fixture = (name: string): CellStore =>
  structuredClone(
    name === 'architecture-layered' ? layeredFixture.store : flowFixture.store,
  ) as CellStore;
const geometry = (store: CellStore, id: string) =>
  (store.cells[id] as NodeCell).geometry;
const modules = (store: CellStore) =>
  Object.values(store.cells).filter(
    (cell): cell is NodeCell =>
      isNodeCell(cell) && cell.kind === 'architecture-module',
  );
describe('authored graph layouts', () => {
  it('keeps document cards outside a specialized layout and ignores derived transparent layer bands', () => {
    let store = fixture('architecture-layered');
    const card = createDocumentReferenceCell(
      'layout-card',
      'external-document',
      { x: -2000, y: -2000, width: 400, height: 200 },
    );
    store = applyCellOperations(
      store,
      [{ type: 'insert_cell', parentId: 'diagram', cell: card }],
      testCellRegistry,
    );
    const operations = planCellLayout(
      store,
      { focus: [store.rootId, 'diagram'], ids: [] },
      'layers',
      testCellRegistry,
    );
    expect(operations.length).toBeGreaterThan(0);
    const next = applyCellOperations(store, operations, testCellRegistry);
    expect(next.cells[card.id]).toEqual(card);
    expect(
      planCellLayout(
        next,
        { focus: [store.rootId, 'diagram'], ids: [] },
        'layers',
        testCellRegistry,
      ),
    ).toEqual([]);
  });
  it.each(['architecture-layered', 'architecture-data-flow'])(
    'arranges %s without changing sizes, membership, topology or child order; repeated application is stable',
    (name) => {
      const store = fixture(name);
      const next = applyCellOperations(
        store,
        arrangeCells(store, 'diagram', [], 'layers', 32, testCellRegistry),
        testCellRegistry,
      );
      expect(next.cells.diagram).toEqual(store.cells.diagram);
      for (const cell of Object.values(store.cells)) {
        if (cell.kind === 'architecture-layer') {
          const layer = next.cells[cell.id] as NodeCell<ArchitectureLayerData>;
          expect(layer.data).toEqual((cell as NodeCell).data);
          expect(layer.content).toEqual((cell as NodeCell).content);
          expect(layer.geometry.derived).toBe(false);
          for (const id of layer.data!.memberIds) {
            const member = geometry(next, id);
            expect(member.x).toBeGreaterThanOrEqual(layer.geometry.x + 20);
            expect(member.y).toBeGreaterThanOrEqual(layer.geometry.y + 44);
            expect(member.x + member.width).toBeLessThanOrEqual(
              layer.geometry.x + layer.geometry.width - 20,
            );
            expect(member.y + member.height).toBeLessThanOrEqual(
              layer.geometry.y + layer.geometry.height - 16,
            );
          }
          continue;
        }
        if (cell.kind !== 'architecture-module') {
          expect(next.cells[cell.id]).toEqual(cell);
          continue;
        }
        expect(geometry(next, cell.id).width).toBe(
          geometry(store, cell.id).width,
        );
        expect(geometry(next, cell.id).height).toBe(
          geometry(store, cell.id).height,
        );
      }
      const rows = Object.values(next.cells)
        .filter(
          (cell): cell is NodeCell<ArchitectureLayerData> =>
            isNodeCell(cell) && cell.kind === 'architecture-layer',
        )
        .sort((a, b) => a.data!.order.localeCompare(b.data!.order))
        .map((layer) => layer.data!.memberIds.map((id) => geometry(next, id)));
      for (let i = 1; i < rows.length; i++)
        expect(
          Math.min(...rows[i].map((g) => g.y)) -
            Math.max(...rows[i - 1].map((g) => g.y + g.height)),
        ).toBeGreaterThanOrEqual(159);
      for (const row of rows) {
        row.sort((a, b) => a.x - b.x);
        for (let i = 1; i < row.length; i++)
          expect(
            row[i].x - row[i - 1].x - row[i - 1].width,
          ).toBeGreaterThanOrEqual(95);
      }
      expect(
        arrangeCells(next, 'diagram', [], 'layers', 32, testCellRegistry),
      ).toEqual([]);
      const reversed: CellStore = {
        ...store,
        cells: {
          ...Object.fromEntries(Object.entries(store.cells).reverse()),
          diagram: {
            ...(store.cells.diagram as FrameCell),
            children: [
              ...(store.cells.diagram as FrameCell).children,
            ].reverse(),
          },
        },
      };
      const reordered = applyCellOperations(
        reversed,
        arrangeCells(reversed, 'diagram', [], 'layers', 32, testCellRegistry),
        testCellRegistry,
      );
      for (const cell of modules(next))
        expect(geometry(reordered, cell.id)).toEqual(cell.geometry);
    },
  );
  it('keeps group interiors and locked or unselected modules in place', () => {
    let store = fixture('architecture-layered');
    store = applyCellOperations(
      store,
      modules(store).map((cell) => ({
        type: 'replace_cell' as const,
        cell: {
          ...cell,
          geometry: {
            ...cell.geometry,
            x: Math.round(cell.geometry.x),
            y: Math.round(cell.geometry.y),
          },
        },
      })),
      testCellRegistry,
    );
    store = applyCellOperations(
      store,
      groupCells(
        store,
        'diagram',
        ['cell-1', 'cell-2'],
        'apps',
        testCellRegistry,
      ),
      testCellRegistry,
    );
    const ids = modules(store).map((cell) => cell.id);
    store = applyCellOperations(
      store,
      setCellsLocked(store, [ids.at(-1)!], true),
      testCellRegistry,
    );
    const next = applyCellOperations(
      store,
      arrangeCells(store, 'diagram', [], 'layers', 32, testCellRegistry),
      testCellRegistry,
    );
    const delta = (id: string) => [
      geometry(next, id).x - geometry(store, id).x,
      geometry(next, id).y - geometry(store, id).y,
    ];
    expect(delta('cell-1')).toEqual(delta('cell-2'));
    expect(geometry(next, ids.at(-1)!)).toEqual(geometry(store, ids.at(-1)!));
    const selected = ids.slice(2, 6);
    const partial = applyCellOperations(
      store,
      arrangeCells(store, 'diagram', selected, 'layers', 32, testCellRegistry),
      testCellRegistry,
    );
    for (const id of ids.filter((id) => !selected.includes(id)))
      expect(geometry(partial, id)).toEqual(geometry(store, id));
  });
  it('rejects architecture groups crossing layer boundaries', () => {
    let store = fixture('architecture-layered');
    store = applyCellOperations(
      store,
      groupCells(
        store,
        'diagram',
        ['cell-1', 'cell-4'],
        'cross',
        testCellRegistry,
      ),
      testCellRegistry,
    );
    expect(
      arrangementAvailability(
        store,
        'diagram',
        [],
        {
          type: 'layout',
          style: 'layers',
        },
        testCellRegistry,
      ),
    ).toEqual({
      enabled: false,
      reason: 'A group crosses architecture layers',
    });
  });
  it('preserves workflow topology and rejects cycles including cycles created by grouping', () => {
    let store = createCellStore(createFrameCell('root'));
    store = applyCellOperations(
      store,
      [
        ...['start', 'a', 'b', 'c'].map((id, i) => ({
          type: 'insert_cell' as const,
          parentId: 'root',
          cell: {
            id,
            kind: i ? 'workflow-task' : 'workflow-start',
            ports: [
              {
                id: 'out',
                side: 'bottom' as const,
                direction: 'output' as const,
              },
              { id: 'in', side: 'top' as const, direction: 'input' as const },
            ],
            data: i
              ? undefined
              : {
                  graphMode: 'dag',
                  origin: [20, 30],
                  memberIds: ['start', 'a', 'b', 'c'],
                },
            cellType: 'node' as const,
            geometry: { x: 20 + i * 10, y: 30 + i * 20, width: 80, height: 40 },
          },
        })),
        ...[
          ['start', 'a'],
          ['a', 'b'],
          ['b', 'c'],
        ].map(([source, target], i) => ({
          type: 'insert_cell' as const,
          parentId: 'root',
          cell: {
            id: `edge-${i}`,
            kind: 'workflow-edge',
            cellType: 'edge' as const,
            source: { cellId: source, portId: 'out' },
            target: { cellId: target, portId: 'in' },
            route: { mode: 'auto' as const },
          },
        })),
      ],
      testCellRegistry,
    );
    const next = applyCellOperations(
      store,
      arrangeCells(store, 'root', [], 'flow', 32, testCellRegistry),
      testCellRegistry,
    );
    expect(['start', 'a', 'b', 'c'].map((id) => geometry(next, id).x)).toEqual([
      20, 20, 20, 20,
    ]);
    expect(['start', 'a', 'b', 'c'].map((id) => geometry(next, id).y)).toEqual([
      30, 230, 430, 630,
    ]);
    expect(
      arrangeCells(next, 'root', [], 'flow', 32, testCellRegistry),
    ).toEqual([]);
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['a', 'c'], 'cycle', testCellRegistry),
      testCellRegistry,
    );
    expect(
      arrangementAvailability(
        store,
        'root',
        [],
        {
          type: 'layout',
          style: 'flow',
        },
        testCellRegistry,
      ).reason,
    ).toContain('cyclic');
  });
});
