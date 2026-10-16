import {
  CellKind,
  groupLeafMembers,
  assertWholeGroupsMoved,
  NodeUtil,
  EdgeUtil,
  indexCells,
  isEdgeCell,
  isNodeCell,
  type Cell,
  type CellStore,
  type CellRegistry,
  type EdgeCell,
  type NodeCell,
  type WorkflowStartData,
  type PortSpec,
  type FrameMount,
  type CellCapabilities,
  type NodeGeometry,
  type CellOperation,
  type Point,
} from '@sue/board-core';

export const workflowCellPorts = (start = false): PortSpec[] =>
  (['top', 'right', 'bottom', 'left'] as const).map((side) => ({
    id: side,
    side,
    direction: start ? 'output' : 'both',
    offset: 0.5,
  }));
const isFinitePoint = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((item) => typeof item === 'number' && Number.isFinite(item));
const isIdList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((id) => typeof id === 'string');
/** Reads workflow anchor fields only after their shapes are known. */
export const workflowStartData = (
  cell: Cell | undefined,
): WorkflowStartData | undefined => {
  if (!isNodeCell(cell) || cell.kind !== CellKind.workflowStart) return;
  const data = cell.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const record = data as Partial<WorkflowStartData>;
  if (record.graphMode !== 'dag' && record.graphMode !== 'process') return;
  if (!isIdList(record.memberIds) || !isFinitePoint(record.origin)) return;
  return {
    graphMode: record.graphMode,
    origin: [record.origin[0], record.origin[1]],
    memberIds: [...record.memberIds],
  };
};
export const workflowStartOf = (
  store: CellStore,
  memberId: string,
): NodeCell<WorkflowStartData> | undefined =>
  Object.values(store.cells).find((cell) =>
    workflowStartData(cell)?.memberIds.includes(memberId),
  ) as NodeCell<WorkflowStartData> | undefined;

export abstract class WorkflowNodeUtil extends NodeUtil {
  override validate(store: CellStore, cell: Cell): string | undefined {
    const owners = Object.values(store.cells).filter((candidate) =>
      workflowStartData(candidate)?.memberIds.includes(cell.id),
    );
    if (owners.length !== 1)
      return 'Workflow nodes must belong to exactly one start';
    const index = indexCells(store);
    if (index.parentOf.get(owners[0].id) !== index.parentOf.get(cell.id))
      return 'Workflow membership crosses frame';
    return undefined;
  }
}
export class WorkflowStartNodeUtil extends WorkflowNodeUtil {
  readonly kind = CellKind.workflowStart;
  override move(
    store: CellStore,
    cell: Cell,
    geometry: NodeGeometry,
  ): CellOperation[] {
    if (!isNodeCell(cell)) return [];
    const data = workflowStartData(cell);
    if (!data) return [];
    const dx = geometry.x - cell.geometry.x,
      dy = geometry.y - cell.geometry.y;
    assertWholeGroupsMoved(store, data.memberIds);
    return [
      {
        type: 'replace_cell',
        cell: {
          ...cell,
          geometry,
          data: { ...data, origin: [data.origin[0] + dx, data.origin[1] + dy] },
        },
      },
      ...data.memberIds
        .filter((id) => id !== cell.id)
        .flatMap((id) => {
          const member = store.cells[id];
          return isNodeCell(member) && !member.geometry.derived
            ? [
                {
                  type: 'replace_cell' as const,
                  cell: {
                    ...member,
                    geometry: {
                      ...member.geometry,
                      x: member.geometry.x + dx,
                      y: member.geometry.y + dy,
                    },
                  },
                },
              ]
            : [];
        }),
    ];
  }
  override capabilities(
    store: CellStore,
    cell: Cell,
    mount: FrameMount,
  ): CellCapabilities {
    return { ...super.capabilities(store, cell, mount), delete: false };
  }
  override validate(store: CellStore, cell: Cell) {
    if (!isNodeCell(cell)) return 'Invalid workflow anchor';
    const data = cell.data;
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return 'Invalid workflow anchor';
    const record = data as Partial<WorkflowStartData>;
    if (record.graphMode !== 'dag' && record.graphMode !== 'process')
      return 'Invalid workflow anchor';
    if (!isIdList(record.memberIds)) return 'Invalid workflow members';
    if (!isFinitePoint(record.origin)) return 'Invalid workflow origin';
    if (!record.memberIds.includes(cell.id)) return 'Invalid workflow anchor';
    const error = super.validate(store, cell);
    if (error) return error;
    if (
      new Set(record.memberIds).size !== record.memberIds.length ||
      record.memberIds.some((id) => {
        const member = store.cells[id];
        return (
          !isNodeCell(member) ||
          ![
            CellKind.workflowStart,
            CellKind.workflowTask,
            CellKind.workflowDecision,
          ].includes(member.kind as never)
        );
      })
    )
      return 'Invalid workflow members';
    const index = indexCells(store);
    if (
      record.memberIds.some(
        (id) => index.parentOf.get(id) !== index.parentOf.get(cell.id),
      )
    )
      return 'Workflow membership crosses frame';
    return undefined;
  }
  adjustPastedCell(cell: Cell, context: { nested: boolean; offset: Point }) {
    if (context.nested || !isNodeCell(cell)) return cell;
    const data = workflowStartData(cell);
    if (!data) return cell;
    return {
      ...cell,
      data: {
        ...(cell.data as object),
        origin: [
          data.origin[0] + context.offset[0],
          data.origin[1] + context.offset[1],
        ] as Point,
      },
    };
  }
}
const fragmentOwnsWorkflowCell = (
  cell: Cell,
  fragment: { cells: Record<string, Cell> },
) =>
  Object.values(fragment.cells).some((candidate) =>
    workflowStartData(candidate)?.memberIds.includes(cell.id),
  );
