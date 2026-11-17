import {
  groupLeafMembers,
  isEdgeCell,
  isGroupCell,
  type Cell,
  type CellStore,
} from '@sue/board-core';

/** Interaction ordering is derived; persisted sibling order remains untouched. */
export function framePaintOrder(
  store: CellStore,
  children: readonly string[],
  selection: readonly string[],
  isBackground: (cell: Cell) => boolean,
) {
  const selected = new Set(
    selection.flatMap((id) =>
      isGroupCell(store.cells[id]) ? groupLeafMembers(store, id) : [id],
    ),
  );
  const backgrounds: string[] = [],
    edges: string[] = [],
    nodes: string[] = [],
    raised: string[] = [];
  for (const id of children) {
    const cell = store.cells[id];
    if (!cell) continue;
    const band = isBackground(cell)
      ? backgrounds
      : isEdgeCell(cell)
        ? edges
        : nodes;
    band.push(id);
    if (band !== backgrounds && selected.has(id)) raised.push(id);
  }
  const normal = [...backgrounds, ...edges, ...nodes];
  const raisedIds = new Set(raised);
  return {
    normalRank: new Map(normal.map((id, index) => [id, index])),
    ids: [...normal.filter((id) => !raisedIds.has(id)), ...raised],
  };
}
