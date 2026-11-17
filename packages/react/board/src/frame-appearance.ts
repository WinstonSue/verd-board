import {
  isNodeCell,
  isBoardStyleColor,
  resolveThemeFamily,
  resolveCellAppearance,
  compositeThemeFill,
  readableThemeText,
  type BoardThemeFamily,
  type BoardThemeStyleLevel,
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
  /** Actual supporting paint. It never replaces the theme's canvas base. */
  background?: string;
}

export interface FrameThemeAppearance extends Pick<
  NodeAppearance,
  'fill' | 'strokeColor'
> {
  textColor?: string;
  styleFamily?: BoardThemeFamily;
  styleLevel?: BoardThemeStyleLevel;
  fillMode?: 'overlay' | 'opaque';
  background?: string;
}
export interface ResolvedFrameCellAppearance extends NodeAppearance {
  textColor?: string;
  exportFill?: string;
  background?: string;
  /** Presentation metadata, never persisted in a Cell. */
  styleFamily?: BoardThemeFamily;
  styleLevel?: BoardThemeStyleLevel;
}

/** Domain defaults describe families and levels rather than user color sources. */
export function frameThemeAppearance(
  context: FrameThemeAppearanceContext,
  family: BoardThemeFamily,
  level: BoardThemeStyleLevel = 'node',
  fillMode: 'overlay' | 'opaque' = 'overlay',
  background?: string,
): FrameThemeAppearance {
  const styleFamily =
    isNodeCell(context.cell) &&
    isBoardStyleColor(context.cell.appearance?.styleColor)
      ? context.cell.appearance.styleColor
      : family;
  return {
    ...resolveThemeFamily(context.theme, styleFamily, level, fillMode),
    styleFamily,
    styleLevel: level,
    fillMode,
    background,
  };
}

/** Every painted part shares family selection, source precedence and contrast. */
export function resolveFrameAppearance(
  context: FrameThemeAppearanceContext,
  defaults?: FrameThemeAppearance,
): ResolvedFrameCellAppearance {
  const theme = context.theme;
  const supporting =
    context.background ??
    defaults?.background ??
    theme.canvas ??
    theme.background;
  const explicitFamily = isNodeCell(context.cell)
    ? context.cell.appearance?.styleColor
    : undefined;
  const selected =
    theme.adaptive &&
    defaults?.styleFamily &&
    isBoardStyleColor(explicitFamily) &&
    explicitFamily !== defaults.styleFamily
      ? frameThemeAppearance(
          context,
          defaults.styleFamily,
          defaults.styleLevel,
          defaults.fillMode,
          supporting,
        )
      : defaults;
  const paints =
    selected &&
    defaults &&
    (defaults.fill === 'none' || defaults.fill === 'transparent')
      ? { ...selected, fill: defaults.fill }
      : selected;
  const visual = resolveCellAppearance(
    context.cell,
    theme,
    theme.adaptive ? paints : undefined,
    supporting,
  );
  if (!theme.adaptive) return visual;
  const background =
    context.cell.cellType === 'edge' || !visual.fill
      ? supporting
      : compositeThemeFill(visual.fill, supporting);
  return {
    ...visual,
    background: supporting,
    ...(selected?.styleFamily
      ? { styleFamily: selected.styleFamily, styleLevel: selected.styleLevel }
      : {}),
    ...(visual.fill &&
    /^#[\da-f]{8}$/i.test(visual.fill) &&
    !(
      isNodeCell(context.cell) &&
      context.cell.appearance?.colorSources?.fill === 'custom'
    )
      ? { exportFill: compositeThemeFill(visual.fill, supporting) }
      : {}),
    textColor: readableThemeText(background, paints?.textColor ?? theme.text),
  };
}

export function resolveFrameCellAppearance(
  context: FrameThemeAppearanceContext,
  extensions?: readonly FrameRenderExtension[],
): ResolvedFrameCellAppearance {
  const supporting =
    context.background ??
    extensions
      ?.map((extension) => extension.themeBackground?.(context))
      .find((value) => value !== undefined);
  const defaults = context.theme.adaptive
    ? extensions
        ?.filter(
          (extension) =>
            !extension.kind || extension.kind === context.cell.kind,
        )
        .map((extension) => extension.themeAppearance?.(context))
        .find((value) => value !== undefined)
    : undefined;
  return resolveFrameAppearance(
    { ...context, background: supporting },
    defaults,
  );
}
