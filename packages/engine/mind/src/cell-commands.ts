import {
  CellKind,
  createFrameCell,
  isNodeCell,
  indexCells,
  isEdgeCell,
  type NodeCell,
  type CellStore,
  type CellOperation,
  type FrameSnapshot,
  type Point,
  type MindSummaryData,
  type EdgeCell,
  type MindChildData,
} from '@sue/board-core';
import { mindChildIds } from './cell-utils';
import {
  createInlineText,
  inheritTextFormatting,
  isBoardTextDocument,
} from '@sue/board-common';
export const createMindRootCell = (
  id: string,
  position: Point = [0, 0],
): NodeCell => ({
  id,
  kind: CellKind.mindRoot,
  cellType: 'node',
  geometry: {
    x: position[0],
    y: position[1],
    width: 160,
    height: 56,
    outline: 'roundRectangle',
  },
  content: { label: 'Central topic' },
  data: { layout: 'right' },
});
export const createMindChildCell = (id: string): NodeCell => ({
  id,
  kind: CellKind.mindChild,
  cellType: 'node',
  geometry: {
    x: 0,
    y: 0,
    width: 120,
    height: 40,
    derived: true,
  },
  content: { label: 'Topic' },
  data: { collapsed: false },
});
export const createMindFrameSnapshot = (
  frameId: string,
  rootId: string,
): FrameSnapshot => {
  const frame = createFrameCell(frameId);
  frame.children = [rootId];
  return {
    store: {
      rootId: frameId,
      cells: { [frameId]: frame, [rootId]: createMindRootCell(rootId) },
    },
  };
};
const order = (at: number) => String(at).padStart(8, '0');
export const addMindChild = (
  store: CellStore,
  parentId: string,
  node: NodeCell,
  edgeId: string,
  index?: number,
  inheritId = parentId,
): CellOperation[] => {
  const parent = store.cells[parentId];
  if (
    !parent ||
    ![CellKind.mindRoot, CellKind.mindChild].includes(parent.kind as never)
  )
    throw new Error('Invalid mind parent');
  const parentFrame = indexCells(store).parentOf.get(parentId)!;
  const seed = store.cells[inheritId];
  const inherit =
    isNodeCell(seed) && seed.kind === CellKind.mindChild ? seed : undefined;
  const seedData = inherit?.data as MindChildData | undefined,
    nodeData = node.data as MindChildData | undefined;
  const inheritedAppearance = inherit?.appearance && {
    fill: inherit.appearance.fill,
    strokeColor: inherit.appearance.strokeColor,
    strokeWidth: inherit.appearance.strokeWidth,
    strokeStyle: inherit.appearance.strokeStyle,
  };
  const seedBranch =
    inherit &&
    Object.values(store.cells).find(
      (cell): cell is EdgeCell =>
        isEdgeCell(cell) &&
        cell.kind === CellKind.mindBranch &&
        'cellId' in cell.target &&
        cell.target.cellId === inherit.id,
    );
  const branchBase = seedData?.branchAppearance ?? seedBranch?.appearance;
  const branchAppearance =
    branchBase || nodeData?.branchAppearance
      ? { ...branchBase, ...nodeData?.branchAppearance }
      : undefined;
  const branchShape =
    nodeData?.branchShape ?? ancestorBranch(store, parentId)?.branchShape;
  const siblings = mindChildIds(store, parentId);
  siblings.splice(index ?? siblings.length, 0, node.id);
  const operations: CellOperation[] = [
    {
      type: 'insert_cell',
      parentId: parentFrame,
      cell: {
        ...node,
        kind: CellKind.mindChild,
        geometry: {
          ...node.geometry,
          outline:
            node.geometry.outline ??
            inherit?.geometry.outline ??
            'roundRectangle',
          derived: true,
        },
        appearance: inherit
          ? { ...inheritedAppearance, ...node.appearance }
          : node.appearance,
        content:
          inherit && !isBoardTextDocument(node.content?.text)
            ? {
                ...node.content,
                text: inheritTextFormatting(
                  createInlineText(node.content?.label ?? ''),
                  inherit.content?.text,
                ),
              }
            : node.content,
        data: { ...nodeData, branchAppearance, branchShape },
      },
    },
  ];
  siblings.forEach((id, at) => {
    if (id === node.id)
      operations.push({
        type: 'insert_cell',
        parentId: parentFrame,
        cell: {
          id: edgeId,
          kind: CellKind.mindBranch,
          cellType: 'edge',
          source: { cellId: parentId },
          target: { cellId: id },
          route: {
            mode:
              branchShape === 'polyline'
                ? 'orthogonal'
                : branchShape === 'bight'
                  ? 'curve'
                  : 'auto',
          },
          appearance: branchAppearance,
          data: { order: order(at) },
        },
      });
    else {
      const edge = Object.values(store.cells).find(
        (cell) =>
          isEdgeCell(cell) &&
          cell.kind === CellKind.mindBranch &&
          'cellId' in cell.target &&
          cell.target.cellId === id,
      );
      if (edge && isEdgeCell(edge))
        operations.push({
          type: 'replace_cell',
          cell: { ...edge, data: { order: order(at) } },
        });
    }
  });
  if (
    isNodeCell(parent) &&
    parent.kind === CellKind.mindChild &&
    (parent.data as { collapsed?: boolean } | undefined)?.collapsed
  )
    operations.push({
      type: 'replace_cell',
      cell: {
        ...parent,
        data: { ...(parent.data as object), collapsed: false },
      },
    });
  return operations;
};
const ancestorBranch = (
  store: CellStore,
  nodeId: string,
): MindChildData | undefined => {
  let current: string | undefined = nodeId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const cell = store.cells[current];
    if (isNodeCell(cell)) {
      const data = cell.data as MindChildData | undefined;
      if (data?.branchShape || data?.branchAppearance) return data;
    }
    const edge = Object.values(store.cells).find(
      (item): item is EdgeCell<{ order: string }> =>
        isEdgeCell(item) &&
        item.kind === CellKind.mindBranch &&
        'cellId' in item.target &&
        item.target.cellId === current,
    );
    current = edge && 'cellId' in edge.source ? edge.source.cellId : undefined;
  }
  return undefined;
};
const branchTo = (store: CellStore, nodeId: string) =>
  Object.values(store.cells).find(
    (cell): cell is EdgeCell<{ order: string }> =>
      isEdgeCell(cell) &&
      cell.kind === CellKind.mindBranch &&
      'cellId' in cell.target &&
      cell.target.cellId === nodeId,
  );
