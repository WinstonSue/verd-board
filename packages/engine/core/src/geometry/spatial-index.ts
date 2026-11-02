import type { RectangleClient } from '../interfaces/rectangle-client';

export interface SpatialEntry extends RectangleClient {
  id: string;
}
type Branch = {
  bounds: RectangleClient;
  entries?: readonly SpatialEntry[];
  left?: Branch;
  right?: Branch;
};
const intersects = (a: RectangleClient, b: RectangleClient) =>
  a.x <= b.x + b.width &&
  a.x + a.width >= b.x &&
  a.y <= b.y + b.height &&
  a.y + a.height >= b.y;
/** Immutable broad phase. Callers retain responsibility for precise hit tests. */
export function createSpatialIndex(entries: readonly SpatialEntry[]) {
  const build = (items: SpatialEntry[]): Branch | undefined => {
    if (!items.length) return;
    let x = Infinity,
      y = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const item of items) {
      x = Math.min(x, item.x);
      y = Math.min(y, item.y);
      right = Math.max(right, item.x + item.width);
      bottom = Math.max(bottom, item.y + item.height);
    }
    const bounds = { x, y, width: right - x, height: bottom - y };
    if (items.length <= 8) return { bounds, entries: items };
    const axis = bounds.width >= bounds.height ? 'x' : 'y';
    items.sort((a, b) => a[axis] - b[axis] || a.id.localeCompare(b.id));
    const middle = items.length >>> 1;
    return {
      bounds,
      left: build(items.slice(0, middle)),
      right: build(items.slice(middle)),
    };
  };
  const root = build(
    entries.filter(
      (entry) =>
        [entry.x, entry.y, entry.width, entry.height].every(Number.isFinite) &&
        entry.width >= 0 &&
        entry.height >= 0,
    ),
  );
  return {
    query(bounds: RectangleClient): string[] {
      const result: string[] = [];
      const visit = (branch?: Branch) => {
        if (!branch || !intersects(branch.bounds, bounds)) return;
        if (branch.entries) {
          for (const entry of branch.entries)
            if (intersects(entry, bounds)) result.push(entry.id);
        } else {
          visit(branch.left);
          visit(branch.right);
        }
      };
      visit(root);
      return result;
    },
  };
}
