import {
  architectureLayerIds,
  layoutArchitectureCells,
  layoutArchitectureEdges,
  type ArchitectureLayerData,
} from '@sue/board-architecture';
import {
  isNodeCell,
  compositeThemeFill,
  translateCellSelection,
  type CellRegistry,
  type CellStore,
} from '@sue/board-core';
import {
  frameThemeAppearance,
  resolveFrameAppearance,
  type FrameRenderExtension,
  type FrameThemeAppearanceContext,
} from '@sue/board-react';

const seriesCache = new WeakMap<CellStore, Map<string, Map<string, number>>>();

const architectureSeries = (store: CellStore, frameId: string) => {
  let frames = seriesCache.get(store);
  if (!frames) seriesCache.set(store, (frames = new Map()));
  let indices = frames.get(frameId);
  if (!indices) {
    indices = new Map();
    architectureLayerIds(store, frameId).forEach((id, ordinal) => {
      indices!.set(id, ordinal);
      const layer = store.cells[id];
      if (!isNodeCell(layer)) return;
      const members = (layer.data as ArchitectureLayerData)?.memberIds ?? [];
      members.forEach((memberId) => indices!.set(memberId, ordinal));
    });
    frames.set(frameId, indices);
  }
  return indices;
};

const architectureThemeAppearance = (context: FrameThemeAppearanceContext) => {
  const { cell, store, frameId, theme } = context;
  const indices = architectureSeries(store, frameId);
  const source =
    cell.cellType === 'edge' && 'cellId' in cell.source
      ? store.cells[cell.source.cellId]
      : cell;
  const ordinal = source ? indices.get(source.id) : undefined;
  const family =
    ordinal === undefined
      ? 'neutral'
      : (`series-${(ordinal % 6) + 1}` as import('@sue/board-core').BoardStyleColor);
  let background: string | undefined;
  if (cell.kind === 'architecture-module') {
    const layer = architectureLayerIds(store, frameId)
      .map((id) => store.cells[id])
      .find(
        (candidate) =>
          isNodeCell(candidate) &&
          (candidate.data as ArchitectureLayerData)?.memberIds?.includes(
            cell.id,
          ),
      );
    if (layer) {
      const layerContext = { ...context, cell: layer };
      const visual = resolveFrameAppearance(
        layerContext,
        frameThemeAppearance(layerContext, family, 'container', 'opaque'),
      );
      background = compositeThemeFill(
        visual.fill ?? theme.canvas,
        theme.canvas,
      );
    }
  }
  const tone = frameThemeAppearance(
    { ...context, cell: source ?? cell },
    family,
    cell.kind === 'architecture-layer' ? 'container' : 'node',
    cell.kind === 'architecture-layer' ? 'opaque' : 'overlay',
    background,
  );
  return cell.cellType === 'edge' ? { ...tone, fill: 'none' } : tone;
};

export const createArchitectureFrameExtensions = (
  registry: CellRegistry,
): FrameRenderExtension[] => {
  if (!registry.plugins.some((plugin) => plugin.id === 'architecture'))
    throw new Error(
      'Install createArchitecturePlugin() through createCellRegistry before creating render extensions',
    );
  return [
    {
      kind: 'architecture-layer',
      previewMove: ({ store, cell, frameId, preview }) => {
        if (!isNodeCell(cell)) return;
        const original = layoutArchitectureCells(store, frameId).get(cell.id)!;
        const ids = [
          cell.id,
          ...((cell.data as ArchitectureLayerData)?.memberIds ?? []),
        ];
        return {
          operations: translateCellSelection(
            store,
            [cell.id],
            [preview.x - original.x, preview.y - original.y],
            registry,
          ),
          ghost: { parentId: frameId, cellIds: ids },
        };
      },
      themeAppearance: architectureThemeAppearance,
      textBounds: ({ cell, geometry }) => {
        const node = isNodeCell(cell) ? cell : undefined;
        const bounds = geometry ?? node?.geometry;
        const fontSize = (node?.data as { fontSize?: number })?.fontSize ?? 16;
        // Keep the title at the start of the header, clear of the central
        // connection corridor used by single-module layers.
        // FrameCanvas reserves another 16px inside these bounds. Leave room
        // for that padding and proportional bold glyphs in short Latin titles.
        const titleWidth =
          32 +
          [...(node?.content?.label ?? '')].reduce(
            (width, char) =>
              width + (char.charCodeAt(0) > 255 ? fontSize : fontSize / 2),
            0,
          );
        return {
          x: (bounds?.x ?? 0) + 12,
          y: (bounds?.y ?? 0) + 4,
          width: Math.max(
            0,
            Math.min((bounds?.width ?? 0) - 24, Math.max(48, titleWidth)),
          ),
          height: 32,
        };
      },
    },
    ...['architecture-module', 'architecture-edge'].map((kind) => ({
      kind,
      themeAppearance: architectureThemeAppearance,
    })),
    {
      layoutEdges: layoutArchitectureEdges,
      layout: (store, frameId) =>
        new Map(
          [...layoutArchitectureCells(store, frameId)].filter(
            ([id]) => store.cells[id]?.kind === 'architecture-layer',
          ),
        ),
    },
  ];
};
