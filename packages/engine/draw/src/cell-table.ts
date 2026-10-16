import type {
  CellOperation,
  NodeCell,
  NodeGeometry,
  Point,
  RectangleClient,
} from '@sue/board-core';
import { createBlockText, type BoardTextDocument } from '@sue/board-common';
import type { TableCellData, TableEntry } from './cell-commands';

export type TableTrack = 'row' | 'column';
export interface TableRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}
export interface TableEntryBounds extends RectangleClient {
  entry: TableEntry;
  row: number;
  column: number;
}
export const MIN_TABLE_TRACK_SIZE = 20;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
/** Explicit track sizes stay fixed; unspecified tracks share the remaining space. */
export function tableTrackSizes(
  items: { width?: number; height?: number }[],
  total: number,
  axis: TableTrack,
): number[] {
  const dimension = axis === 'row' ? 'height' : 'width';
  const fixed = items.map((item) => item[dimension]);
  const assigned = sum(
    fixed.filter((size): size is number => size !== undefined),
  );
  const flexible = fixed.filter((size) => size === undefined).length;
  const values = fixed.map(
    (size) => size ?? Math.max(1, (total - assigned) / Math.max(1, flexible)),
  );
  const measured = sum(values);
  // Rendering also handles a resize preview without mutating the authored sizes.
  return measured > total || !flexible
    ? values.map((size) => (size * total) / (measured || 1))
    : values;
}
export function tableGrid(
  cell: NodeCell<TableCellData>,
  geometry: NodeGeometry = cell.geometry,
) {
  const data = cell.data!;
  const rows = tableTrackSizes(data.rows, cell.geometry.height, 'row').map(
    (size) => (size * geometry.height) / (cell.geometry.height || 1),
  );
  const columns = tableTrackSizes(
    data.columns,
    cell.geometry.width,
    'column',
  ).map((size) => (size * geometry.width) / (cell.geometry.width || 1));
  const entries: TableEntryBounds[] = data.cells.flatMap((entry) => {
    const row = data.rows.findIndex((item) => item.id === entry.rowId),
      column = data.columns.findIndex((item) => item.id === entry.columnId);
    return row < 0 || column < 0
      ? []
      : [
          {
            entry,
            row,
            column,
            x: geometry.x + sum(columns.slice(0, column)),
            y: geometry.y + sum(rows.slice(0, row)),
            width: sum(columns.slice(column, column + (entry.colspan ?? 1))),
            height: sum(rows.slice(row, row + (entry.rowspan ?? 1))),
          },
        ];
  });
  return { rows, columns, entries };
}
export function validateTableData(
  cell: NodeCell<TableCellData>,
): string | undefined {
  const data = cell.data;
  if (
    !data ||
    !Array.isArray(data.rows) ||
    !Array.isArray(data.columns) ||
    !Array.isArray(data.cells) ||
    !data.rows.length ||
    !data.columns.length
  )
    return 'Table requires rows, columns and entries';
  const unique = (ids: string[]) =>
    ids.every((id) => typeof id === 'string' && !!id) &&
    new Set(ids).size === ids.length;
  if (
    !unique(data.rows.map((row) => row.id)) ||
    !unique(data.columns.map((column) => column.id)) ||
    !unique(data.cells.map((entry) => entry.id))
  )
    return 'Duplicate table track or entry id';
  if (
    data.rows.some(
      (row) =>
        row.height !== undefined &&
        (!Number.isFinite(row.height) || row.height <= 0),
    ) ||
    data.columns.some(
      (column) =>
        column.width !== undefined &&
        (!Number.isFinite(column.width) || column.width <= 0),
    )
  )
    return 'Invalid table track size';
  const occupied = new Set<string>();
  for (const entry of data.cells) {
    const r = data.rows.findIndex((row) => row.id === entry.rowId),
      c = data.columns.findIndex((column) => column.id === entry.columnId),
      rs = entry.rowspan ?? 1,
      cs = entry.colspan ?? 1;
    if (
      r < 0 ||
      c < 0 ||
      !Number.isInteger(rs) ||
      !Number.isInteger(cs) ||
      rs < 1 ||
      cs < 1 ||
      r + rs > data.rows.length ||
      c + cs > data.columns.length
    )
      return 'Invalid table entry range';
    for (let y = r; y < r + rs; y++)
      for (let x = c; x < c + cs; x++) {
        const key = `${y}:${x}`;
        if (occupied.has(key)) return 'Overlapping table entries';
        occupied.add(key);
      }
  }
  if (occupied.size !== data.rows.length * data.columns.length)
    return 'Table entries must cover the grid';
  if (
    cell.kind === 'swimlane' &&
    !['horizontal', 'vertical'].includes(data.direction ?? '')
  )
    return 'Swimlane requires a direction';
  return undefined;
}
const position = (data: TableCellData, entry: TableEntry) => ({
  top: data.rows.findIndex((row) => row.id === entry.rowId),
  left: data.columns.findIndex((column) => column.id === entry.columnId),
});
const intersects = (a: TableRange, b: TableRange) =>
  a.top <= b.bottom &&
  a.bottom >= b.top &&
  a.left <= b.right &&
  a.right >= b.left;
