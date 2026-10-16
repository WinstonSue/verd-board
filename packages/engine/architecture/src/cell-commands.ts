import {
  createFrameCell,
  CellKind,
  isNodeCell,
  indexCells,
  lockedByAncestor,
  type NodeCell,
  type ArchitectureLayerData,
  type CellStore,
  type CellOperation,
  type FrameSnapshot,
} from '@sue/board-core';
import { layoutArchitectureCells } from './cell-utils';
export const createArchitectureLayerCell = (
  id: string,
  order = '0000',
): NodeCell<ArchitectureLayerData> => ({
  id,
  kind: CellKind.architectureLayer,
  cellType: 'node',
  geometry: {
    x: 0,
    y: 0,
    width: 280,
    height: 104,
    derived: true,
    outline: 'rectangle',
  },
  content: { label: '' },
  data: { order, memberIds: [] },
});
export const createArchitectureModuleCell = (
  id: string,
  shape: 'box' | 'decision' | 'store' = 'box',
): NodeCell => ({
  id,
  kind: CellKind.architectureModule,
  cellType: 'node',
  geometry: {
    x: 0,
    y: 0,
    width: shape === 'box' ? 240 : 160,
    height: shape === 'box' ? 44 : 88,
    derived: true,
    outline:
      shape === 'box'
        ? 'roundRectangle'
        : shape === 'decision'
          ? 'diamond'
          : 'store',
  },
  content: { label: 'Module' },
  ports: (['top', 'right', 'bottom', 'left'] as const).map((side) => ({
    id: side,
    side,
    direction: 'both',
  })),
  data: { shape },
});
export const createArchitectureFrameSnapshot = (
  frameId: string,
  layerId: string,
): FrameSnapshot => {
  const root = createFrameCell(frameId);
  root.children = [layerId];
  return {
    store: {
      rootId: frameId,
      cells: {
        [frameId]: root,
        [layerId]: createArchitectureLayerCell(layerId),
      },
    },
  };
};
export const addArchitectureModule = (
  store: CellStore,
  layerId: string,
  node: NodeCell,
): CellOperation[] => {
  const layer = store.cells[layerId];
  if (!isNodeCell(layer) || layer.kind !== CellKind.architectureLayer)
    throw new Error('Missing architecture layer');
  const data = (layer as NodeCell<ArchitectureLayerData>).data!,
    parentId = indexCells(store).parentOf.get(layerId);
  if (!parentId) throw new Error('Missing architecture frame');
  return [
    {
      type: 'insert_cell',
      cell: node.geometry.derived
        ? {
            ...node,
            geometry: {
              ...node.geometry,
              x: Math.max(
                20,
                ...data.memberIds.map((id) => {
                  const member = store.cells[id];
                  return isNodeCell(member)
                    ? member.geometry.x + member.geometry.width + 32
                    : 20;
                }),
              ),
              y: layoutArchitectureCells(store, parentId).get(layerId)!.y + 44,
              derived: false,
            },
            data: { ...(node.data as object), placed: true },
          }
        : node,
      parentId,
    },
    {
      type: 'replace_cell',
      cell: {
        ...layer,
        data: { ...data, memberIds: [...data.memberIds, node.id] },
      },
    },
  ];
};

