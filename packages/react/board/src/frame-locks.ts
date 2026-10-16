import { isFrameCell, isGroupCell, type CellStore } from '@sue/board-core';

/** One immutable render snapshot, rather than whole-store scans per leaf. */
export function createFrameLockResolver(store: CellStore) {
  const groups = new Map<string, string>(),
    frames = new Map<string, string>();
  for (const cell of Object.values(store.cells)) {
    if (isGroupCell(cell))
      for (const id of cell.members) {
        if (!groups.has(id)) groups.set(id, cell.id);
      }
    if (isFrameCell(cell))
      for (const id of [...cell.children, ...cell.groups]) {
        if (!frames.has(id)) frames.set(id, cell.id);
      }
  }
  const cache = new Map<string, boolean>();
  const visit = (id: string, seen: Set<string>): boolean => {
    if (seen.has(id)) return false;
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    seen.add(id);
    const locked = [groups.get(id), frames.get(id)].some(
      (owner) =>
        !!owner && (!!store.cells[owner]?.locked || visit(owner, seen)),
    );
    cache.set(id, locked);
    return locked;
  };
  return (id: string) => visit(id, new Set());
}
