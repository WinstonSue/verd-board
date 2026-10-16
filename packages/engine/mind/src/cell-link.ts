import {
  isEdgeCell,
  isNodeCell,
  type CellStore,
  type EdgeCell,
  type GeometrySide,
  type NodeCell,
} from '@sue/board-core';
import {
  MindLayoutType,
  isHorizontalLogicLayout,
  isIndentedLayout,
  isLeftLayout,
  isRightLayout,
  isTopLayout,
} from '@sue/board-layouts';
import type { MindNodeData } from '@sue/board-core';
import { mindChildIds } from './cell-utils';

export interface MindPort {
  side: GeometrySide;
  offset: number;
}

const branchTo = (store: CellStore, nodeId: string) =>
  Object.values(store.cells).find(
    (cell): cell is EdgeCell =>
      isEdgeCell(cell) &&
      cell.kind === 'mind-branch' &&
      'cellId' in cell.target &&
      cell.target.cellId === nodeId,
  );

export const mindAncestor = (
  store: CellStore,
  nodeId: string,
): NodeCell | undefined => {
  const edge = branchTo(store, nodeId);
  if (!edge || !('cellId' in edge.source)) return undefined;
  const parent = store.cells[edge.source.cellId];
  return isNodeCell(parent) ? parent : undefined;
};

export const resolvedMindBranchShape = (
  store: CellStore,
  nodeId: string,
): 'bight' | 'polyline' | undefined => {
  let current: string | undefined = nodeId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = store.cells[current];
    if (isNodeCell(node)) {
      const shape = (node.data as MindNodeData | undefined)?.branchShape;
      if (shape) return shape;
    }
    current = mindAncestor(store, current)?.id;
  }
  return undefined;
};

const effectiveLayout = (store: CellStore, nodeId: string): MindLayoutType => {
  let current: NodeCell | undefined = isNodeCell(store.cells[nodeId])
    ? (store.cells[nodeId] as NodeCell)
    : undefined;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const layout = (current.data as MindNodeData | undefined)?.layout;
    if (layout) return layout as MindLayoutType;
    if (current.kind === 'mind-root') break;
    current = mindAncestor(store, current.id);
  }
  return MindLayoutType.right;
};

const onRightSide = (store: CellStore, nodeId: string) => {
  let current = nodeId;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const parent = mindAncestor(store, current);
    if (!parent) return true;
    if (
      parent.kind === 'mind-root' &&
      ((parent.data as MindNodeData | undefined)?.layout ??
        MindLayoutType.right) === MindLayoutType.standard
    ) {
      const siblings = mindChildIds(store, parent.id);
      const count =
        (parent.data as MindNodeData | undefined)?.rightNodeCount ??
        Math.ceil(siblings.length / 2);
      return siblings.indexOf(current) < count;
    }
    current = parent.id;
  }
  return true;
};

const underline = (node: NodeCell | undefined) =>
  (typeof node?.geometry.outline === 'object'
    ? node.geometry.outline.kind
    : node?.geometry.outline) === 'underline';

/** Layout direction chooses branch ports. Whiteboard arrows keep geometric routing. */
export const mindBranchPorts = (
  store: CellStore,
  edge: EdgeCell,
): { source: MindPort; target: MindPort } | undefined => {
  if (!('cellId' in edge.source) || !('cellId' in edge.target))
    return undefined;
  const parent = store.cells[edge.source.cellId];
  const child = store.cells[edge.target.cellId];
  if (!isNodeCell(parent) || !isNodeCell(child)) return undefined;
  const layout = effectiveLayout(store, child.id);
  const right =
    isRightLayout(layout) ||
    (layout === MindLayoutType.standard && onRightSide(store, child.id)) ||
    (isIndentedLayout(layout) && isRightLayout(layout));
  const left =
    isLeftLayout(layout) ||
    (layout === MindLayoutType.standard && !onRightSide(store, child.id));
  const horizontal =
    right ||
    left ||
    layout === MindLayoutType.standard ||
    isIndentedLayout(layout);
  let source: GeometrySide = 'right';
  let target: GeometrySide = 'left';
  if (left) {
    source = 'left';
    target = 'right';
  } else if (!horizontal && isTopLayout(layout)) {
    source = 'top';
    target = 'bottom';
  } else if (!horizontal) {
    source = 'bottom';
    target = 'top';
  }
  const offset =
    horizontal &&
    isHorizontalLogicLayout(
      layout === MindLayoutType.standard ? MindLayoutType.right : layout,
    ) &&
    (underline(parent) || underline(child))
      ? 1
      : 0.5;
  return {
    source: { side: source, offset: underline(parent) ? offset : 0.5 },
    target: { side: target, offset: underline(child) ? offset : 0.5 },
  };
};

export const mindGrowthSide = (
  store: CellStore,
  nodeId: string,
): GeometrySide => {
  const node = store.cells[nodeId];
  if (!isNodeCell(node)) return 'right';
  const layout = effectiveLayout(store, nodeId);
  if (layout === MindLayoutType.standard)
    return onRightSide(store, nodeId) || node.kind === 'mind-root'
      ? 'right'
      : 'left';
  if (isLeftLayout(layout)) return 'left';
  if (isTopLayout(layout) && !isIndentedLayout(layout)) return 'top';
  if (!isRightLayout(layout) && !isIndentedLayout(layout)) return 'bottom';
  return 'right';
};

export const mindDescendantCount = (store: CellStore, nodeId: string): number =>
  mindChildIds(store, nodeId).reduce(
    (count, child) => count + 1 + mindDescendantCount(store, child),
    0,
  );
