import {
  CellKind,
  groupLeafMembers,
  NodeUtil,
  EdgeUtil,
  indexCells,
  isNodeCell,
  type Cell,
  type CellStore,
  type CellRegistry,
  type EdgeCell,
  type NodeCell,
  type ArchitectureLayerData,
  type CellCapabilities,
  type FrameMount,
  type NodeGeometry,
  type CellMoveContext,
  type CellOperation,
  type Point,
  isFrameCell,
} from '@sue/board-core';
import { moveArchitectureModuleToLayer } from './cell-commands';

export abstract class ArchitectureNodeUtil extends NodeUtil {}
export class ArchitectureLayerNodeUtil extends ArchitectureNodeUtil {
  readonly kind = CellKind.architectureLayer;
  override capabilities(
    store: CellStore,
    cell: Cell,
    mount: FrameMount,
  ): CellCapabilities {
    return {
      ...super.capabilities(store, cell, mount),
      connect: false,
      rotate: false,
      resize: false,
      move: false,
    };
  }
  override validate(store: CellStore, cell: Cell): string | undefined {
    const data = (cell as NodeCell<ArchitectureLayerData>).data;
    const index = indexCells(store);
    if (
      !data ||
      typeof data !== 'object' ||
      typeof data.order !== 'string' ||
      !Array.isArray(data.memberIds) ||
      data.memberIds.some((id) => typeof id !== 'string') ||
      new Set(data.memberIds).size !== data.memberIds.length
    )
      return 'Invalid architecture layer';
    if (
      data.memberIds.some(
        (id) =>
          store.cells[id]?.kind !== CellKind.architectureModule ||
          index.parentOf.get(id) !== index.parentOf.get(cell.id),
      )
    )
      return 'Invalid layer membership';
    return undefined;
  }
  completePaste(
    store: CellStore,
    frameId: string,
    mapping: ReadonlyMap<string, string>,
    cells: Record<string, Cell>,
  ): CellOperation[] {
    const frame = store.cells[frameId];
    if (!isFrameCell(frame)) return [];
    const existing = frame.children.filter(
      (id) => store.cells[id]?.kind === CellKind.architectureLayer,
    ).length;
    return Object.values(cells)
      .filter((cell) => cell.kind === CellKind.architectureLayer)
      .sort((left, right) =>
        (
          (left as NodeCell<ArchitectureLayerData>).data?.order ?? ''
        ).localeCompare(
          (right as NodeCell<ArchitectureLayerData>).data?.order ?? '',
        ),
      )
      .map((cell, index) => {
        const data = (cell as NodeCell<ArchitectureLayerData>).data;
        const members = Array.isArray(data?.memberIds) ? data.memberIds : [];
        return {
          type: 'replace_cell' as const,
          cell: {
            ...cell,
            id: mapping.get(cell.id) ?? cell.id,
            data: {
              order: String(existing + index).padStart(8, '0'),
              memberIds: members.map((id) => mapping.get(id) ?? id),
            },
          },
        };
      });
  }
}
export class ArchitectureModuleNodeUtil extends ArchitectureNodeUtil {
  readonly kind = CellKind.architectureModule;
  override move(
    store: CellStore,
    cell: Cell,
    geometry: NodeGeometry,
    _targetId?: string,
    context?: CellMoveContext,
  ) {
    const operations = isNodeCell(cell)
      ? [
          {
            type: 'replace_cell' as const,
            cell: {
              ...cell,
              geometry: { ...geometry, derived: false },
              data: { ...(cell.data as object), placed: true },
            },
          },
        ]
      : [];
    const index = indexCells(store);
    const parent = index.parentOf.get(cell.id);
    const target =
      context &&
      Object.values(store.cells).find((candidate) => {
        if (
          candidate.kind !== CellKind.architectureLayer ||
          index.parentOf.get(candidate.id) !== parent
        )
          return false;
        const bounds = context.geometry.get(candidate.id);
        return (
          bounds &&
          context.point[0] >= bounds.x &&
          context.point[0] <= bounds.x + bounds.width &&
          context.point[1] >= bounds.y &&
          context.point[1] <= bounds.y + bounds.height
        );
      });
    return target
      ? [
          ...operations,
          ...moveArchitectureModuleToLayer(store, cell.id, target.id),
        ]
      : operations;
  }
  override resize(store: CellStore, cell: Cell, geometry: NodeGeometry) {
    return this.move(store, cell, geometry);
  }
  override validate(store: CellStore, cell: Cell): string | undefined {
    const layers = Object.values(store.cells).filter(
      (candidate) =>
        candidate.kind === CellKind.architectureLayer &&
        Array.isArray(
          (candidate as NodeCell<ArchitectureLayerData>).data?.memberIds,
        ) &&
        (candidate as NodeCell<ArchitectureLayerData>).data!.memberIds.includes(
          cell.id,
        ),
    );
    if (layers.length !== 1)
      return 'Architecture module must belong to exactly one layer';
    return undefined;
  }
  requiresPasteOwner(cell: Cell, fragment: { cells: Record<string, Cell> }) {
    return !Object.values(fragment.cells).some(
      (candidate) =>
        candidate.kind === CellKind.architectureLayer &&
        Array.isArray(
          (candidate as NodeCell<ArchitectureLayerData>).data?.memberIds,
        ) &&
        (candidate as NodeCell<ArchitectureLayerData>).data!.memberIds.includes(
          cell.id,
        ),
    );
  }
  pasteOwner(
    store: CellStore,
    _frameId: string,
    selectionIds: readonly string[],
  ) {
    if (!selectionIds.length) return undefined;
    const owners = new Set<string>();
    for (const id of selectionIds.flatMap((id) =>
      groupLeafMembers(store, id),
    )) {
      const cell = store.cells[id];
      if (cell?.kind === CellKind.architectureLayer) owners.add(id);
      else {
        const layer = Object.values(store.cells).find(
          (candidate) =>
            candidate.kind === CellKind.architectureLayer &&
            Array.isArray(
              (candidate as NodeCell<ArchitectureLayerData>).data?.memberIds,
            ) &&
            (
              candidate as NodeCell<ArchitectureLayerData>
            ).data!.memberIds.includes(id),
        );
        if (!layer) return undefined;
        owners.add(layer.id);
      }
    }
    return owners.size === 1 ? [...owners][0] : undefined;
  }
  adjustPastedCell(
    cell: Cell,
    context: {
      sourceId: string;
      nested: boolean;
      offset: Point;
      ownerId?: string;
      geometry?: ReadonlyMap<string, NodeGeometry>;
    },
  ) {
    if (!context.ownerId || context.nested || !isNodeCell(cell)) return cell;
    const displayed = context.geometry?.get(context.sourceId);
    return {
      ...cell,
      geometry: displayed
        ? {
            ...cell.geometry,
            x: displayed.x + context.offset[0],
            y: displayed.y + context.offset[1],
            derived: false,
          }
        : { ...cell.geometry, derived: false },
      data: { ...(cell.data as object), placed: true },
    };
  }
  completePaste(
    store: CellStore,
    _frameId: string,
    mapping: ReadonlyMap<string, string>,
    cells: Record<string, Cell>,
    ownerId: string | undefined,
  ): CellOperation[] {
    if (
      !ownerId ||
      Object.values(cells).some(
        (cell) => cell.kind === CellKind.architectureLayer,
      )
    )
      return [];
    const layer = store.cells[ownerId];
    const data = (layer as NodeCell<ArchitectureLayerData> | undefined)?.data;
    if (!isNodeCell(layer) || !data || !Array.isArray(data.memberIds))
      return [];
    const added = Object.values(cells).flatMap((cell) =>
      cell.kind === CellKind.architectureModule
        ? [mapping.get(cell.id) ?? cell.id]
        : [],
    );
    if (!added.length) return [];
    return [
      {
        type: 'replace_cell',
        cell: {
          ...layer,
          data: { ...data, memberIds: [...data.memberIds, ...added] },
        },
      },
    ];
  }
}
export class ArchitectureEdgeUtil extends EdgeUtil {
  readonly kind = CellKind.architectureEdge;
  override validateEdge(store: CellStore, edge: EdgeCell): string | undefined {
    if (
      !('cellId' in edge.source) ||
      !('cellId' in edge.target) ||
      edge.source.cellId === edge.target.cellId
    )
      return 'Invalid architecture dependency';
    if (
      store.cells[edge.source.cellId]?.kind !== CellKind.architectureModule ||
      store.cells[edge.target.cellId]?.kind !== CellKind.architectureModule
    )
      return 'Only modules can connect';
    return undefined;
  }
}
export const registerArchitectureCells = (registry: CellRegistry) => {
  [
    new ArchitectureLayerNodeUtil(),
    new ArchitectureModuleNodeUtil(),
    new ArchitectureEdgeUtil(),
  ].forEach((util) => registry.register(util));
};