const splitRoot = (cell: NodeCell) =>
  cell.kind === CellKind.mindRoot &&
  (cell.data as { layout?: string } | undefined)?.layout === 'standard';
const rightCount = (cell: NodeCell, count: number) =>
  Math.min(
    count,
    Math.max(
      0,
      Math.trunc(
        (cell.data as { rightNodeCount?: number } | undefined)
          ?.rightNodeCount ?? Math.ceil(count / 2),
      ),
    ),
  );

/** index addresses the sibling list after removing the moving topic. */
export const reparentMindChild = (
  store: CellStore,
  nodeId: string,
  parentId: string,
  index?: number,
  side?: 'left' | 'right',
): CellOperation[] => {
  const node = store.cells[nodeId],
    parent = store.cells[parentId];
  if (
    !isNodeCell(node) ||
    node.kind !== CellKind.mindChild ||
    !isNodeCell(parent) ||
    ![CellKind.mindRoot, CellKind.mindChild].includes(parent.kind as never)
  )
    throw new Error('Only child topics can change parent');
  const current = branchTo(store, nodeId);
  if (!current || !('cellId' in current.source))
    throw new Error('Missing mind branch');
  const oldParentId = current.source.cellId,
    oldParent = store.cells[oldParentId] as NodeCell;
  const frames = indexCells(store).parentOf;
  if (frames.get(nodeId) !== frames.get(parentId))
    throw new Error('Mind reparenting must stay in one frame');
  const ancestors = new Set<string>();
  let ancestor: string | undefined = parentId;
  while (ancestor) {
    if (ancestor === nodeId || ancestors.has(ancestor))
      throw new Error('Mind branch cycle');
    ancestors.add(ancestor);
    const edge = branchTo(store, ancestor);
    ancestor = edge && 'cellId' in edge.source ? edge.source.cellId : undefined;
  }
  const oldSiblings = mindChildIds(store, oldParentId),
    nextSiblings = mindChildIds(store, parentId).filter((id) => id !== nodeId);
  if (
    index !== undefined &&
    (!Number.isInteger(index) || index < 0 || index > nextSiblings.length)
  )
    throw new Error('Invalid mind sibling index');
  const oldRight = rightCount(oldParent, oldSiblings.length),
    wasRight = oldSiblings.indexOf(nodeId) < oldRight;
  const remainingRight =
    oldParentId === parentId
      ? oldRight - Number(wasRight)
      : rightCount(parent, nextSiblings.length);
  let at = index ?? nextSiblings.length;
  const right =
    side !== undefined
      ? side === 'right'
      : oldParentId === parentId
        ? index === undefined
          ? wasRight
          : at < remainingRight || (at === remainingRight && wasRight)
        : at < remainingRight ||
          (at === remainingRight && remainingRight === nextSiblings.length);
  if (splitRoot(parent) && (side !== undefined || index === undefined))
    at = right ? Math.min(at, remainingRight) : Math.max(at, remainingRight);
  nextSiblings.splice(at, 0, nodeId);
  const operations: CellOperation[] = [];
  const lists = new Map([[parentId, nextSiblings]]);
  if (oldParentId !== parentId)
    lists.set(
      oldParentId,
      oldSiblings.filter((id) => id !== nodeId),
    );
  lists.forEach((siblings, owner) =>
    siblings.forEach((id, position) => {
      const edge = branchTo(store, id);
      if (
        edge &&
        (!('cellId' in edge.source) ||
          edge.source.cellId !== owner ||
          edge.data?.order !== order(position))
      )
        operations.push({
          type: 'replace_cell',
          cell: {
            ...edge,
            source: { cellId: owner },
            data: { ...edge.data, order: order(position) },
          },
        });
    }),
  );
  const partition = (root: NodeCell, count: number, total: number) => {
    if (!splitRoot(root)) return;
    const data = root.data as { rightNodeCount?: number } | undefined;
    if (
      data?.rightNodeCount === count ||
      (data?.rightNodeCount === undefined && count === Math.ceil(total / 2))
    )
      return;
    operations.push({
      type: 'replace_cell',
      cell: { ...root, data: { ...data, rightNodeCount: count } },
    });
  };
  if (oldParentId !== parentId)
    partition(oldParent, oldRight - Number(wasRight), oldSiblings.length - 1);
  partition(parent, remainingRight + Number(right), nextSiblings.length);
  if (
    parent.kind === CellKind.mindChild &&
    (parent.data as { collapsed?: boolean } | undefined)?.collapsed
  )
    operations.push({
      type: 'replace_cell',
      cell: {
        ...parent,
        data: { ...(parent.data as object), collapsed: false },
      },
    });
  return operations;
};
export const createMindSummary = (
  store: CellStore,
  parentId: string,
  startId: string,
  endId: string,
  nodeId: string,
  edgeId: string,
): CellOperation[] => {
  const siblings = mindChildIds(store, parentId);
  if (
    !siblings.includes(startId) ||
    siblings.indexOf(endId) < siblings.indexOf(startId)
  )
    throw new Error('Invalid summary range');
  const frameId = indexCells(store).parentOf.get(parentId)!;
  return [
    {
      type: 'insert_cell',
      parentId: frameId,
      cell: {
        ...createMindChildCell(nodeId),
        kind: CellKind.mindSummary,
        content: { label: 'Summary' },
      },
    },
    {
      type: 'insert_cell',
      parentId: frameId,
      cell: {
        id: edgeId,
        kind: CellKind.mindSummaryEdge,
        cellType: 'edge',
        source: { cellId: startId },
        target: { cellId: nodeId },
        route: { mode: 'auto' },
        data: { startSiblingId: startId, endSiblingId: endId },
      },
    },
  ];
};

