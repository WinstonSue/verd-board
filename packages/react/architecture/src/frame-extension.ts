import {
  layoutArchitectureCells,
  registerArchitectureCells,
} from '@sue/board-architecture';
import { isNodeCell, type CellRegistry } from '@sue/board-core';
import type { FrameRenderExtension } from '@sue/board-react';
export const createArchitectureFrameExtensions = (
  registry: CellRegistry,
): FrameRenderExtension[] => {
  registerArchitectureCells(registry);
  return [
    {
      kind: 'architecture-layer',
      textBounds: ({ cell, geometry }) => {
        const node = isNodeCell(cell) ? cell : undefined;
        const bounds = geometry ?? node?.geometry;
        const fontSize = (node?.data as { fontSize?: number })?.fontSize ?? 16;
        // Keep the title at the start of the header, clear of the central
        // connection corridor used by single-module layers.
        const titleWidth =
          16 +
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