const entryRange = (data: TableCellData, entry: TableEntry): TableRange => {
  const { top, left } = position(data, entry);
  return {
    top,
    left,
    bottom: top + (entry.rowspan ?? 1) - 1,
    right: left + (entry.colspan ?? 1) - 1,
  };
};
export const entryAt = (data: TableCellData, row: number, column: number) =>
  data.cells.find((entry) => {
    const range = entryRange(data, entry);
    return (
      row >= range.top &&
      row <= range.bottom &&
      column >= range.left &&
      column <= range.right
    );
  });
export function tableSelectionRange(
  data: TableCellData,
  anchorId: string,
  focusId = anchorId,
): TableRange {
  const a = data.cells.find((entry) => entry.id === anchorId) ?? data.cells[0],
    b = data.cells.find((entry) => entry.id === focusId) ?? a;
  const ar = entryRange(data, a),
    br = entryRange(data, b);
  let range = {
    top: Math.min(ar.top, br.top),
    left: Math.min(ar.left, br.left),
    bottom: Math.max(ar.bottom, br.bottom),
    right: Math.max(ar.right, br.right),
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of data.cells) {
      const r = entryRange(data, entry);
      if (!intersects(range, r)) continue;
      const next = {
        top: Math.min(range.top, r.top),
        left: Math.min(range.left, r.left),
        bottom: Math.max(range.bottom, r.bottom),
        right: Math.max(range.right, r.right),
      };
      if (JSON.stringify(next) !== JSON.stringify(range)) {
        range = next;
        changed = true;
      }
    }
  }
  return range;
}
export const entriesInRange = (data: TableCellData, range: TableRange) =>
  data.cells.filter((entry) => intersects(entryRange(data, entry), range));