/** Standard bilateral layouts split a summary that crosses the center. */
export const createMindSummaries = (
  store: CellStore,
  parentId: string,
  siblingIds: readonly string[],
  allocateId: () => string,
): CellOperation[] => {
  const parent = store.cells[parentId];
  if (!isNodeCell(parent)) throw new Error('Invalid summary parent');
  const siblings = mindChildIds(store, parentId);
  const selected = siblings.filter((id) => siblingIds.includes(id));
  if (!selected.length) throw new Error('Invalid summary range');
  const bilateral = splitRoot(parent);
  const right = rightCount(parent, siblings.length);
  const groups = bilateral
    ? [
        selected.filter((id) => siblings.indexOf(id) < right),
        selected.filter((id) => siblings.indexOf(id) >= right),
      ].filter((group) => group.length)
    : [selected];
  return groups.flatMap((group) =>
    createMindSummary(
      store,
      parentId,
      group[0],
      group.at(-1)!,
      allocateId(),
      allocateId(),
    ),
  );
};

/** Change a summary's sibling endpoints without introducing a branch edge. */
export const setMindSummaryRange = (
  store: CellStore,
  edgeId: string,
  startSiblingId: string,
  endSiblingId: string,
): CellOperation[] => {
  const edge = store.cells[edgeId];
  if (!isEdgeCell(edge) || edge.kind !== CellKind.mindSummaryEdge)
    throw new Error('Missing summary edge');
  const previous = edge.data as MindSummaryData;
  const branch = Object.values(store.cells).find(
    (cell): cell is EdgeCell =>
      isEdgeCell(cell) &&
      cell.kind === CellKind.mindBranch &&
      'cellId' in cell.target &&
      cell.target.cellId === previous.startSiblingId,
  );
  if (!branch || !('cellId' in branch.source))
    throw new Error('Missing summary parent');
  const siblings = mindChildIds(store, branch.source.cellId);
  const start = siblings.indexOf(startSiblingId),
    end = siblings.indexOf(endSiblingId);
  if (start < 0 || end < start) throw new Error('Invalid summary range');
  return [
    {
      type: 'replace_cell',
      cell: {
        ...edge,
        source: { cellId: startSiblingId },
        data: { ...previous, startSiblingId, endSiblingId },
      },
    },
  ];
};
