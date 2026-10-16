import {
  CellKind,
  isEdgeCell,
  isFrameCell,
  isNodeCell,
  type CellOperation,
  type CellStore,
  type EdgeCell,
  type MindNodeData,
  type MindRootData,
  type MindSummaryData,
  type NodeCell,
  type NodeGeometry,
  type RectangleClient,
} from '@sue/board-core';
import { MindLayoutType } from '@sue/board-layouts';
import { mindChildIds, layoutMindCells } from './cell-utils';
import type { MindMetricsOptions } from './cell-metrics';

const branchTo = (store: CellStore, nodeId: string) =>
  Object.values(store.cells).find(
    (cell): cell is EdgeCell =>
      isEdgeCell(cell) &&
      cell.kind === CellKind.mindBranch &&
      'cellId' in cell.target &&
      cell.target.cellId === nodeId,
  );

/** Owning mind-root for any topic in its tree. */
export const mindTreeRootId = (
  store: CellStore,
  nodeId: string,
): string | undefined => {
  let current: string | undefined = nodeId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const cell = store.cells[current];
    if (!isNodeCell(cell)) return undefined;
    if (cell.kind === CellKind.mindRoot) return cell.id;
    if (cell.kind !== CellKind.mindChild && cell.kind !== CellKind.mindSummary)
      return undefined;
    const edge = branchTo(store, cell.id);
    current = edge && 'cellId' in edge.source ? edge.source.cellId : undefined;
  }
  return undefined;
};

/** Every node the tree's layout rule covers: root, descendants and summaries. */
export const mindTreeNodeIds = (store: CellStore, rootId: string): string[] => {
  const members: string[] = [];
  const walk = (id: string) => {
    members.push(id);
    mindChildIds(store, id).forEach(walk);
  };
  walk(rootId);
  const memberSet = new Set(members);
  for (const cell of Object.values(store.cells)) {
    if (
      isEdgeCell(cell) &&
      cell.kind === CellKind.mindSummaryEdge &&
      'cellId' in cell.target &&
      memberSet.has(
        (cell.data as MindSummaryData | undefined)?.startSiblingId ?? '',
      )
    )
      members.push(cell.target.cellId);
  }
  return members;
};

/** The layout the selected topic's whole tree renders with. */
export const mindTreeLayout = (
  store: CellStore,
  nodeId: string,
): MindLayoutType => {
  const rootId = mindTreeRootId(store, nodeId);
  const root = rootId ? store.cells[rootId] : undefined;
  const layout =
    root && isNodeCell(root)
      ? ((root.data as MindNodeData | undefined)?.layout as
          MindLayoutType | undefined)
      : undefined;
  return layout ?? MindLayoutType.right;
};

/** Descendant and summary nodes still carrying a local layout override. */
export const mindTreeLayoutOverrides = (
  store: CellStore,
  nodeId: string,
): string[] => {
  const rootId = mindTreeRootId(store, nodeId);
  if (!rootId) return [];
  return mindTreeNodeIds(store, rootId).filter((id) => {
    if (id === rootId) return false;
    const cell = store.cells[id];
    return (
      isNodeCell(cell) &&
      (cell.data as MindNodeData | undefined)?.layout !== undefined
    );
  });
};

/**
 * Rewrites the owning tree's layout in one operation set: the root receives
 * the target layout, local overrides on topics and summaries are cleared —
 * including collapsed subtrees — and entering the bilateral layout restores
 * automatic left/right allocation (dropping a stale `rightNodeCount`).
 */
export const setMindTreeLayout = (
  store: CellStore,
  nodeId: string,
  layout: MindLayoutType | string,
): CellOperation[] => {
  const rootId = mindTreeRootId(store, nodeId);
  const root = rootId ? store.cells[rootId] : undefined;
  if (!root || !isNodeCell(root) || root.kind !== CellKind.mindRoot)
    throw new Error('Missing mind tree root');
  const operations: CellOperation[] = [];
  const rootData = { ...(root.data as MindRootData | undefined) };
  const changed = rootData.layout !== layout;
  if (changed) rootData.layout = layout;
  // Automatic allocation restores on entering bilateral and clears the
  // legacy `0` value; an unchanged standard layout keeps its manual split.
  if (changed && layout === MindLayoutType.standard)
    delete rootData.rightNodeCount;
  if (
    JSON.stringify(rootData) !==
    JSON.stringify(root.data as MindRootData | undefined)
  )
    operations.push({
      type: 'replace_cell',
      cell: { ...root, data: rootData },
    });
  for (const id of mindTreeLayoutOverrides(store, nodeId)) {
    const cell = store.cells[id] as NodeCell;
    const data = { ...(cell.data as MindNodeData | undefined) };
    delete data.layout;
    operations.push({
      type: 'replace_cell',
      cell: { ...cell, data },
    });
  }
  return operations;
};

