import {
  isFrameCell,
  isFrameReferenceCell,
  listedMembers,
  type Cell,
  type CellStore,
  type FrameSnapshot,
} from '@sue/board-core';

const snapshots = new WeakMap<CellStore, Map<string, FrameSnapshot>>();

/** Keep preview validation, indexes and layout local to its canvas dependencies. */
export function canvasPreviewSnapshot(
  source: CellStore,
  frameId: string,
  previous?: FrameSnapshot,
): FrameSnapshot {
  let byFrame = snapshots.get(source);
  if (!byFrame) snapshots.set(source, (byFrame = new Map()));
  const cached = byFrame.get(frameId);
  if (cached) return cached;

  const cells: Record<string, Cell> = {};
  const parents = new Map<string, string>();
  const pending = [frameId];
  while (pending.length) {
    const id = pending.pop()!;
    const cell = source.cells[id];
    if (!cell || Object.hasOwn(cells, id)) continue;
    cells[id] = cell;
    if (isFrameCell(cell)) {
      pending.push(...cell.children, ...cell.groups);
      for (const childId of cell.children)
        if (isFrameCell(source.cells[childId])) parents.set(childId, id);
    } else {
      pending.push(...listedMembers(cell));
      if (isFrameReferenceCell(cell)) pending.push(cell.data.targetFrameId);
    }
  }

  // A referenced ancestor can own the requested Frame in a nested snapshot.
  // Keep its ownership intact while FrameCanvas mounts frameId for display.
  let rootId = frameId;
  const ancestors = new Set<string>();
  while (parents.has(rootId) && !ancestors.has(rootId)) {
    ancestors.add(rootId);
    rootId = parents.get(rootId)!;
  }
  const next = !isFrameCell(cells[frameId])
    ? { store: source }
    : previous?.store.rootId === rootId &&
        Object.keys(previous.store.cells).length ===
          Object.keys(cells).length &&
        Object.entries(cells).every(
          ([id, cell]) => previous.store.cells[id] === cell,
        )
      ? previous
      : { store: { rootId, cells } };
  byFrame.set(frameId, next);
  return next;
}