const workflowPasteOwner = (
  store: CellStore,
  _frameId: string,
  selectionIds: readonly string[],
) => {
  if (!selectionIds.length) return undefined;
  const owners = new Set<string>();
  for (const id of selectionIds.flatMap((id) => groupLeafMembers(store, id))) {
    const cell = store.cells[id];
    if (!cell) return undefined;
    if (cell.kind === CellKind.workflowStart) owners.add(cell.id);
    else {
      const start = workflowStartOf(store, id);
      if (!start) return undefined;
      owners.add(start.id);
    }
  }
  return owners.size === 1 ? [...owners][0] : undefined;
};
const workflowPasteExtras = (
  store: CellStore,
  _frameId: string,
  mapping: ReadonlyMap<string, string>,
  cells: Record<string, Cell>,
  ownerId: string | undefined,
): CellOperation[] => {
  if (!ownerId || Object.values(cells).some((cell) => workflowStartData(cell)))
    return [];
  const start = store.cells[ownerId];
  const data = workflowStartData(start);
  if (!isNodeCell(start) || !data) return [];
  const added = Object.values(cells).flatMap((cell) =>
    cell.kind === CellKind.workflowTask ||
    cell.kind === CellKind.workflowDecision
      ? [mapping.get(cell.id) ?? cell.id]
      : [],
  );
  if (!added.length) return [];
  return [
    {
      type: 'replace_cell',
      cell: {
        ...start,
        data: { ...data, memberIds: [...data.memberIds, ...added] },
      },
    },
  ];
};
const placeDerivedWorkflowNode = (
  cell: Cell,
  context: {
    sourceId: string;
    nested: boolean;
    offset: Point;
    geometry?: ReadonlyMap<string, NodeGeometry>;
    ownerId?: string;
  },
) => {
  if (!context.ownerId || context.nested || !isNodeCell(cell)) return cell;
  const displayed = context.geometry?.get(context.sourceId);
  if (!displayed)
    return { ...cell, geometry: { ...cell.geometry, derived: false } };
  return {
    ...cell,
    geometry: {
      ...cell.geometry,
      x: displayed.x + context.offset[0],
      y: displayed.y + context.offset[1],
      derived: false,
    },
  };
};
export class WorkflowTaskNodeUtil extends WorkflowNodeUtil {
  readonly kind = CellKind.workflowTask;
  requiresPasteOwner(cell: Cell, fragment: { cells: Record<string, Cell> }) {
    return !fragmentOwnsWorkflowCell(cell, fragment);
  }
  pasteOwner = workflowPasteOwner;
  adjustPastedCell = placeDerivedWorkflowNode;
  completePaste = workflowPasteExtras;
}
export class WorkflowDecisionNodeUtil extends WorkflowNodeUtil {
  readonly kind = CellKind.workflowDecision;
  requiresPasteOwner(cell: Cell, fragment: { cells: Record<string, Cell> }) {
    return !fragmentOwnsWorkflowCell(cell, fragment);
  }
  pasteOwner = workflowPasteOwner;
  adjustPastedCell = placeDerivedWorkflowNode;
  completePaste = workflowPasteExtras;
}
const rejectWorkflowCycle = (
  store: CellStore,
  _frameId: string,
  cells: Record<string, Cell>,
  ownerId: string | undefined,
) => {
  const owner = ownerId ? workflowStartData(store.cells[ownerId]) : undefined;
  if (!owner || owner.graphMode !== 'dag') return undefined;
  if (Object.values(cells).some((cell) => workflowStartData(cell))) return;
  const ids = new Set(
    Object.values(cells)
      .filter(
        (cell) =>
          cell.kind === CellKind.workflowTask ||
          cell.kind === CellKind.workflowDecision,
      )
      .map((cell) => cell.id),
  );
  const next = new Map<string, string[]>();
  Object.values(cells).forEach((cell) => {
    if (
      !isEdgeCell(cell) ||
      cell.kind !== CellKind.workflowEdge ||
      !('cellId' in cell.source) ||
      !('cellId' in cell.target) ||
      !ids.has(cell.source.cellId) ||
      !ids.has(cell.target.cellId)
    )
      return;
    next.set(cell.source.cellId, [
      ...(next.get(cell.source.cellId) ?? []),
      cell.target.cellId,
    ]);
  });
  const visit = (id: string, stack: Set<string>): boolean => {
    if (stack.has(id)) return true;
    stack.add(id);
    if ((next.get(id) ?? []).some((target) => visit(target, stack)))
      return true;
    stack.delete(id);
    return false;
  };
  return [...ids].some((id) => visit(id, new Set()))
    ? 'Cycle in DAG workflow'
    : undefined;
};
export class WorkflowEdgeUtil extends EdgeUtil {
  readonly kind = CellKind.workflowEdge;
  rejectPaste = rejectWorkflowCycle;
  override validateEdge(store: CellStore, edge: EdgeCell): string | undefined {
    if (!('cellId' in edge.source) || !('cellId' in edge.target))
      return 'Workflow endpoints must be nodes';
    const sourceId = edge.source.cellId,
      targetId = edge.target.cellId;
    if (sourceId === targetId) return 'Workflow self connection';
    const source = store.cells[sourceId],
      target = store.cells[targetId];
    if (!isNodeCell(source) || !isNodeCell(target))
      return 'Invalid workflow endpoints';
    if (target.kind === CellKind.workflowStart)
      return 'Cannot connect to a start';
    const graph = workflowStartOf(store, sourceId);
    if (!graph || workflowStartOf(store, targetId)?.id !== graph.id)
      return 'Workflow edges must stay in one graph';
    const sourcePort = source.ports?.find(
      (port) =>
        port.id === ('portId' in edge.source ? edge.source.portId : undefined),
    );
    const targetPort = target.ports?.find(
      (port) =>
        port.id === ('portId' in edge.target ? edge.target.portId : undefined),
    );
    if (
      !sourcePort ||
      !targetPort ||
      sourcePort.direction === 'input' ||
      targetPort.direction === 'output'
    )
      return 'Incompatible workflow ports';
    const edges = Object.values(store.cells).filter(
      (cell): cell is EdgeCell =>
        isEdgeCell(cell) &&
        cell.kind === CellKind.workflowEdge &&
        cell.id !== edge.id,
    );
    if (
      edges.some(
        (cell) =>
          'cellId' in cell.source &&
          'cellId' in cell.target &&
          cell.source.cellId === sourceId &&
          cell.target.cellId === targetId,
      )
    )
      return 'Duplicate workflow connection';
    if (graph.data?.graphMode === 'dag') {
      const visit = (id: string, seen: Set<string>): boolean => {
        if (id === sourceId) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return edges.some(
          (cell) =>
            'cellId' in cell.source &&
            'cellId' in cell.target &&
            cell.source.cellId === id &&
            visit(cell.target.cellId, seen),
        );
      };
      if (visit(targetId, new Set())) return 'Cycle in DAG workflow';
    }
    return undefined;
  }
}
export const registerWorkflowCells = (registry: CellRegistry) => {
  [
    new WorkflowStartNodeUtil(),
    new WorkflowTaskNodeUtil(),
    new WorkflowDecisionNodeUtil(),
    new WorkflowEdgeUtil(),
  ].forEach((util) => registry.register(util));
};
