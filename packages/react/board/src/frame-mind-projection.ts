import {
  fitFrameContent,
  frameContentViewport,
  geometryBounds,
  isEdgeCell,
  isNodeCell,
  type CellStore,
  type FrameCell,
  type MindRootData,
  type NodeGeometry,
  type Point,
  type RectangleClient,
} from '@sue/board-core';

/** Keep fitting canonical. Offsets move only one visible tree inside that fit. */
export function projectEmbeddedMindTrees(
  store: CellStore,
  frame: FrameCell,
  base: Map<string, NodeGeometry>,
  fitBounds: RectangleClient,
  overrides?: ReadonlyMap<string, Point>,
) {
  const offsets = new Map<string, Point>();
  let geometry = base;
  const placement = fitFrameContent(frame, fitBounds);
  if (!(placement.scale > 0) || !Number.isFinite(placement.scale))
    return { geometry, offsets };
  const viewport = frameContentViewport(frame.geometry);
  const left = (viewport.x - placement.offset[0]) / placement.scale;
  const top = (viewport.y - placement.offset[1]) / placement.scale;
  const right = left + viewport.width / placement.scale;
  const bottom = top + viewport.height / placement.scale;
  const children = new Map<string, string[]>();
  for (const id of frame.children) {
    const edge = store.cells[id];
    if (
      !isEdgeCell(edge) ||
      !['mind-branch', 'mind-summary-edge'].includes(edge.kind) ||
      !('cellId' in edge.source) ||
      !('cellId' in edge.target)
    )
      continue;
    const targets = children.get(edge.source.cellId) ?? [];
    targets.push(edge.target.cellId);
    children.set(edge.source.cellId, targets);
  }
  for (const id of frame.children) {
    const root = store.cells[id];
    if (!isNodeCell(root) || root.kind !== 'mind-root' || root.hidden) continue;
    const members = new Set<string>();
    const collect = (id: string) => {
      if (members.has(id)) return;
      members.add(id);
      children.get(id)?.forEach(collect);
    };
    collect(root.id);
    const visible = [...members].flatMap((id) => {
      const bounds = base.get(id);
      return bounds && !store.cells[id]?.hidden ? [{ id, bounds }] : [];
    });
    if (!visible.length) continue;
    const visualBounds = visible.map(({ bounds }) => geometryBounds(bounds));
    const x = Math.min(...visualBounds.map((bounds) => bounds.x));
    const y = Math.min(...visualBounds.map((bounds) => bounds.y));
    const x2 = Math.max(
      ...visualBounds.map((bounds) => bounds.x + bounds.width),
    );
    const y2 = Math.max(
      ...visualBounds.map((bounds) => bounds.y + bounds.height),
    );
    const requested = overrides?.get(id) ??
      (root.data as MindRootData | undefined)?.embeddedOffset ?? [0, 0];
    // Floating point fit arithmetic may reverse an otherwise zero-width interval.
    const clamp = (value: number, min: number, max: number) =>
      min > max ? (min + max) / 2 : Math.max(min, Math.min(max, value));
    const offset: Point = [
      clamp(requested[0], left - x, right - x2),
      clamp(requested[1], top - y, bottom - y2),
    ];
    offsets.set(id, offset);
    if (!offset[0] && !offset[1]) continue;
    if (geometry === base) geometry = new Map(base);
    for (const { id, bounds } of visible)
      geometry.set(id, {
        ...bounds,
        x: bounds.x + offset[0],
        y: bounds.y + offset[1],
      });
  }
  return { geometry, offsets };
}