const materialize = (
  cell: NodeCell<TableCellData>,
): NodeCell<TableCellData> => {
  const grid = tableGrid(cell);
  return {
    ...cell,
    data: {
      ...cell.data!,
      rows: cell.data!.rows.map((row, i) => ({ ...row, height: grid.rows[i] })),
      columns: cell.data!.columns.map((column, i) => ({
        ...column,
        width: grid.columns[i],
      })),
      cells: cell.data!.cells.map((entry) => ({ ...entry })),
    },
  };
};
export function resizeTableTrack(
  cell: NodeCell<TableCellData>,
  axis: TableTrack,
  index: number,
  size: number,
): NodeCell<TableCellData> {
  if (!Number.isFinite(size)) throw new Error('Invalid table size');
  const next = materialize(cell),
    data = next.data!,
    tracks = axis === 'row' ? data.rows : data.columns;
  if (!tracks[index]) throw new Error('Missing table track');
  const dimension = axis === 'row' ? 'height' : 'width',
    current = (tracks[index] as { height?: number; width?: number })[
      dimension
    ]!;
  const bounded = Math.max(MIN_TABLE_TRACK_SIZE, size),
    delta = bounded - current;
  if (axis === 'row')
    data.rows[index] = { ...data.rows[index], height: bounded };
  else data.columns[index] = { ...data.columns[index], width: bounded };
  return {
    ...next,
    geometry: {
      ...next.geometry,
      [dimension]: next.geometry[dimension] + delta,
    },
  };
}
export function insertTableTrack(
  cell: NodeCell<TableCellData>,
  axis: TableTrack,
  index: number,
  allocate: () => string,
): NodeCell<TableCellData> {
  const next = materialize(cell),
    data = next.data!,
    tracks = axis === 'row' ? data.rows : data.columns;
  if (!Number.isInteger(index) || index < 0 || index > tracks.length)
    throw new Error('Invalid table insertion index');
  const dimension = axis === 'row' ? 'height' : 'width',
    size = (
      tracks[Math.max(0, index - 1)] as { height?: number; width?: number }
    )[dimension]!;
  const id = allocate();
  data.cells = data.cells.map((entry) => {
    const start =
        axis === 'row'
          ? data.rows.findIndex((row) => row.id === entry.rowId)
          : data.columns.findIndex((column) => column.id === entry.columnId),
      span = axis === 'row' ? 'rowspan' : 'colspan';
    return start < index && start + (entry[span] ?? 1) > index
      ? { ...entry, [span]: (entry[span] ?? 1) + 1 }
      : entry;
  });
  if (axis === 'row') data.rows.splice(index, 0, { id, height: size });
  else data.columns.splice(index, 0, { id, width: size });
  const other = axis === 'row' ? data.columns : data.rows;
  other.forEach((track, i) => {
    const row = axis === 'row' ? index : i,
      column = axis === 'row' ? i : index;
    if (!entryAt(data, row, column))
      data.cells.push({
        id: allocate(),
        rowId: axis === 'row' ? id : track.id,
        columnId: axis === 'row' ? track.id : id,
        text: createBlockText(''),
      });
  });
  return {
    ...next,
    geometry: {
      ...cell.geometry,
      [dimension]: cell.geometry[dimension] + size,
    },
  };
}
export function removeTableTrack(
  cell: NodeCell<TableCellData>,
  axis: TableTrack,
  index: number,
): NodeCell<TableCellData> | undefined {
  const next = materialize(cell),
    data = next.data!,
    tracks = axis === 'row' ? data.rows : data.columns;
  if (!tracks[index]) throw new Error('Missing table track');
  if (tracks.length === 1) return undefined;
  const dimension = axis === 'row' ? 'height' : 'width',
    size = (tracks[index] as { height?: number; width?: number })[dimension]!,
    removedId = tracks[index].id;
  const remaining = tracks.filter((track) => track.id !== removedId);
  data.cells = data.cells.flatMap((entry) => {
    const start =
        axis === 'row'
          ? data.rows.findIndex((row) => row.id === entry.rowId)
          : data.columns.findIndex((column) => column.id === entry.columnId),
      spanKey = axis === 'row' ? 'rowspan' : 'colspan',
      span = entry[spanKey] ?? 1;
    if (index < start || index >= start + span) return [entry];
    if (span === 1) return [];
    return [
      {
        ...entry,
        [spanKey]: span - 1,
        ...(index === start
          ? { [axis === 'row' ? 'rowId' : 'columnId']: remaining[start].id }
          : {}),
      },
    ];
  });
  if (axis === 'row') data.rows = remaining;
  else data.columns = remaining;
  return {
    ...next,
    geometry: {
      ...cell.geometry,
      [dimension]: cell.geometry[dimension] - size,
    },
  };
}
export function mergeTableRange(
  cell: NodeCell<TableCellData>,
  range: TableRange,
): NodeCell<TableCellData> {
  const data = cell.data!,
    entries = entriesInRange(data, range),
    top = entryAt(data, range.top, range.left);
  if (!top || !entries.length) throw new Error('Missing table entries');
  const normalized = tableSelectionRange(
    data,
    top.id,
    entryAt(data, range.bottom, range.right)!.id,
  );
  if (JSON.stringify(normalized) !== JSON.stringify(range))
    throw new Error('Merge must cover complete entries');
  const documents = entries
    .sort((a, b) => {
      const pa = position(data, a),
        pb = position(data, b);
      return pa.top - pb.top || pa.left - pb.left;
    })
    .flatMap((entry) =>
      entry.text?.plainText ? (entry.text.content.content ?? []) : [],
    );
  const text = {
    ...(top.text ?? createBlockText('')),
    kind: 'block' as const,
    content: {
      type: 'doc',
      content: documents.length
        ? documents
        : createBlockText('').content.content,
    },
    plainText: entries
      .filter((entry) => entry.text?.plainText)
      .map((entry) => entry.text!.plainText)
      .join('\n'),
  };
  const merged = {
    ...top,
    rowspan: range.bottom - range.top + 1,
    colspan: range.right - range.left + 1,
    text,
  };
  return {
    ...cell,
    data: {
      ...data,
      cells: data.cells
        .filter((entry) => !entries.includes(entry))
        .concat(merged),
    },
  };
}
export function splitTableEntry(
  cell: NodeCell<TableCellData>,
  id: string,
  allocate: () => string,
): NodeCell<TableCellData> {
  const data = cell.data!,
    entry = data.cells.find((entry) => entry.id === id);
  if (!entry) throw new Error('Missing table entry');
  const { top, left } = position(data, entry),
    cells = data.cells.filter((other) => other.id !== id);
  for (let row = top; row < top + (entry.rowspan ?? 1); row++)
    for (let column = left; column < left + (entry.colspan ?? 1); column++)
      cells.push({
        ...entry,
        id: row === top && column === left ? entry.id : allocate(),
        rowId: data.rows[row].id,
        columnId: data.columns[column].id,
        rowspan: undefined,
        colspan: undefined,
        text: row === top && column === left ? entry.text : createBlockText(''),
      });
  return { ...cell, data: { ...data, cells } };
}
export function updateTableEntries(
  cell: NodeCell<TableCellData>,
  ids: string[],
  patch: Partial<Pick<TableEntry, 'fill' | 'textDirection'>>,
): NodeCell<TableCellData> {
  return {
    ...cell,
    data: {
      ...cell.data!,
      cells: cell.data!.cells.map((entry) =>
        ids.includes(entry.id) ? { ...entry, ...patch } : entry,
      ),
    },
  };
}
export function updateTableText(
  cell: NodeCell<TableCellData>,
  id: string,
  text: BoardTextDocument,
  measuredSize?: { width: number; height: number },
): NodeCell<TableCellData> {
  let next: NodeCell<TableCellData> = {
    ...cell,
    data: {
      ...cell.data!,
      cells: cell.data!.cells.map((entry) =>
        entry.id === id ? { ...entry, text } : entry,
      ),
    },
  };
  const rectangle = tableGrid(next).entries.find(
    (item) => item.entry.id === id,
  );
  if (rectangle && measuredSize) {
    const vertical = rectangle.entry.textDirection === 'vertical',
      measured = measuredSize.height + 8,
      existing = vertical ? rectangle.width : rectangle.height;
    if (measured > existing + 1) {
      const axis = vertical ? 'column' : 'row',
        grid = tableGrid(next),
        index = vertical ? rectangle.column : rectangle.row;
      next = resizeTableTrack(
        next,
        axis,
        index,
        (vertical ? grid.columns : grid.rows)[index] + measured - existing,
      );
    }
  }
  return next;
}
export const tableOperations = (
  cell: NodeCell<TableCellData> | undefined,
  id: string,
): CellOperation[] =>
  cell
    ? [{ type: 'replace_cell', cell }]
    : [{ type: 'remove_cell', cellId: id }];

