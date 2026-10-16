import {
  createFrameCell,
  assertWholeGroupsMoved,
  groupAncestors,
  indexCells,
  arrangeCells,
  isFrameCell,
  createCellStore,
  CellKind,
  isNodeCell,
  isEdgeCell,
  type CellStore,
  type NodeCell,
  type WorkflowStartData,
  type CellOperation,
  type Point,
  type FrameSnapshot,
} from '@sue/board-core';
import { layoutDag } from '@sue/board-layouts';
import { workflowCellPorts, workflowStartOf } from './cell-utils';
export const createWorkflowStartCell = (
  id: string,
  origin: Point = [40, 80],
): NodeCell<WorkflowStartData> => ({
  id,
  kind: CellKind.workflowStart,
  cellType: 'node',
  geometry: {
    x: origin[0],
    y: origin[1],
    width: 120,
    height: 40,
    outline: 'terminal',
  },
  ports: workflowCellPorts(true),
  content: { label: 'Start' },
  data: { graphMode: 'dag', origin, memberIds: [id] },
});
export const createWorkflowTaskCell = (
  id: string,
  decision = false,
): NodeCell => ({
  id,
  kind: decision ? CellKind.workflowDecision : CellKind.workflowTask,
  cellType: 'node',
  geometry: {
    x: 0,
    y: 0,
    width: decision ? 120 : 160,
    height: decision ? 80 : 48,
    outline: decision ? 'diamond' : 'roundRectangle',
    derived: true,
  },
  ports: workflowCellPorts(),
  content: { label: decision ? 'Decision' : 'Task' },
});
export const createWorkflowFrameSnapshot = (
  frameId: string,
  startId: string,
): FrameSnapshot => {
  const root = createFrameCell(frameId);
  root.children = [startId];
  return {
    store: {
      ...createCellStore(root),
      cells: { [frameId]: root, [startId]: createWorkflowStartCell(startId) },
    },
  };
};
export const addWorkflowTask = (
  store: CellStore,
  startId: string,
  node: NodeCell,
): CellOperation[] => {
  const start = store.cells[startId];
  if (!isNodeCell(start) || start.kind !== CellKind.workflowStart)
    throw new Error('Missing workflow start');
  const data = (start as NodeCell<WorkflowStartData>).data!;
  const frame = Object.values(store.cells).find(
    (cell) =>
      cell.cellType === 'frame' &&
      (cell as import('@sue/board-core').FrameCell).children.includes(startId),
  );
  if (!frame) throw new Error('Missing workflow frame');
  return [
    {
      type: 'insert_cell',
      cell: node.geometry.derived
        ? {
            ...node,
            geometry: {
              ...node.geometry,
              x: start.geometry.x,
              y:
                Math.max(
                  start.geometry.y + start.geometry.height,
                  ...data.memberIds.map((id) => {
                    const member = store.cells[id];
                    return isNodeCell(member)
                      ? member.geometry.y + member.geometry.height
                      : start.geometry.y;
                  }),
                ) + 32,
              derived: false,
            },
          }
        : node,
      parentId: frame.id,
    },
    {
      type: 'replace_cell',
      cell: {
        ...start,
        data: { ...data, memberIds: [...data.memberIds, node.id] },
      },
    },
  ];
};
export const layoutWorkflowCells = (store: CellStore, frameId: string) => {
  const result = new Map<string, import('@sue/board-core').NodeGeometry>();
  const frame = store.cells[frameId];
  if (frame?.cellType !== 'frame') return result;
  (frame as import('@sue/board-core').FrameCell).children.forEach((id) => {
    const start = store.cells[id];
    if (!isNodeCell(start) || start.kind !== CellKind.workflowStart) return;
    const data = (start as NodeCell<WorkflowStartData>).data!;
    const nodes = data.memberIds
      .map((id) => store.cells[id])
      .filter(isNodeCell);
    const edges = Object.values(store.cells)
      .filter(isEdgeCell)
      .filter(
        (edge) =>
          edge.kind === CellKind.workflowEdge &&
          'cellId' in edge.source &&
          workflowStartOf(store, edge.source.cellId)?.id === start.id,
      )
      .flatMap((edge) =>
        'cellId' in edge.source && 'cellId' in edge.target
          ? [{ source: edge.source.cellId, target: edge.target.cellId }]
          : [],
      );
    const layout = layoutDag(
      nodes.map((node) => ({
        id: node.id,
        width: node.geometry.width,
        height: node.geometry.height,
      })),
      edges,
    );
    const anchor = layout.positions[start.id] ?? [0, 0];
    nodes.forEach((node) => {
      const point = layout.positions[node.id];
      if (node.geometry.derived && point)
        result.set(node.id, {
          ...node.geometry,
          x: point[0] - anchor[0] + data.origin[0],
          y: point[1] - anchor[1] + data.origin[1],
        });
    });
  });
  return result;
};

