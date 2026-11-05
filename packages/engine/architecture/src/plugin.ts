import { isNodeCell, type Cell, type CellPlugin } from '@sue/board-core';
import { layerRows } from './arrangement';
import { registerArchitectureCells } from './cell-utils';
import { ArchitectureKind } from './kinds';
export const createArchitecturePlugin = (): CellPlugin => ({
  id: 'architecture',
  scenes: [
    {
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
