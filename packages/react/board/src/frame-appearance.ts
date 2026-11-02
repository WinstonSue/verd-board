import {
  resolveCellAppearance,
  readableThemeText,
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
  /** Actual supporting background for transparent or nested parts. */
  background?: string;
}

/** Defaults describe presentation only; they are never persisted in a Cell. */
export interface FrameThemeAppearance extends Pick<
  NodeAppearance,
  'fill' | 'strokeColor'
> {
  textColor?: string;
}
export interface ResolvedFrameCellAppearance extends NodeAppearance {
  /** Effective default for the main editable label; rich-text custom marks still win. */
  textColor?: string;
}

/** Resolve one domain part with the same field-source and contrast rules as the canvas. */
export function resolveFrameAppearance(
  context: FrameThemeAppearanceContext,
  defaults?: FrameThemeAppearance,
): ResolvedFrameCellAppearance {
  const theme = context.background
    ? { ...context.theme, background: context.background }
    : context.theme;
  const visual = resolveCellAppearance(
    context.cell,
    theme,
    theme.adaptive ? defaults : undefined,
  );
  if (!theme.adaptive) return visual;
  const background =
    context.cell.cellType === 'edge' ||
    !visual.fill ||
    visual.fill === 'none' ||
    visual.fill === 'transparent'
      ? theme.background
      : visual.fill;
  return {
    ...visual,
    textColor: readableThemeText(background, defaults?.textColor ?? theme.text),
  };
}

export function resolveFrameCellAppearance(
  context: FrameThemeAppearanceContext,
  extensions?: readonly FrameRenderExtension[],
): ResolvedFrameCellAppearance {
  const defaults = context.theme.adaptive
    ? extensions
        ?.filter(
          (extension) =>
            !extension.kind || extension.kind === context.cell.kind,
        )
        .map((extension) => extension.themeAppearance?.(context))
        .find((value) => value !== undefined)
    : undefined;
  return resolveFrameAppearance(context, defaults);
}