const workflowGraph = (store: CellStore, startId: string) => {
  const start = store.cells[startId];
  if (!isNodeCell(start) || start.kind !== CellKind.workflowStart)
    throw new Error('Missing workflow start');
  const ids = new Set((start.data as WorkflowStartData).memberIds);
  const nodes = [...ids].map((id) => store.cells[id]).filter(isNodeCell);
  const edges = Object.values(store.cells)
    .filter(isEdgeCell)
    .flatMap((edge) =>
      edge.kind === CellKind.workflowEdge &&
      'cellId' in edge.source &&
      'cellId' in edge.target &&
      ids.has(edge.source.cellId) &&
      ids.has(edge.target.cellId)
        ? [{ source: edge.source.cellId, target: edge.target.cellId }]
        : [],
    );
  return { start, nodes, edges };
};

export const canAutoLayoutWorkflow = (
  store: CellStore,
  startId: string,
): boolean => {
  const { nodes, edges } = workflowGraph(store, startId);
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  edges.forEach((edge) =>
    incoming.set(edge.target, incoming.get(edge.target)! + 1),
  );
  const ready = nodes
    .filter((node) => incoming.get(node.id) === 0)
    .map((node) => node.id);
  let visited = 0;
  while (ready.length) {
    const id = ready.pop()!;
    visited++;
    edges
      .filter((edge) => edge.source === id)
      .forEach((edge) => {
        const count = incoming.get(edge.target)! - 1;
        incoming.set(edge.target, count);
        if (!count) ready.push(edge.target);
      });
  }
  return visited === nodes.length;
};

/** Lay out only the selected graph, retaining its start position and one undo step. */
export const autoLayoutWorkflow = (
  store: CellStore,
  startId: string,
): CellOperation[] => {
  if (!canAutoLayoutWorkflow(store, startId))
    throw new Error('Cannot auto layout a cyclic workflow');
  const { start, nodes, edges } = workflowGraph(store, startId);
  assertWholeGroupsMoved(
    store,
    nodes.map((node) => node.id),
  );
  if (nodes.some((node) => groupAncestors(store, node.id).length)) {
    const ids = [
      ...new Set(
        nodes.map((node) => groupAncestors(store, node.id).at(-1) ?? node.id),
      ),
    ];
    return arrangeCells(
      store,
      indexCells(store).parentOf.get(startId)!,
      ids,
      'flow',
    );
  }
  const layout = layoutDag(
    nodes.map((node) => ({
      id: node.id,
      width: node.geometry.width,
      height: node.geometry.height,
    })),
    edges,
  );
  const origin = layout.positions[startId];
  return nodes.map((node) => ({
    type: 'replace_cell',
    cell: {
      ...node,
      geometry: {
        ...node.geometry,
        x: start.geometry.x + layout.positions[node.id][0] - origin[0],
        y: start.geometry.y + layout.positions[node.id][1] - origin[1],
        derived: false,
      },
    },
  }));
};

/** Idempotent compatibility conversion: preserve the old displayed positions. */
export function materializeWorkflowPositions(store: CellStore): CellStore {
  let cells = store.cells;
  for (const frame of Object.values(store.cells).filter(isFrameCell)) {
    const layout = layoutWorkflowCells(store, frame.id);
    for (const [id, geometry] of layout) {
      const cell = store.cells[id];
      if (
        !isNodeCell(cell) ||
        !['workflow-task', 'workflow-decision'].includes(cell.kind) ||
        !cell.geometry.derived
      )
        continue;
      if (cells === store.cells) cells = { ...cells };
      cells[id] = { ...cell, geometry: { ...geometry, derived: false } };
    }
  }
  return cells === store.cells ? store : { ...store, cells };
}