/** Membership changes are committed together so a module never has two owners. */
export const moveArchitectureModuleToLayer = (
  store: CellStore,
  moduleId: string,
  layerId: string,
  options: { position?: 'preserve' | 'inside-layer' } = {},
): CellOperation[] => {
  const module = store.cells[moduleId],
    target = store.cells[layerId];
  if (
    !isNodeCell(module) ||
    module.kind !== CellKind.architectureModule ||
    !isNodeCell(target) ||
    target.kind !== CellKind.architectureLayer
  )
    throw new Error('Invalid architecture layer move');
  const index = indexCells(store);
  if (index.parentOf.get(moduleId) !== index.parentOf.get(layerId))
    throw new Error('Architecture membership crosses frame');
  const source = store.cells[
    index.domainOwnerOf.get(moduleId)!
  ] as NodeCell<ArchitectureLayerData>;
  if (!source?.data) throw new Error('Missing architecture owner');
  if (source.id === layerId) return [];
  if (
    module.locked ||
    target.locked ||
    lockedByAncestor(store, module.id) ||
    lockedByAncestor(store, target.id)
  )
    throw new Error('Cannot move locked architecture content');
  const frame = store.cells[
    index.parentOf.get(moduleId)!
  ] as import('@sue/board-core').FrameCell;
  const layers = frame.children.filter(
    (id) => store.cells[id].kind === CellKind.architectureLayer,
  );
  const targetBounds = layoutArchitectureCells(store, frame.id).get(layerId)!;
  const placement: CellOperation[] =
    options.position === 'inside-layer'
      ? [
          {
            type: 'replace_cell',
            cell: {
              ...module,
              geometry: {
                ...module.geometry,
                x: Math.max(
                  targetBounds.x + 20,
                  ...(target.data as ArchitectureLayerData).memberIds.map(
                    (id) => {
                      const member = store.cells[id];
                      return isNodeCell(member)
                        ? member.geometry.x + member.geometry.width + 32
                        : targetBounds.x + 20;
                    },
                  ),
                ),
                y: targetBounds.y + 44,
                derived: false,
              },
              data: { ...(module.data as object), placed: true },
            },
          },
        ]
      : [];
  return [
    ...placement,
    {
      type: 'replace_cell',
      cell: {
        ...frame,
        children: [
          ...layers,
          ...frame.children.filter((id) => !layers.includes(id)),
        ],
      },
    },
    {
      type: 'replace_cell',
      cell: {
        ...source,
        data: {
          ...source.data,
          memberIds: source.data.memberIds.filter((id) => id !== moduleId),
        },
      },
    },
    {
      type: 'replace_cell',
      cell: {
        ...target,
        data: {
          ...(target.data as ArchitectureLayerData),
          memberIds: [
            ...(target.data as ArchitectureLayerData).memberIds,
            moduleId,
          ],
        },
      },
    },
  ];
};

export const reorderArchitectureLayers = (
  store: CellStore,
  frameId: string,
  ids: readonly string[],
): CellOperation[] => {
  const frame = store.cells[frameId];
  if (frame?.cellType !== 'frame')
    throw new Error('Missing architecture frame');
  const layers = (frame as import('@sue/board-core').FrameCell).children
    .map((id) => store.cells[id])
    .filter((cell) => cell.kind === CellKind.architectureLayer);
  if (
    ids.length !== layers.length ||
    new Set(ids).size !== ids.length ||
    layers.some((layer) => !ids.includes(layer.id))
  )
    throw new Error('Layer order must include each layer exactly once');
  return [
    {
      type: 'replace_cell',
      cell: {
        ...(frame as import('@sue/board-core').FrameCell),
        children: [
          ...ids,
          ...(frame as import('@sue/board-core').FrameCell).children.filter(
            (id) => !ids.includes(id),
          ),
        ],
      },
    } as CellOperation,
    ...ids.map((id, index): CellOperation => {
      const layer = store.cells[id] as NodeCell<ArchitectureLayerData>;
      return {
        type: 'replace_cell',
        cell: {
          ...layer,
          data: { ...layer.data!, order: String(index).padStart(8, '0') },
        },
      };
    }),
  ];
};

/** Modules become authored positions; layer envelopes remain derived. */
export function materializeArchitecturePositions(store: CellStore): CellStore {
  let cells = store.cells;
  for (const frame of Object.values(store.cells)) {
    if (frame.cellType !== 'frame') continue;
    const layout = layoutArchitectureCells(store, frame.id);
    for (const [id, geometry] of layout) {
      const cell = store.cells[id];
      if (
        !isNodeCell(cell) ||
        cell.kind !== 'architecture-module' ||
        !cell.geometry.derived
      )
        continue;
      if (cells === store.cells) cells = { ...cells };
      cells[id] = {
        ...cell,
        geometry: { ...geometry, derived: false },
        data: { ...(cell.data as object), placed: true },
      };
    }
  }
  return cells === store.cells ? store : { ...store, cells };
}