/** Direct layers in layout order, preserving child order when sort keys tie. */
export const architectureLayerIds = (
  store: CellStore,
  frameId: string,
): string[] => {
  const frame = store.cells[frameId];
  if (!isFrameCell(frame)) return [];
  return frame.children
    .map((id) => store.cells[id])
    .filter(
      (cell): cell is NodeCell<ArchitectureLayerData> =>
        isNodeCell(cell) && cell.kind === CellKind.architectureLayer,
    )
    .sort((a, b) => (a.data?.order ?? '').localeCompare(b.data?.order ?? ''))
    .map((layer) => layer.id);
};

/** Derived geometry is computed without rewriting the saved module positions. */
export const layoutArchitectureCells = (
  store: CellStore,
  frameId: string,
): Map<string, NodeGeometry> => {
  const result = new Map<string, NodeGeometry>();
  let y = 0;
  architectureLayerIds(store, frameId).forEach((layerId) => {
    const layer = store.cells[layerId] as NodeCell<ArchitectureLayerData>;
    let x = 20;
    const rectangles: NodeGeometry[] = [];
    const memberIds = Array.isArray(layer.data?.memberIds)
      ? layer.data.memberIds
      : [];
    memberIds.forEach((id) => {
      const node = store.cells[id];
      if (!isNodeCell(node)) return;
      const rect =
        node.geometry.derived &&
        !(node.data as { placed?: boolean } | undefined)?.placed
          ? { ...node.geometry, x, y: y + 44 }
          : { ...node.geometry };
      rectangles.push(rect);
      result.set(id, rect);
      x += rect.width + 24;
    });
    const minX = rectangles.length
      ? Math.min(...rectangles.map((rect) => rect.x)) - 20
      : 0;
    const minY = rectangles.length
      ? Math.min(...rectangles.map((rect) => rect.y)) - 44
      : y;
    const right = rectangles.length
      ? Math.max(...rectangles.map((rect) => rect.x + rect.width)) + 20
      : 280;
    const bottom = rectangles.length
      ? Math.max(...rectangles.map((rect) => rect.y + rect.height)) + 16
      : y + 104;
    result.set(layer.id, {
      x: minX,
      y: minY,
      width: right - minX,
      height: bottom - minY,
      derived: true,
      outline: 'rectangle',
    });
    y = bottom + 72;
  });
  return result;
};
