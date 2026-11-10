import {
  applyCellOperations,
  resolveCellArrangementScope,
  lockedByAncestor,
  planNodeLayout,
  isNodeCell,
  type Cell,
  type CellPlugin,
} from '@sue/board-core';
import { layoutArchitectureCells } from './cell-utils';
import { layerRows } from './arrangement';
import { registerArchitectureCells } from './cell-utils';
import { ArchitectureKind } from './kinds';
export const createArchitecturePlugin = (): CellPlugin => ({
  id: 'architecture',
  scenes: [
    {
      geometry: {
        version: 1,
        nodeLayout: 'domain',
        edgeRouting: 'orthogonal',
        defaultStyle: 'layers',
        project: layoutArchitectureCells,
        fixedNodeIds: (context) =>
          Object.values(context.store.cells).flatMap((cell) =>
            isNodeCell(cell) &&
            cell.kind === 'architecture-layer' &&
            (cell.locked || lockedByAncestor(context.store, cell.id))
              ? (cell.data as { memberIds: string[] }).memberIds
              : [],
          ),
        planLayout(context) {
          const scope = resolveCellArrangementScope(
            context.store,
            context.selection,
          );
          const padding = scope.ids.flatMap((id) => {
            const c = context.store.cells[id];
            return isNodeCell(c) &&
              c.kind === 'architecture-layer' &&
              !c.locked &&
              !lockedByAncestor(context.store, id)
              ? [
                  {
                    type: 'replace_cell' as const,
                    cell: {
                      ...c,
                      data: {
                        ...(c.data as object),
                        layoutPaddingTop: Math.max(
                          96,
                          (c.data as { layoutPaddingTop?: number })
                            ?.layoutPaddingTop ?? 0,
                        ),
                      },
                    },
                  },
                ]
              : [];
          });
          const candidate = applyCellOperations(
            context.store,
            padding,
            context.registry,
          );
          return [
            ...padding,
            ...planNodeLayout(
              candidate,
              context.selection,
              'layers',
              context.registry,
              context.spacing.nodeGap,
              context.spacing.rankGap,
              true,
            ).filter(
              (op) =>
                op.type !== 'replace_cell' ||
                !Object.values(context.store.cells).some(
                  (owner) =>
                    isNodeCell(owner) &&
                    owner.kind === 'architecture-layer' &&
                    (owner.locked ||
                      lockedByAncestor(context.store, owner.id)) &&
                    (owner.data as { memberIds: string[] }).memberIds.includes(
                      op.cell.id,
                    ),
                ),
            ),
          ];
        },
        obstacles(store, frameId, geometry) {
          const projected = geometry ?? layoutArchitectureCells(store, frameId);
          return [...projected].flatMap(([id, g]) =>
            store.cells[id]?.kind === 'architecture-layer' &&
            !store.cells[id].hidden &&
            !!(store.cells[id] as import('@sue/board-core').NodeCell).content
              ?.label
              ? [
                  {
                    id: `${id}:header`,
                    x: g.x + 12,
                    y: g.y + 4,
                    width: Math.max(
                      0,
                      Math.min(
                        g.width - 24,
                        Math.max(
                          48,
                          16 +
                            [
                              ...((
                                store.cells[
                                  id
                                ] as import('@sue/board-core').NodeCell
                              ).content?.label ?? ''),
                            ].reduce(
                              (sum, c) =>
                                sum + (c.charCodeAt(0) > 255 ? 16 : 8),
                              0,
                            ),
                        ),
                      ),
                    ),
                    height: 32,
                  },
                ]
              : [],
          );
        },
      },
      layouts: [
        { id: 'layers', edgeKind: 'architecture-edge', rows: layerRows },
      ],
      routing(store, edge, geometry) {
        if (
          edge.kind !== 'architecture-edge' ||
          !('cellId' in edge.source) ||
          !('cellId' in edge.target)
        )
          return;
        const sourceId = edge.source.cellId,
          targetId = edge.target.cellId;
        const source = store.cells[sourceId],
          target = store.cells[targetId];
        if (!isNodeCell(source) || !isNodeCell(target)) return;
        const layers = Object.values(store.cells).filter(
          (cell): cell is import('@sue/board-core').NodeCell =>
            isNodeCell(cell) && cell.kind === 'architecture-layer',
        );
        const owner = (id: string) =>
          layers.find((cell) =>
            (cell.data as { memberIds?: string[] })?.memberIds?.includes(id),
          );
        const a = owner(sourceId),
          b = owner(targetId);
        if (!a || !b) return;
        const sg = geometry?.get(sourceId) ?? source.geometry,
          tg = geometry?.get(targetId) ?? target.geometry;
        if (a.id === b.id)
          return sg.x + sg.width / 2 <= tg.x + tg.width / 2
            ? { source: 'right', target: 'left' }
            : { source: 'left', target: 'right' };
        // Real geometry wins when a module was manually dragged out of its band.
        if (Math.max(sg.y, tg.y) < Math.min(sg.y + sg.height, tg.y + tg.height))
          return;
        return sg.y < tg.y
          ? { source: 'bottom', target: 'top' }
          : { source: 'top', target: 'bottom' };
      },
      id: 'architecture',
      sharedKinds: ['swimlane'],
      laneMemberKinds: ['architecture-module'],
      anchorKinds: ['architecture-layer'],
      kinds: Object.values(ArchitectureKind),
      allowGroups: true,
      consecutiveGroups: false,
      preserveAnchor: true,
    },
  ],
  remap(cell, remap) {
    if (!isNodeCell(cell) || cell.kind !== 'architecture-layer') return cell;
    const data = cell.data as { memberIds?: string[] } | undefined;
    return data?.memberIds
      ? { ...cell, data: { ...data, memberIds: data.memberIds.map(remap) } }
      : cell;
  },
  deletionClosure(_store, cell) {
    return cell.kind === 'architecture-layer'
      ? ((
          cell as import('@sue/board-core').NodeCell<
            import('./types').ArchitectureLayerData
          >
        ).data?.memberIds ?? [])
      : [];
  },
  install(registry) {
    registerArchitectureCells({
      ...registry,
      register(util) {
        Object.assign(util, {
          members: (cell: Cell) =>
            isNodeCell(cell) && cell.kind === 'architecture-layer'
              ? (cell.data as { memberIds?: string[] })?.memberIds
              : undefined,
          withMembers: (cell: Cell, ids: readonly string[]) =>
            isNodeCell(cell)
              ? {
                  ...cell,
                  data: { ...(cell.data as object), memberIds: [...ids] },
                }
              : cell,
          fitText: util.kind === 'architecture-module',
          groupable: util.kind !== 'architecture-layer',
          arrangeable: util.kind !== 'architecture-layer',
          routingObstacle: util.kind !== 'architecture-layer',
          translate: (cell: Cell) =>
            isNodeCell(cell) && cell.kind === 'architecture-module'
              ? { ...cell, data: { ...(cell.data as object), placed: true } }
              : cell,
          ownerKind: 'architecture-layer',
          canConnect: (node: Cell) => node.kind === 'architecture-module',
        });
        registry.register(util);
      },
    });
  },
});
