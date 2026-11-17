import {
  resolveCellArrangementScope,
  lockedByAncestor,
  planNodeLayout,
  isNodeCell,
  isFrameCell,
  type Cell,
  type CellPlugin,
} from '@sue/board-core';
import { layoutArchitectureCells } from './cell-utils';
import { layerRows } from './arrangement';
import { registerArchitectureCells } from './cell-utils';
import { ArchitectureKind } from './kinds';
import {
  normalizeArchitectureContainers,
  prepareArchitectureSnapshot,
  planArchitectureDrop,
} from './containers';
export const createArchitecturePlugin = (): CellPlugin => {
  let installedRegistry: import('@sue/board-core').CellRegistry;
  return {
    id: 'architecture',
    prepareSnapshot: prepareArchitectureSnapshot,
    normalize: (before, candidate) =>
      normalizeArchitectureContainers(before, candidate, installedRegistry),
    validateTransaction(before, candidate) {
      for (const frame of Object.values(before.cells)) {
        if (!isFrameCell(frame)) continue;
        const hadVisibleLayer = frame.children.some(
          (id) =>
            before.cells[id]?.kind === 'architecture-layer' &&
            !before.cells[id].hidden,
        );
        const next = candidate.cells[frame.id];
        if (
          hadVisibleLayer &&
          isFrameCell(next) &&
          !next.children.some(
            (id) =>
              candidate.cells[id]?.kind === 'architecture-layer' &&
              !candidate.cells[id].hidden,
          )
        )
          return 'Cannot remove the last visible architecture layer';
      }
      return undefined;
    },
    scenes: [
      {
        geometry: {
          version: 1,
          nodeLayout: 'domain',
          edgeRouting: 'orthogonal',
          defaultStyle: 'layers',
          project: layoutArchitectureCells,
          edgeObstacles(store, frameId, edge, obstacles, geometry) {
            if (
              !('cellId' in edge.source) ||
              store.cells[edge.source.cellId]?.kind !== 'architecture-layer'
            )
              return obstacles;
            const layout = geometry ?? layoutArchitectureCells(store, frameId);
            const boxes = [...layout].flatMap(([id, g]) =>
              store.cells[id]?.kind === 'architecture-layer' &&
              !store.cells[id].hidden
                ? [{ id, ...g }]
                : [],
            );
            return [
              ...obstacles.filter(
                (obstacle) =>
                  !boxes.some(
                    (box) =>
                      obstacle.x >= box.x &&
                      obstacle.y >= box.y &&
                      obstacle.x + obstacle.width <= box.x + box.width &&
                      obstacle.y + obstacle.height <= box.y + box.height,
                  ),
              ),
              ...boxes,
            ];
          },
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
            const candidate = {
              ...context.store,
              cells: { ...context.store.cells },
            };
            for (const op of padding) candidate.cells[op.cell.id] = op.cell;
            const positions = planNodeLayout(
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
            );
            const placed = { ...candidate, cells: { ...candidate.cells } };
            for (const op of positions)
              if (op.type === 'replace_cell')
                placed.cells[op.cell.id] = op.cell;
            const containers = padding.map((op) => {
              const layer = op.cell;
              const old = layoutArchitectureCells(
                context.store,
                context.frameId,
              ).get(layer.id)!;
              const projected = layoutArchitectureCells(
                {
                  ...placed,
                  cells: {
                    ...placed.cells,
                    [layer.id]: {
                      ...layer,
                      geometry: { ...layer.geometry, derived: true },
                    },
                  },
                },
                context.frameId,
              ).get(layer.id)!;
              return {
                type: 'replace_cell' as const,
                cell: {
                  ...layer,
                  geometry: {
                    ...projected,
                    derived: false,
                    width: Math.max(old.width, projected.width),
                    height: Math.max(old.height, projected.height),
                  },
                },
              };
            });
            return [...padding, ...positions, ...containers];
          },
          obstacles(store, frameId, geometry) {
            const projected =
              geometry ?? layoutArchitectureCells(store, frameId);
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
          if (
            Math.max(sg.y, tg.y) < Math.min(sg.y + sg.height, tg.y + tg.height)
          )
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
      installedRegistry = registry;
      registerArchitectureCells({
        ...registry,
        register(util) {
          Object.assign(util, {
            members: (cell: Cell) =>
              isNodeCell(cell) && cell.kind === 'architecture-layer'
                ? (cell.data as { memberIds?: string[] })?.memberIds
                : undefined,
            moveMembers: util.kind === 'architecture-layer',
            planDrop: planArchitectureDrop,
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
            canConnect: (node: Cell) =>
              ['architecture-layer', 'architecture-module'].includes(node.kind),
          });
          registry.register(util);
        },
      });
    },
  };
};
