import {
  isEdgeCell,
  isGroupCell,
  isNodeCell,
  type CellStore,
  type EdgeCell,
} from '@sue/board-core';

/** Collapsed ancestors needed to show one topic, relation, summary or group. */
export function prepareMindReveal(
  store: CellStore,
  targetId: string,
): readonly string[] {
  const parentOf = new Map<string, string>();
  const summaries = new Map<string, EdgeCell>();
  for (const cell of Object.values(store.cells)) {
    if (
      !isEdgeCell(cell) ||
      !('cellId' in cell.source) ||
      !('cellId' in cell.target)
    )
      continue;
    if (cell.kind === 'mind-branch')
      parentOf.set(cell.target.cellId, cell.source.cellId);
    if (cell.kind === 'mind-summary-edge')
      summaries.set(cell.target.cellId, cell);
  }
  const expanded = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const cell = store.cells[id];
    if (!cell) return;
    if (isGroupCell(cell)) {
      cell.members.forEach(visit);
      return;
    }
    if (isEdgeCell(cell)) {
      if (!['mind-branch', 'mind-summary-edge'].includes(cell.kind)) return;
      if ('cellId' in cell.source) visit(cell.source.cellId);
      if ('cellId' in cell.target) visit(cell.target.cellId);
      if (cell.kind === 'mind-summary-edge') {
        const data = cell.data as
          { startSiblingId?: string; endSiblingId?: string } | undefined;
        if (data?.startSiblingId) visit(data.startSiblingId);
        if (data?.endSiblingId) visit(data.endSiblingId);
      }
      return;
    }
    if (
      !isNodeCell(cell) ||
      !['mind-root', 'mind-child', 'mind-summary'].includes(cell.kind)
    )
      return;
    const parentId = parentOf.get(id);
    if (parentId) {
      const parent = store.cells[parentId];
      if (
        isNodeCell(parent) &&
        (parent.data as { collapsed?: boolean } | undefined)?.collapsed
      )
        expanded.add(parentId);
      visit(parentId);
    }
    const summary = summaries.get(id);
    if (summary) visit(summary.id);
  };
  visit(targetId);
  return [...expanded];
}
