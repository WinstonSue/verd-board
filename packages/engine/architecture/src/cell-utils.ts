import {
  EdgeUtil,
  groupLeafMembers,
  geometryBounds,
  indexCells,
  isFrameCell,
  isNodeCell,
  NodeUtil,
  translateCellSelection,
  type Cell,
  type CellCapabilities,
  type CellMoveContext,
  type CellOperation,
  type CellRegistry,
  type CellStore,
  type EdgeCell,
  type FrameMount,
  type NodeCell,
  type NodeGeometry,
  type Point,
} from '@sue/board-core';
import type { ArchitectureEdgeData } from './types';
import { planArchitectureDrop } from './containers';
import { ArchitectureKind, type ArchitectureLayerData } from './public-api';

export abstract class ArchitectureNodeUtil extends NodeUtil {}
export class ArchitectureLayerNodeUtil extends ArchitectureNodeUtil {
  constructor(private readonly registry?: CellRegistry) {
    super();
  }
  readonly kind = ArchitectureKind.architectureLayer;
  override move(store: CellStore, cell: Cell, geometry: NodeGeometry) {
    if (!isNodeCell(cell)) return [];
    const parent = indexCells(store).parentOf.get(cell.id);
    const old = parent
      ? layoutArchitectureCells(store, parent).get(cell.id)
      : cell.geometry;
    return translateCellSelection(
      store,
      [cell.id],
      [geometry.x - old!.x, geometry.y - old!.y],
      this.registry,
    );
  }
  override capabilities(
    store: CellStore,
    cell: Cell,
    mount: FrameMount,
  ): CellCapabilities {
    return {
      ...super.capabilities(store, cell, mount),
      connect: !cell.locked,
      rotate: false,
      resize: false,
      move: !cell.locked,
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
      (data.layoutPaddingTop !== undefined &&
        (typeof data.layoutPaddingTop !== 'number' ||
          !Number.isFinite(data.layoutPaddingTop) ||
          data.layoutPaddingTop < 0)) ||
      new Set(data.memberIds).size !== data.memberIds.length
    )
      return 'Invalid architecture layer';
    if (
      data.memberIds.some(
        (id) =>
          store.cells[id]?.kind !== ArchitectureKind.architectureModule ||
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
      (id) => store.cells[id]?.kind === ArchitectureKind.architectureLayer,
    ).length;
    return Object.values(cells)
      .filter((cell) => cell.kind === ArchitectureKind.architectureLayer)
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
  constructor(private readonly registry?: CellRegistry) {
    super();
  }
  readonly kind = ArchitectureKind.architectureModule;
  override move(
    store: CellStore,
    cell: Cell,
    geometry: NodeGeometry,
    _targetId?: string,
    _context?: CellMoveContext,
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
    return _context && this.registry
      ? planArchitectureDrop(store, [cell.id], operations, this.registry)
      : operations;
  }
  override resize(store: CellStore, cell: Cell, geometry: NodeGeometry) {
    return this.move(store, cell, geometry);
  }
  override validate(store: CellStore, cell: Cell): string | undefined {
    const layers = Object.values(store.cells).filter(
      (candidate) =>
        candidate.kind === ArchitectureKind.architectureLayer &&
        Array.isArray(
          (candidate as NodeCell<ArchitectureLayerData>).data?.memberIds,
        ) &&
        (candidate as NodeCell<ArchitectureLayerData>).data!.memberIds.includes(
          cell.id,
        ),
    );
    if (layers.length > 1)
      return 'Architecture module cannot belong to multiple layers';
    return undefined;
  }
  optionalPasteOwner(cell: Cell, fragment: { cells: Record<string, Cell> }) {
    return !Object.values(fragment.cells).some(
      (owner) =>
        owner.kind === ArchitectureKind.architectureLayer &&
        (owner as NodeCell<ArchitectureLayerData>).data?.memberIds.includes(
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
      if (cell?.kind === ArchitectureKind.architectureLayer) owners.add(id);
      else {
        const layer = Object.values(store.cells).find(
          (candidate) =>
            candidate.kind === ArchitectureKind.architectureLayer &&
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
    if (context.nested || !isNodeCell(cell)) return cell;
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
        (cell) => cell.kind === ArchitectureKind.architectureLayer,
      )
    )
      return [];
    const layer = store.cells[ownerId];
    const data = (layer as NodeCell<ArchitectureLayerData> | undefined)?.data;
    if (!isNodeCell(layer) || !data || !Array.isArray(data.memberIds))
      return [];
    const added = Object.values(cells).flatMap((cell) =>
      cell.kind === ArchitectureKind.architectureModule
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
  readonly orthogonalRoute = true;
  readonly kind = ArchitectureKind.architectureEdge;
  override validateEdge(store: CellStore, edge: EdgeCell): string | undefined {
    if (
      !('cellId' in edge.source) ||
      !('cellId' in edge.target) ||
      edge.source.cellId === edge.target.cellId
    )
      return 'Invalid architecture dependency';
    const source = store.cells[edge.source.cellId],
      target = store.cells[edge.target.cellId];
    if (
      !source ||
      source.kind !== target?.kind ||
      !['architecture-layer', 'architecture-module'].includes(source.kind)
    )
      return 'Architecture relationships require two layers or two modules';
    const relation = (edge.data as ArchitectureEdgeData | undefined)?.relation;
    if (relation !== undefined && !['dependency', 'flow'].includes(relation))
      return 'Invalid architecture relationship';
    return undefined;
  }
}
export const registerArchitectureCells = (registry: CellRegistry) => {
  [
    new ArchitectureLayerNodeUtil(registry),
    new ArchitectureModuleNodeUtil(registry),
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
        isNodeCell(cell) && cell.kind === ArchitectureKind.architectureLayer,
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
      rectangles.push(geometryBounds(rect));
      result.set(id, rect);
      x += rect.width + 24;
    });
    const minX = rectangles.length
      ? Math.min(...rectangles.map((rect) => rect.x)) - 20
      : 0;
    const minY = rectangles.length
      ? Math.min(...rectangles.map((rect) => rect.y)) -
        Math.max(44, layer.data?.layoutPaddingTop ?? 44)
      : y;
    const right = rectangles.length
      ? Math.max(...rectangles.map((rect) => rect.x + rect.width)) + 20
      : 280;
    const bottom = rectangles.length
      ? Math.max(...rectangles.map((rect) => rect.y + rect.height)) + 16
      : y + 104;
    const envelope = {
      x: minX,
      y: minY,
      width: right - minX,
      height: bottom - minY,
      derived: true,
      outline: 'rectangle',
    } as NodeGeometry;
    if (!layer.geometry.derived) {
      const base = layer.geometry;
      const left = Math.min(base.x, rectangles.length ? minX : base.x);
      const top = Math.min(base.y, rectangles.length ? minY : base.y);
      result.set(layer.id, {
        ...base,
        x: left,
        y: top,
        width:
          Math.max(
            base.x + base.width,
            rectangles.length ? right : base.x + base.width,
          ) - left,
        height:
          Math.max(
            base.y + base.height,
            rectangles.length ? bottom : base.y + base.height,
          ) - top,
      });
    } else result.set(layer.id, envelope);
    y = bottom + 72;
  });
  return result;
};
