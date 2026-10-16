import {
  isEdgeCell,
  isNodeCell,
  isFrameCell,
  indexCells,
  lockedByAncestor,
  portAnchor,
  type CellOperation,
  type GeometrySide,
  type Cell,
  type CellStore,
  type NodeGeometry,
  type CellMoveContext,
  type Point,
} from '@sue/board-core';
import { layoutMindCells, mindChildIds } from './cell-utils';
import { reparentMindChild } from './cell-commands';
import { mindGrowthSide } from './cell-link';

export interface MindMovePlan {
  operations: CellOperation[];
  parentId?: string;
}
const layoutCache = new WeakMap<
  CellStore,
  Map<string, Map<string, NodeGeometry>>
>();

/** Resolve both the live preview and the final drop without changing the store. */
export const resolveMindChildMove = (
  store: CellStore,
  cell: Cell,
  preview: NodeGeometry,
  targetId?: string,
  context?: CellMoveContext,
): MindMovePlan => {
  const empty = { operations: [] };
  if (!isNodeCell(cell) || cell.kind !== 'mind-child') return empty;
  if (cell.hidden || cell.locked || lockedByAncestor(store, cell.id))
    return empty;
  const frameId = indexCells(store).parentOf.get(cell.id);
  if (!frameId) return empty;
  let frames = layoutCache.get(store);
  if (!frames) {
    frames = new Map();
    layoutCache.set(store, frames);
  }
  let base = frames.get(frameId);
  if (!base) {
    base = layoutMindCells(store, frameId);
    frames.set(frameId, base);
  }
  const positions = new Map(base);
  context?.geometry.forEach((geometry, id) => {
    if (positions.has(id)) positions.set(id, geometry);
  });
  const point: Point = context?.point ?? [
    preview.x + preview.width / 2,
    preview.y + preview.height / 2,
  ];
  const incoming = (id: string) =>
    Object.values(store.cells).find(
      (edge) =>
        isEdgeCell(edge) &&
        edge.kind === 'mind-branch' &&
        'cellId' in edge.target &&
        edge.target.cellId === id,
    );
  const branch = incoming(cell.id);
  if (!isEdgeCell(branch) || !('cellId' in branch.source)) return empty;
  const parent = store.cells[branch.source.cellId];
  if (!isNodeCell(parent)) return empty;
  const descendants = new Set<string>();
  const collect = (id: string) => {
    if (descendants.has(id)) return;
    descendants.add(id);
    mindChildIds(store, id).forEach(collect);
  };
  collect(cell.id);
  const index = indexCells(store);
  const scale =
    context?.scale && Number.isFinite(context.scale) && context.scale > 0
      ? context.scale
      : 1;
  const depth = 40 / scale,
    pad = 12 / scale;
  const frame = store.cells[frameId];
  const ids = isFrameCell(frame) ? frame.children : [];
  const targets = ids.flatMap((id) => {
    const node = store.cells[id],
      bounds = positions.get(id);
    return isNodeCell(node) &&
      ['mind-root', 'mind-child'].includes(node.kind) &&
      index.parentOf.get(id) === frameId &&
      !node.hidden &&
      bounds
      ? [{ node, bounds }]
      : [];
  });
  const allowed = (id: string) =>
    !descendants.has(id) &&
    !store.cells[id].locked &&
    !lockedByAncestor(store, id);
  const localPoint = (point: Point, bounds: NodeGeometry): Point => {
    const angle = -(bounds.rotation ?? 0),
      cx = bounds.x + bounds.width / 2,
      cy = bounds.y + bounds.height / 2,
      dx = point[0] - cx,
      dy = point[1] - cy;
    return [
      cx + dx * Math.cos(angle) - dy * Math.sin(angle),
      cy + dx * Math.sin(angle) + dy * Math.cos(angle),
    ];
  };
  const opposite: Record<GeometrySide, GeometrySide> = {
    left: 'right',
    right: 'left',
    top: 'bottom',
    bottom: 'top',
  };
  let invalid = false;
  const hot = targets
    .flatMap(({ node, bounds }, order) => {
      const sides: GeometrySide[] =
        node.kind === 'mind-root' &&
        ((node.data as { layout?: string } | undefined)?.layout ??
          'standard') === 'standard'
          ? ['left', 'right']
          : [mindGrowthSide(store, node.id)];
      return sides.flatMap((side) => {
        const anchor = portAnchor(preview, {
          side: opposite[side],
          offset: 0.5,
        }).point;
        const [x, y] = localPoint(anchor, bounds);
        const hit =
          side === 'right'
            ? x >= bounds.x + bounds.width &&
              x <= bounds.x + bounds.width + depth &&
              y >= bounds.y - pad &&
              y <= bounds.y + bounds.height + pad
            : side === 'left'
              ? x <= bounds.x &&
                x >= bounds.x - depth &&
                y >= bounds.y - pad &&
                y <= bounds.y + bounds.height + pad
              : side === 'top'
                ? y <= bounds.y &&
                  y >= bounds.y - depth &&
                  x >= bounds.x - pad &&
                  x <= bounds.x + bounds.width + pad
                : y >= bounds.y + bounds.height &&
                  y <= bounds.y + bounds.height + depth &&
                  x >= bounds.x - pad &&
                  x <= bounds.x + bounds.width + pad;
        if (!hit) return [];
        if (!allowed(node.id)) {
          invalid = true;
          return [];
        }
        const port = portAnchor(bounds, { side, offset: 0.5 }).point;
        return [
          {
            node,
            side,
            order,
            distance: (anchor[0] - port[0]) ** 2 + (anchor[1] - port[1]) ** 2,
          },
        ];
      });
    })
    .sort((a, b) => a.distance - b.distance || a.order - b.order);
  const body = targets.filter(({ bounds }) => {
    const [x, y] = localPoint(point, bounds);
    return (
      x >= bounds.x &&
      x <= bounds.x + bounds.width &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height
    );
  });
  const target = targetId
    ? store.cells[targetId]
    : (hot[0]?.node ?? body.find(({ node }) => allowed(node.id))?.node);
  if (
    targetId &&
    (!targets.some(({ node }) => node.id === targetId) || !allowed(targetId))
  )
    return empty;
  if (!target && (invalid || body.some(({ node }) => !allowed(node.id))))
    return empty;
  const owner = isNodeCell(target) ? target : parent;
  const siblings = mindChildIds(store, owner.id).filter((id) => id !== cell.id);
  const ownerGeometry = positions.get(owner.id) ?? owner.geometry;
  const split =
    owner.kind === 'mind-root' &&
    ((owner.data as { layout?: string } | undefined)?.layout ?? 'standard') ===
      'standard';
  const side = split
    ? hot[0]?.node.id === owner.id
      ? hot[0].side === 'left'
        ? 'left'
        : 'right'
      : point[0] < ownerGeometry.x + ownerGeometry.width / 2
        ? 'left'
        : 'right'
    : undefined;
  if (target && owner.id !== parent.id)
    return {
      operations: reparentMindChild(store, cell.id, owner.id, undefined, side),
      parentId: owner.id,
    };
  const rightCount = Math.min(
    siblings.length + 1,
    Math.max(
      0,
      (owner.data as { rightNodeCount?: number } | undefined)?.rightNodeCount ??
        Math.ceil((siblings.length + 1) / 2),
    ),
  );
  const originalSiblings = mindChildIds(store, owner.id);
  const remainingRight =
    rightCount - Number(originalSiblings.indexOf(cell.id) < rightCount);
  const candidates = split
    ? side === 'right'
      ? siblings.slice(0, remainingRight)
      : siblings.slice(remainingRight)
    : siblings;
  let layoutId: string | undefined = owner.id,
    horizontal = false;
  while (layoutId) {
    const node = store.cells[layoutId];
    const layout = isNodeCell(node)
      ? (node.data as { layout?: string } | undefined)?.layout
      : undefined;
    if (layout && layout !== 'standard') {
      horizontal = layout === 'upward' || layout === 'downward';
      break;
    }
    const edge = incoming(layoutId);
    layoutId =
      isEdgeCell(edge) && 'cellId' in edge.source
        ? edge.source.cellId
        : undefined;
  }
  const axis = horizontal ? 0 : 1;
  const at = candidates.findIndex((id) => {
    const bounds = positions.get(id);
    return (
      !!bounds &&
      point[axis] <
        (horizontal
          ? bounds.x + bounds.width / 2
          : bounds.y + bounds.height / 2)
    );
  });
  const siblingIndex =
    (split && side === 'left' ? remainingRight : 0) +
    (at < 0 ? candidates.length : at);
  return {
    operations: reparentMindChild(store, cell.id, owner.id, siblingIndex, side),
  };
};

/** Existing imperative move API delegates to the same drop resolver. */
export const moveMindChild = (
  store: CellStore,
  cell: Cell,
  preview: NodeGeometry,
  targetId?: string,
  context?: CellMoveContext,
): CellOperation[] =>
  resolveMindChildMove(store, cell, preview, targetId, context).operations;