export function createSwimlaneCell(
  id: string,
  points: Point[],
  direction: 'horizontal' | 'vertical' = 'horizontal',
  header = false,
  count = 3,
): NodeCell<TableCellData> {
  if (!Number.isInteger(count) || count < 1)
    throw new Error('Swimlane requires at least one lane');
  const first = points[0],
    last = points.at(-1)!;
  if (!first || !last) throw new Error('Swimlane requires a point');
  const click = Math.hypot(last[0] - first[0], last[1] - first[1]) < 4;
  const geometry = {
    x: click ? first[0] : Math.min(first[0], last[0]),
    y: click ? first[1] : Math.min(first[1], last[1]),
    width: click ? 524 : Math.max(80, Math.abs(last[0] - first[0])),
    height: click ? 580 : Math.max(60, Math.abs(last[1] - first[1])),
  };
  const horizontal: NodeCell<TableCellData> = {
    id,
    kind: 'swimlane',
    cellType: 'node',
    geometry,
    appearance: { fill: '#fff', strokeColor: '#64748b', strokeWidth: 1 },
    data: {
      rows: Array.from({ length: count }, (_, i) => ({ id: `${id}-r${i}` })),
      columns: Array.from({ length: header ? 3 : 2 }, (_, i) => ({
        id: `${id}-c${i}`,
        ...(i < (header ? 2 : 1)
          ? { width: Math.min(42, geometry.width / (header ? 4 : 3)) }
          : {}),
      })),
      cells: [],
      direction: 'horizontal',
      header,
    },
  };
  const data = horizontal.data!;
  if (header)
    data.cells.push({
      id: `${id}-title`,
      rowId: data.rows[0].id,
      columnId: data.columns[0].id,
      rowspan: count,
      text: createBlockText('New Swimlane'),
      textDirection: 'vertical',
      role: 'title',
    });
  data.rows.forEach((row, index) => {
    data.cells.push(
      {
        id: `${id}-lane${index}`,
        rowId: row.id,
        columnId: data.columns[header ? 1 : 0].id,
        text: createBlockText(header ? 'Lane' : 'New Swimlane'),
        textDirection: 'vertical',
        role: 'lane',
      },
      {
        id: `${id}-body${index}`,
        rowId: row.id,
        columnId: data.columns[header ? 2 : 1].id,
        role: 'body',
      },
    );
  });
  return direction === 'vertical' ? transposeSwimlane(horizontal) : horizontal;
}
export function transposeSwimlane(
  cell: NodeCell<TableCellData>,
): NodeCell<TableCellData> {
  const data = cell.data!;
  return {
    ...cell,
    geometry: {
      ...cell.geometry,
      width: cell.geometry.height,
      height: cell.geometry.width,
    },
    data: {
      ...data,
      direction: data.direction === 'horizontal' ? 'vertical' : 'horizontal',
      rows: data.columns.map((column) => ({
        id: column.id,
        height: column.width,
      })),
      columns: data.rows.map((row) => ({ id: row.id, width: row.height })),
      cells: data.cells.map((entry) => ({
        ...entry,
        rowId: entry.columnId,
        columnId: entry.rowId,
        rowspan: entry.colspan,
        colspan: entry.rowspan,
        textDirection: entry.text
          ? data.direction === 'horizontal'
            ? 'horizontal'
            : 'vertical'
          : entry.textDirection,
      })),
    },
  };
}
export function setSwimlaneCount(
  cell: NodeCell<TableCellData>,
  count: number,
  allocate: () => string,
): NodeCell<TableCellData> {
  if (!Number.isInteger(count) || count < 1)
    throw new Error('Swimlane requires at least one lane');
  const vertical = cell.data!.direction === 'vertical';
  let next = materialize(vertical ? transposeSwimlane(cell) : cell);
  const initial = next.data!;
  const existingIds = new Set(initial.cells.map((entry) => entry.id));
  const title = initial.header
    ? initial.cells.find((entry) => entry.columnId === initial.columns[0].id)
    : undefined;
  // The title is reconciled once after the lane tracks change.
  while (next.data!.rows.length < count)
    next = insertTableTrack(next, 'row', next.data!.rows.length, allocate);
  while (next.data!.rows.length > count)
    next = removeTableTrack(next, 'row', next.data!.rows.length - 1)!;
  const data = next.data!,
    heading = data.header ? 1 : 0;
  data.cells = data.cells.map((entry) => {
    if (existingIds.has(entry.id)) return entry;
    if (entry.columnId === data.columns[heading].id)
      return {
        ...entry,
        text: createBlockText(data.header ? 'Lane' : 'New Swimlane'),
        textDirection: 'vertical' as const,
        role: 'lane' as const,
      };
    return { ...entry, text: undefined, role: 'body' as const };
  });
  if (title)
    data.cells = data.cells
      .filter((entry) => entry.columnId !== data.columns[0].id)
      .concat({ ...title, rowId: data.rows[0].id, rowspan: count });
  return vertical ? transposeSwimlane(next) : next;
}
export function setSwimlaneHeader(
  cell: NodeCell<TableCellData>,
  header: boolean,
  allocate: () => string,
): NodeCell<TableCellData> {
  if (!!cell.data!.header === header) return cell;
  const vertical = cell.data!.direction === 'vertical';
  let next = vertical ? transposeSwimlane(cell) : cell;
  if (header) {
    next = insertTableTrack(next, 'column', 0, allocate);
    next = resizeTableTrack(next, 'column', 0, 42);
    const data = next.data!;
    data.cells = data.cells
      .filter((entry) => entry.columnId !== data.columns[0].id)
      .concat({
        id: allocate(),
        rowId: data.rows[0].id,
        columnId: data.columns[0].id,
        rowspan: data.rows.length,
        text: createBlockText('New Swimlane'),
        textDirection: 'vertical',
        role: 'title',
      });
    data.header = true;
  } else {
    next = removeTableTrack(next, 'column', 0)!;
    next.data!.header = false;
  }
  return vertical ? transposeSwimlane(next) : next;
}

/** Hit segments follow visible grid boundaries; merged cells hide internal tracks. */
export function tableResizeSegments(
  cell: NodeCell<TableCellData>,
  axis: TableTrack,
  index: number,
  geometry = cell.geometry,
): { start: number; end: number }[] {
  const data = cell.data!,
    grid = tableGrid(cell, geometry);
  const perpendicular = axis === 'row' ? grid.columns : grid.rows;
  const segments: { start: number; end: number }[] = [];
  let offset = 0;
  perpendicular.forEach((size, other) => {
    const before = entryAt(
      data,
      axis === 'row' ? index : other,
      axis === 'row' ? other : index,
    );
    const after = entryAt(
      data,
      axis === 'row' ? index + 1 : other,
      axis === 'row' ? other : index + 1,
    );
    if (before && before !== after) {
      const previous = segments.at(-1);
      if (previous?.end === offset) previous.end += size;
      else segments.push({ start: offset, end: offset + size });
    }
    offset += size;
  });
  return segments;
}
