import {
  resolveCellAppearance,
  type Cell,
  type CellStore,
  type NodeAppearance,
  type ResolvedBoardTheme,
} from '@sue/board-core';
import type { FrameRenderExtension } from './frame-canvas';

/** Narrow, pure context shared by painting and property inspectors. */
export interface FrameThemeAppearanceContext {
  cell: Cell;
  store: CellStore;
  frameId: string;
  theme: ResolvedBoardTheme;
}

export function resolveFrameCellAppearance(
  context: FrameThemeAppearanceContext,
  extensions?: readonly FrameRenderExtension[],
): NodeAppearance {
  const defaults = context.theme.adaptive
    ? extensions
        ?.filter(
          (extension) =>
            !extension.kind || extension.kind === context.cell.kind,
        )
        .map((extension) => extension.themeAppearance?.(context))
        .find((value) => value !== undefined)
    : undefined;
  return resolveCellAppearance(context.cell, context.theme, defaults);
}
