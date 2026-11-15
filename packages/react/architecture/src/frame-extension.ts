import {
  architectureLayerIds,
  layoutArchitectureCells,
  type ArchitectureLayerData,
} from '@sue/board-architecture';
import {
  isNodeCell,
  resolveThemeRole,
  resolveThemeSeries,
  type CellRegistry,
  type CellStore,
} from '@sue/board-core';
import type {
  FrameRenderExtension,
  FrameThemeAppearanceContext,
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

const architectureThemeAppearance = ({
  cell,
  store,
  frameId,
  theme,
}: FrameThemeAppearanceContext) => {
  const indices = architectureSeries(store, frameId);
  const id =
    cell.cellType === 'edge'
      ? 'cellId' in cell.source
        ? cell.source.cellId
        : undefined
      : cell.id;
  const ordinal = id === undefined ? undefined : indices.get(id);
  const tone =
    ordinal === undefined
      ? resolveThemeRole(theme, 'neutral')
      : resolveThemeSeries(
          theme,
          ordinal,
          cell.kind === 'architecture-layer' ? 'subtle' : 'normal',
        );
  return cell.cellType === 'edge' ? { strokeColor: tone.strokeColor } : tone;
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
      layout: (store, frameId) =>
        new Map(
          [...layoutArchitectureCells(store, frameId)].filter(
            ([id]) => store.cells[id]?.kind === 'architecture-layer',
          ),
        ),
    },
  ];
};