/**
 * Overrides the bilateral split for the owning tree. `undefined` restores
 * automatic allocation. Only finite integers inside `0..topicCount` persist.
 */
export const setMindTreeRightNodeCount = (
  store: CellStore,
  nodeId: string,
  count?: number,
): CellOperation[] => {
  const rootId = mindTreeRootId(store, nodeId);
  const root = rootId ? store.cells[rootId] : undefined;
  if (!root || !isNodeCell(root) || root.kind !== CellKind.mindRoot)
    throw new Error('Missing mind tree root');
  const total = mindChildIds(store, root.id).length;
  const data = { ...(root.data as MindRootData | undefined) };
  if (count === undefined) {
    if (data.rightNodeCount === undefined) return [];
    delete data.rightNodeCount;
  } else {
    if (
      !Number.isInteger(count) ||
      !Number.isFinite(count) ||
      count < 0 ||
      count > total
    )
      throw new Error('Right topic count must be an integer inside the tree');
    if (data.rightNodeCount === count) return [];
    data.rightNodeCount = count;
  }
  return [
    {
      type: 'replace_cell',
      cell: { ...root, data },
    },
  ];
};

/** Combined laid-out bounds of every mind tree inside a frame. */
export const mindLayoutBounds = (
  store: CellStore,
  frameId: string,
  options?: MindMetricsOptions,
): RectangleClient | undefined => {
  const frame = store.cells[frameId];
  if (!isFrameCell(frame)) return undefined;
  const roots = frame.children.filter(
    (id) => store.cells[id]?.kind === CellKind.mindRoot,
  );
  if (!roots.length) return undefined;
  const geometry = layoutMindCells(store, frameId, options);
  const bounds = roots
    .map((id) => rootBounds(store, geometry, id))
    .filter((rect): rect is RectangleClient => !!rect);
  if (!bounds.length) return undefined;
  const x0 = Math.min(...bounds.map((rect) => rect.x));
  const y0 = Math.min(...bounds.map((rect) => rect.y));
  return {
    x: x0,
    y: y0,
    width: Math.max(...bounds.map((rect) => rect.x + rect.width)) - x0,
    height: Math.max(...bounds.map((rect) => rect.y + rect.height)) - y0,
  };
};

const rootBounds = (
  store: CellStore,
  geometry: ReadonlyMap<string, NodeGeometry>,
  rootId: string,
): RectangleClient | undefined => {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const id of mindTreeNodeIds(store, rootId)) {
    const bounds = geometry.get(id);
    if (!bounds) continue;
    x0 = Math.min(x0, bounds.x);
    y0 = Math.min(y0, bounds.y);
    x1 = Math.max(x1, bounds.x + bounds.width);
    y1 = Math.max(y1, bounds.y + bounds.height);
  }
  return Number.isFinite(x0)
    ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
    : undefined;
};

/**
 * Stacks a snapshot's mind trees vertically by their real laid-out bounds so
 * imported multi-root documents never overlap. Only root coordinates change;
 * derived child geometry stays untouched. Returns the same store when there
 * is nothing to move.
 */
export const stackMindTreeRoots = (
  store: CellStore,
  frameId: string,
  gap = 80,
  options?: MindMetricsOptions,
): CellStore => {
  const frame = store.cells[frameId];
  if (!isFrameCell(frame)) return store;
  const rootIds = frame.children.filter(
    (id) => store.cells[id]?.kind === CellKind.mindRoot,
  );
  if (rootIds.length < 2) return store;
  const geometry = layoutMindCells(store, frameId, options);
  const cells = { ...store.cells };
  let top: number | undefined;
  for (const id of rootIds) {
    const bounds = rootBounds(store, geometry, id);
    const root = cells[id] as NodeCell;
    if (!bounds || !isNodeCell(root)) continue;
    if (top === undefined) {
      top = bounds.y + bounds.height + gap;
      continue;
    }
    const shift = top - bounds.y;
    cells[id] = {
      ...root,
      geometry: { ...root.geometry, y: root.geometry.y + shift },
    };
    top = bounds.y + shift + bounds.height + gap;
  }
  return { ...store, cells };
};

/** Shifts every mind root in the frame; derived descendants stay untouched. */
export const offsetMindTreeRoots = (
  store: CellStore,
  frameId: string,
  dx: number,
  dy: number,
): CellStore => {
  if (!dx && !dy) return store;
  const frame = store.cells[frameId];
  if (!isFrameCell(frame)) return store;
  const cells = { ...store.cells };
  for (const id of frame.children) {
    const cell = cells[id];
    if (!isNodeCell(cell) || cell.kind !== CellKind.mindRoot) continue;
    cells[id] = {
      ...cell,
      geometry: {
        ...cell.geometry,
        x: cell.geometry.x + dx,
        y: cell.geometry.y + dy,
      },
    };
  }
  return { ...store, cells };
};
