import { describe, expect, it } from 'vitest';
import layeredFixture from '../../../../../tests/fixtures/diagrams/architecture-layered.json';
import flowFixture from '../../../../../tests/fixtures/diagrams/architecture-data-flow.json';
import { arrangeCells, arrangementAvailability } from './arrangement';
import { applyCellOperations, groupCells, setCellsLocked } from './index';
import {
  createCellStore,
  createFrameCell,
  isNodeCell,
  type CellStore,
  type FrameCell,
  type NodeCell,
  type ArchitectureLayerData,
} from './types';

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
  it.each(['architecture-layered', 'architecture-data-flow'])(
    'arranges %s without changing sizes, membership, topology or child order; repeated application is stable',
    (name) => {
      const store = fixture(name);
      const next = applyCellOperations(
        store,
        arrangeCells(store, 'diagram', [], 'layers'),
      );
      expect(next.cells.diagram).toEqual(store.cells.diagram);
      for (const cell of Object.values(store.cells)) {
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
        ).toBeGreaterThanOrEqual(95);
      for (const row of rows) {
        row.sort((a, b) => a.x - b.x);
        for (let i = 1; i < row.length; i++)
          expect(
            row[i].x - row[i - 1].x - row[i - 1].width,
          ).toBeGreaterThanOrEqual(47);
      }
      expect(arrangeCells(next, 'diagram', [], 'layers')).toEqual([]);
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
        arrangeCells(reversed, 'diagram', [], 'layers'),
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
    );
    store = applyCellOperations(
      store,
      groupCells(store, 'diagram', ['cell-1', 'cell-2'], 'apps'),
    );
    const ids = modules(store).map((cell) => cell.id);
    store = applyCellOperations(
      store,
      setCellsLocked(store, [ids.at(-1)!], true),
    );
    const next = applyCellOperations(
      store,
      arrangeCells(store, 'diagram', [], 'layers'),
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
      arrangeCells(store, 'diagram', selected, 'layers'),
    );
    for (const id of ids.filter((id) => !selected.includes(id)))
      expect(geometry(partial, id)).toEqual(geometry(store, id));
  });

  it('rejects architecture groups crossing layer boundaries', () => {
    let store = fixture('architecture-layered');
    store = applyCellOperations(
      store,
      groupCells(store, 'diagram', ['cell-1', 'cell-4'], 'cross'),
    );
    expect(
      arrangementAvailability(store, 'diagram', [], {
        type: 'layout',
        style: 'layers',
      }),
    ).toEqual({
      enabled: false,
      reason: 'A group crosses architecture layers',
    });
  });

  it('preserves workflow topology and rejects cycles including cycles created by grouping', () => {
    let store = createCellStore(createFrameCell('root'));
    store = applyCellOperations(store, [
      ...['start', 'a', 'b', 'c'].map((id, i) => ({
        type: 'insert_cell' as const,
        parentId: 'root',
        cell: {
          id,
          kind: i ? 'workflow-task' : 'workflow-start',
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
          source: { cellId: source },
          target: { cellId: target },
          route: { mode: 'auto' as const },
        },
      })),
    ]);
    const next = applyCellOperations(
      store,
      arrangeCells(store, 'root', [], 'flow'),
    );
    expect(['start', 'a', 'b', 'c'].map((id) => geometry(next, id).x)).toEqual([
      20, 20, 20, 20,
    ]);
    expect(['start', 'a', 'b', 'c'].map((id) => geometry(next, id).y)).toEqual([
      30, 166, 302, 438,
    ]);
    expect(arrangeCells(next, 'root', [], 'flow')).toEqual([]);
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['a', 'c'], 'cycle'),
    );
    expect(
      arrangementAvailability(store, 'root', [], {
        type: 'layout',
        style: 'flow',
      }).reason,
    ).toContain('cyclic');
  });
});
