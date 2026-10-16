import {
  createCellRegistry,
  createCellRuntime,
  createCellStore,
  createFrameCell,
} from '@sue/board-core';
import { registerDrawCells } from '../cell-utils';
import { describe, expect, it } from 'vitest';
import { createTableCell } from '../cell-commands';
import {
  createSwimlaneCell,
  entryAt,
  insertTableTrack,
  mergeTableRange,
  removeTableTrack,
  resizeTableTrack,
  setSwimlaneCount,
  setSwimlaneHeader,
  splitTableEntry,
  tableGrid,
  tableResizeSegments,
  tableSelectionRange,
  transposeSwimlane,
  updateTableText,
  validateTableData,
} from '../cell-table';
import { createBlockText } from '@sue/board-common';
const allocate = () => {
  let id = 0;
  return () => `generated-${id++}`;
};
const table = () =>
  createTableCell(
    'table',
    [
      [0, 0],
      [300, 180],
    ],
    3,
    3,
  );
describe('native table structure', () => {
  it('rejects an invalid grid atomically and restores every resize dimension through history', () => {
    const registry = createCellRegistry();
    registerDrawCells(registry);
    const runtime = createCellRuntime(
      { store: createCellStore(createFrameCell('root')) },
      registry,
    );
    const source = table();
    runtime.transact({
      id: 'create',
      operations: [{ type: 'insert_cell', cell: source, parentId: 'root' }],
    });
    const before = runtime.store;
    expect(() =>
      runtime.transact({
        id: 'invalid',
        operations: [
          {
            type: 'replace_cell',
            cell: {
              ...source,
              data: { ...source.data!, cells: source.data!.cells.slice(1) },
            },
          },
        ],
      }),
    ).toThrow(/cover/);
    expect(runtime.store).toBe(before);
    expect(runtime.history.undos).toHaveLength(1);
    const resized = resizeTableTrack(source, 'column', 1, 150);
    runtime.transact({
      id: 'resize',
      operations: [{ type: 'replace_cell', cell: resized }],
    });
    expect(runtime.store.cells[source.id]).toEqual(resized);
    runtime.undo();
    expect(runtime.store.cells[source.id]).toEqual(source);
    runtime.redo();
    expect(runtime.store.cells[source.id]).toEqual(resized);
  });

  it('retains a fixed swimlane heading width and distributes remaining width', () => {
    const lane = createSwimlaneCell('lane', [[0, 0]]);
    expect(tableGrid(lane).columns).toEqual([42, 482]);
    expect(validateTableData(lane)).toBeUndefined();
    expect(tableGrid(lane, { ...lane.geometry, width: 262 }).columns).toEqual([
      21, 241,
    ]);
  });
  it('excludes a merged swimlane title from column resize hit segments', () => {
    const lane = createSwimlaneCell('lane', [[0, 0]], 'vertical', true, 4);
    expect(tableResizeSegments(lane, 'column', 1)).toEqual([
      { start: 42, end: 524 },
    ]);
    const table = mergeTableRange(
      createTableCell(
        't',
        [
          [0, 0],
          [300, 180],
        ],
        3,
        3,
      ),
      { top: 0, left: 0, bottom: 1, right: 1 },
    );
    expect(tableResizeSegments(table, 'column', 0)).toEqual([
      { start: 120, end: 180 },
    ]);
  });
  it('resizes one track without redistributing neighbours or mutating the input', () => {
    const source = table(),
      before = structuredClone(source);
    const next = resizeTableTrack(source, 'column', 1, 150);
    expect(tableGrid(next).columns).toEqual([100, 150, 100]);
    expect(next.geometry.width).toBe(350);
    expect(source).toEqual(before);
    expect(tableGrid(resizeTableTrack(next, 'row', 0, 1)).rows[0]).toBe(20);
  });
  it('retains rich text on merge, expands inserted spans, and reanchors a deleted span origin', () => {
    const source = table(),
      ids = allocate();
    source.data!.cells[0].text = createBlockText('first');
    source.data!.cells[1].text = createBlockText('second');
    let next = mergeTableRange(source, {
      top: 0,
      left: 0,
      bottom: 1,
      right: 1,
    });
    expect(entryAt(next.data!, 1, 1)!.text!.plainText).toBe('first\nsecond');
    next = insertTableTrack(next, 'row', 1, ids);
    expect(entryAt(next.data!, 0, 0)!.rowspan).toBe(3);
    expect(validateTableData(next)).toBeUndefined();
    next = removeTableTrack(next, 'row', 0)!;
    expect(entryAt(next.data!, 0, 0)!.rowId).toBe(next.data!.rows[0].id);
    expect(validateTableData(next)).toBeUndefined();
    next = splitTableEntry(next, entryAt(next.data!, 0, 0)!.id, ids);
    expect(validateTableData(next)).toBeUndefined();
    expect(entryAt(next.data!, 0, 0)!.text!.plainText).toBe('first\nsecond');
  });
  it('expands a selection to cover every intersecting merged entry', () => {
    const next = mergeTableRange(table(), {
      top: 0,
      left: 0,
      bottom: 1,
      right: 1,
    });
    expect(
      tableSelectionRange(
        next.data!,
        entryAt(next.data!, 1, 2)!.id,
        entryAt(next.data!, 2, 0)!.id,
      ),
    ).toEqual({ top: 0, left: 0, bottom: 2, right: 2 });
  });
  it('rejects overlapping and incomplete grids and supports deleting the final track', () => {
    const source = table();
    expect(
      validateTableData({
        ...source,
        data: { ...source.data!, cells: source.data!.cells.slice(1) },
      }),
    ).toMatch(/cover/);
    expect(
      validateTableData({
        ...source,
        data: {
          ...source.data!,
          cells: [
            ...source.data!.cells,
            { ...source.data!.cells[0], id: 'duplicate' },
          ],
        },
      }),
    ).toMatch(/Overlapping/);
    let next = removeTableTrack(source, 'row', 2)!;
    next = removeTableTrack(next, 'row', 1)!;
    expect(removeTableTrack(next, 'row', 0)).toBeUndefined();
  });
  it('grows the correct track for block text in a vertical heading', () => {
    const source = createSwimlaneCell('lane', [[0, 0]]);
    const next = updateTableText(
      source,
      source.data!.cells[0].id,
      createBlockText('heading'),
      { width: 100, height: 80 },
    );
    expect(tableGrid(next).columns[0]).toBe(88);
    expect(next.geometry.height).toBe(source.geometry.height);
  });
});
describe('native swimlane changes', () => {
  for (const direction of ['horizontal', 'vertical'] as const) {
    it(`retains title, lane contents, ids and grid on ${direction} count changes`, () => {
      const source = createSwimlaneCell('lane', [[0, 0]], direction, true, 3),
        before = structuredClone(source),
        ids = allocate();
      const title = source.data!.cells.find((entry) => entry.role === 'title')!;
      const unchanged = setSwimlaneCount(source, 3, ids);
      expect(source).toEqual(before);
      expect(validateTableData(unchanged)).toBeUndefined();
      let next = setSwimlaneCount(source, 5, ids);
      expect(validateTableData(next)).toBeUndefined();
      expect(
        next.data!.cells.find((entry) => entry.id === title.id)!.text,
      ).toEqual(title.text);
      next = setSwimlaneCount(next, 1, ids);
      expect(validateTableData(next)).toBeUndefined();
      expect(next.data!.cells.filter((entry) => entry.text).length).toBe(2);
      expect(source).toEqual(before);
    });
    it(`toggles ${direction} title without losing lane text`, () => {
      const source = createSwimlaneCell('lane', [[0, 0]], direction),
        ids = allocate();
      const next = setSwimlaneHeader(source, true, ids);
      expect(validateTableData(next)).toBeUndefined();
      const restored = setSwimlaneHeader(next, false, ids);
      expect(validateTableData(restored)).toBeUndefined();
      for (const entry of source.data!.cells)
        expect(
          restored.data!.cells.find((item) => item.id === entry.id)?.text,
        ).toEqual(entry.text);
    });
  }
  it('preserves an intentionally empty lane heading and assigns new body roles', () => {
    const source = createSwimlaneCell('lane', [[0, 0]]);
    source.data!.cells[0].text = createBlockText('');
    const next = setSwimlaneCount(source, 4, allocate());
    expect(
      next.data!.cells.find((entry) => entry.id === source.data!.cells[0].id)!
        .text!.plainText,
    ).toBe('');
    expect(
      next.data!.cells.filter((entry) => entry.role === 'body'),
    ).toHaveLength(4);
    expect(
      next
        .data!.cells.filter((entry) => entry.role === 'body')
        .every((entry) => !entry.text),
    ).toBe(true);
  });
  it('transposes a merged title and restores authored geometry and content', () => {
    const source = createSwimlaneCell('lane', [[0, 0]], 'horizontal', true);
    const transposed = transposeSwimlane(source);
    expect(transposed.data!.cells[0].colspan).toBe(3);
    expect(validateTableData(transposed)).toBeUndefined();
    expect(transposeSwimlane(transposed)).toEqual({
      ...source,
      data: {
        ...source.data!,
        cells: source.data!.cells.map((entry) => ({
          ...entry,
          colspan: undefined,
          rowspan: entry.rowspan,
          textDirection: entry.textDirection,
        })),
      },
    });
  });
});
