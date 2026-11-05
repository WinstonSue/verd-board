import {
  isNodeCell,
  parentOf,
  type Cell,
  type CellPlugin,
} from '@sue/board-core';
import { flowRows } from './arrangement';
import { registerWorkflowCells } from './cell-utils';
import { WorkflowKind } from './kinds';
export const createWorkflowPlugin = (): CellPlugin => ({
  id: 'workflow',
  scenes: [
    {
      layouts: [{ id: 'flow', edgeKind: 'workflow-edge', rows: flowRows }],
      preserveAllAnchors: true,
      id: 'workflow',
      sharedKinds: ['swimlane'],
      laneMemberKinds: ['workflow-task', 'workflow-decision'],
      anchorKinds: ['workflow-start'],
      kinds: Object.values(WorkflowKind),
      allowGroups: true,
      consecutiveGroups: false,
      preserveAnchor: true,
    },
  ],
  remap(cell, remap) {
    if (!isNodeCell(cell) || cell.kind !== 'workflow-start') return cell;
    const data = cell.data as { memberIds?: string[] } | undefined;
    return data?.memberIds
      ? { ...cell, data: { ...data, memberIds: data.memberIds.map(remap) } }
      : cell;
  },
  validateTransaction(before, candidate) {
    for (const cell of Object.values(before.cells))
      if (
        cell.kind === 'workflow-start' &&
        candidate.cells[cell.id]?.kind !== 'workflow-start'
      ) {
        const parent = parentOf(before, cell.id);
        if (parent && candidate.cells[parent])
          return 'Cannot delete a workflow start';
      }
    return undefined;
  },
  install(registry) {
    registerWorkflowCells({
      ...registry,
      register(util) {
        Object.assign(util, {
          members: (cell: Cell) =>
            isNodeCell(cell) && cell.kind === 'workflow-start'
              ? (cell.data as { memberIds?: string[] })?.memberIds
              : undefined,
          withMembers: (cell: Cell, ids: readonly string[]) =>
            isNodeCell(cell)
              ? {
                  ...cell,
                  data: { ...(cell.data as object), memberIds: [...ids] },
                }
              : cell,
          fitText: true,
          ownerKind: 'workflow-start',
          translate: (cell: Cell, delta: readonly number[]) => {
            if (cell.kind !== 'workflow-start' || !isNodeCell(cell))
              return cell;
            const data = cell.data as import('./types').WorkflowStartData;
            return {
              ...cell,
              data: {
                ...data,
                origin: [data.origin[0] + delta[0], data.origin[1] + delta[1]],
              },
            };
          },
          canConnect: (node: Cell) =>
            Object.values(WorkflowKind).includes(node.kind as never) &&
            node.cellType === 'node',
        });
        registry.register(util);
      },
    });
  },
});
