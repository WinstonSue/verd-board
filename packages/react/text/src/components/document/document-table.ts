import { Extension } from '@tiptap/core';
import { Fragment, type Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { CellSelection, TableMap, selectedRect } from '@tiptap/pm/tables';

export type TableScopeKind = 'table' | 'row' | 'column';
export const tableScopeKey = new PluginKey<TableScopeKind | null>(
  'documentTableScope',
);

export function tableHandleTarget(
  state: EditorState,
  position = state.selection instanceof CellSelection
    ? state.selection.$headCell.pos
    : state.selection.head,
) {
  const resolved = state.doc.resolve(position);
  const isCell = (node: Node | null) =>
    ['cell', 'header_cell'].includes(node?.type.spec['tableRole'] as string);
  let cell = isCell(resolved.nodeAfter) ? position : null;
  for (let depth = resolved.depth; depth > 0; depth--) {
    const node = resolved.node(depth);
    if (cell === null && isCell(node)) cell = resolved.before(depth);
    if (cell !== null && node.type.spec['tableRole'] === 'table') {
      const start = resolved.before(depth);
      const rect = TableMap.get(node).findCell(cell - start - 1);
      return { start, cell, row: rect.top, column: rect.left };
    }
  }
  return null;
}

export type TableHandleTarget = NonNullable<
  ReturnType<typeof tableHandleTarget>
>;

function inferredKind(selection: CellSelection): TableScopeKind | null {
  if (selection.isRowSelection() && selection.isColSelection()) return 'table';
  if (selection.isRowSelection()) return 'row';
  if (selection.isColSelection()) return 'column';
  return null;
}

export const DocumentTableSelection = Extension.create({
  name: 'documentTableSelection',
  addProseMirrorPlugins: () => [
    new Plugin<TableScopeKind | null>({
      key: tableScopeKey,
      state: {
        init: () => null,
        apply(tr, previous, old) {
          if (!(tr.selection instanceof CellSelection)) return null;
          const explicit = tr.getMeta(tableScopeKey) as
            TableScopeKind | undefined;
          if (explicit) return explicit;
          if (!tr.selectionSet || tr.selection.eq(old.selection))
            return previous;
          return inferredKind(tr.selection);
        },
      },
    }),
  ],
});

export function tableScope(state: EditorState) {
  if (!(state.selection instanceof CellSelection)) return null;
  const kind = tableScopeKey.getState(state) ?? inferredKind(state.selection);
  if (!kind) return null;
  return { ...selectedRect(state), kind };
}

export function tableSelection(
  doc: Node,
  start: number,
  kind: TableScopeKind,
  first = 0,
  last = first,
) {
  const table = doc.nodeAt(start);
  if (table?.type.spec['tableRole'] !== 'table') return null;
  const map = TableMap.get(table);
  const limit = kind === 'row' ? map.height : map.width;
  if (first < 0 || last < first || last >= limit) return null;
  const top = kind === 'row' ? first : 0;
  const bottom = kind === 'row' ? last : map.height - 1;
  const left = kind === 'column' ? first : 0;
  const right = kind === 'column' ? last : map.width - 1;
  const anchor = doc.resolve(start + 1 + map.map[top * map.width + left]);
  const head = doc.resolve(start + 1 + map.map[bottom * map.width + right]);
  return new CellSelection(anchor, head);
}

/** Reorder whole cells only: neither the source nor the drop may split a span. */
export function planTableMove(
  state: EditorState,
  axis: 'row' | 'column',
  toIndex: number,
) {
  const scope = tableScope(state);
  if (!scope || scope.kind !== axis || !Number.isInteger(toIndex)) return null;
  const { table, map, tableStart } = scope;
  const from = axis === 'row' ? scope.top : scope.left;
  const end = axis === 'row' ? scope.bottom : scope.right;
  const length = axis === 'row' ? map.height : map.width;
  const count = end - from;
  if (toIndex < 0 || toIndex > length - count || toIndex === from) return null;
  const order = Array.from({ length }, (_, index) => index);
  order.splice(toIndex, 0, ...order.splice(from, count));
  const positions = new Map(order.map((old, next) => [old, next]));
  const cells: { node: Node; row: number; column: number; oldPos: number }[] =
    [];
  table.forEach((row, rowOffset, rowIndex) => {
    row.forEach((node, cellOffset) => {
      const oldPos = rowOffset + 1 + cellOffset;
      const rect = map.findCell(oldPos);
      const begin = axis === 'row' ? rect.top : rect.left;
      const finish = axis === 'row' ? rect.bottom : rect.right;
      const next = positions.get(begin)!;
      // A partial source span must never silently expand the user's selection.
      const intersects = begin < end && finish > from;
      if (intersects && (begin < from || finish > end)) return;
      cells.push({
        node,
        row: axis === 'row' ? next : rowIndex,
        column: axis === 'column' ? next : rect.left,
        oldPos,
      });
    });
  });
  if (
    cells.length !==
    table.content.content.reduce((sum, row) => sum + row.childCount, 0)
  )
    return null;
  for (const cell of cells) {
    const rect = map.findCell(cell.oldPos);
    const begin = axis === 'row' ? rect.top : rect.left;
    const finish = axis === 'row' ? rect.bottom : rect.right;
    for (let index = begin; index < finish; index++)
      if (positions.get(index) !== positions.get(begin)! + index - begin)
        return null;
  }
  const mappings: { from: number; to: number; size: number }[] = [];
  let offset = tableStart;
  const rows = Array.from({ length: map.height }, (_, rowIndex) => {
    const source = table.child(axis === 'row' ? order[rowIndex] : rowIndex);
    offset++;
    const children = cells
      .filter((cell) => cell.row === rowIndex)
      .sort((a, b) => a.column - b.column);
    for (const cell of children) {
      mappings.push({
        from: tableStart + cell.oldPos,
        to: offset,
        size: cell.node.nodeSize,
      });
      offset += cell.node.nodeSize;
    }
    offset++;
    return axis === 'row'
      ? source
      : source.copy(Fragment.fromArray(children.map((cell) => cell.node)));
  });
  const next = table.copy(Fragment.fromArray(rows));
  if (TableMap.get(next).problems?.length) return null;
  return { table: next, start: tableStart - 1, toIndex, count, mappings };
}
