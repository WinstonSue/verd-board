import {
  isNodeCell,
  isEdgeCell,
  resolveCellArrangementScope,
  collectArrangementBlocks,
  frameLanes,
  planDomainGraphLayout,
  planNodeLayout,
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
      geometry: {
        version: 1,
        nodeLayout: 'domain',
        edgeRouting: 'orthogonal',
        defaultStyle: 'flow',
        resolveLayoutUnits(context) {
          const frame = context.store.cells[context.frameId];
          if (!('children' in frame)) return [];
          return [...frame.children].sort().flatMap((id) => {
            const root = context.store.cells[id];
            if (!isNodeCell(root) || root.kind !== 'workflow-start') return [];
            const nodeIds = (root.data as { memberIds: string[] }).memberIds;
            const members = new Set(nodeIds);
            return [
              {
                id,
                anchorId: id,
                nodeIds,
                edgeIds: frame.children.filter((eid) => {
                  const e = context.store.cells[eid];
                  return (
                    isEdgeCell(e) &&
                    'cellId' in e.source &&
                    members.has(e.source.cellId)
                  );
                }),
              },
            ];
          });
        },
        planLayout(context) {
          const scope = resolveCellArrangementScope(
            context.store,
            context.selection,
          );
          if (
            frameLanes(context.store, context.frameId, context.registry).length
          )
            return planNodeLayout(
              context.store,
              context.selection,
              'flow',
              context.registry,
              context.spacing.nodeGap,
              context.spacing.rankGap,
              true,
            );
          const blocks = collectArrangementBlocks(
            context.store,
            context.frameId,
            scope.ids,
            context.registry,
          );
          const selected = new Set(blocks.flatMap((block) => block.members));
          const roots = Object.values(context.store.cells).filter(
            (cell): cell is import('@sue/board-core').NodeCell =>
              isNodeCell(cell) &&
              cell.kind === 'workflow-start' &&
              (cell.data as { memberIds: string[] }).memberIds.some((id) =>
                selected.has(id),
              ),
          );
          const edges = Object.values(context.store.cells).filter(isEdgeCell);
          const units = roots.length ? roots : [undefined];
          return units.flatMap((root) => {
            const members = root
              ? (root.data as { memberIds: string[] }).memberIds
              : [...selected];
            const ids = blocks
              .filter((block) =>
                block.members.some((id) => members.includes(id)),
              )
              .map((block) => block.id);
            return planDomainGraphLayout(context, {
              ids,
              horizontal: !['vertical', 'flow-vertical'].includes(
                context.style,
              ),
              anchorId: root?.id,
              links: edges.flatMap((e) =>
                e.kind === 'workflow-edge' &&
                'cellId' in e.source &&
                'cellId' in e.target
                  ? [{ source: e.source.cellId, target: e.target.cellId }]
                  : [],
              ),
            });
          });
        },
      },
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
