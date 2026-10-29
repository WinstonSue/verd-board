import type { Cell, NodeAppearance } from '../cell/types';
import {
  ThemeColorMode,
  ThemeColors,
  type BoardAppearance,
  type BoardTheme,
  type ColorSource,
} from './theme';

export interface BoardThemePalette {
  background: string;
  surface: string;
  header: string;
  text: string;
  secondaryText: string;
  stroke: string;
  grid: string;
  accent: string;
  note: string;
}
export interface ResolvedBoardTheme extends BoardThemePalette {
  id: ThemeColorMode;
  appearance: BoardAppearance;
  /** Omitted appearance preserves the pre-adaptive public renderer contract. */
  adaptive: boolean;
}
const palette = (
  background: string,
  surface: string,
  header: string,
  text: string,
  stroke: string,
  accent: string,
  dark = false,
): BoardThemePalette => ({
  background,
  surface,
  header,
  text,
  stroke,
  accent,
  secondaryText: text,
  grid: dark ? '#64748b' : '#94a3b8',
  note: dark ? '#40371c' : '#fef9c3',
});

/** Theme identity describes a style; appearance selects its presentation. */
export const BoardThemeDefinitions: Record<
  ThemeColorMode,
  Record<BoardAppearance, BoardThemePalette>
> = {
  default: {
    light: palette(
      '#f8fafc',
      '#ffffff',
      '#f1f5f9',
      '#0f172a',
      '#64748b',
      '#4f46e5',
    ),
    dark: palette(
      '#0f172a',
      '#1e293b',
      '#29384e',
      '#e2e8f0',
      '#94a3b8',
      '#a5b4fc',
      true,
    ),
  },
  colorful: {
    light: palette(
      '#ffffff',
      '#ffffff',
      '#f3edfc',
      '#1e293b',
      '#64748b',
      '#7c3aed',
    ),
    dark: palette(
      '#171329',
      '#2b2342',
      '#382d52',
      '#f3eefe',
      '#b8a3d4',
      '#c4b5fd',
      true,
    ),
  },
  soft: {
    light: palette(
      '#f5f5f5',
      '#ffffff',
      '#edf0f4',
      '#334155',
      '#64748b',
      '#687ea3',
    ),
    dark: palette(
      '#1e232b',
      '#2c3440',
      '#353f4d',
      '#dce4ee',
      '#a2b3c6',
      '#b3c7e8',
      true,
    ),
  },
  retro: {
    light: palette(
      '#f9f8ed',
      '#fffdf4',
      '#eee8d7',
      '#493e32',
      '#8a7155',
      '#8b6138',
    ),
    dark: palette(
      '#28251f',
      '#373128',
      '#443c2f',
      '#f4e8ca',
      '#baa681',
      '#d5b77b',
      true,
    ),
  },
  dark: {
    light: palette(
      '#eff9f5',
      '#ffffff',
      '#dcefe7',
      '#153c35',
      '#527f72',
      '#147d64',
    ),
    dark: palette(
      '#141414',
      '#1d2b26',
      '#283c34',
      '#e0f5ec',
      '#8cbaa6',
      '#6ee7b7',
      true,
    ),
  },
  starry: {
    light: palette(
      '#eff7fb',
      '#ffffff',
      '#dcecf5',
      '#163c52',
      '#577e99',
      '#246f99',
    ),
    dark: palette(
      '#0d2537',
      '#18384d',
      '#21475e',
      '#e0f0fa',
      '#91b5cc',
      '#7dd3fc',
      true,
    ),
  },
};

const normalize = (value: string) => {
  const color = value.trim().toLowerCase();
  return /^#[\da-f]{3}$/.test(color)
    ? '#' + [...color.slice(1)].map((c) => c + c).join('')
    : color;
};
const matches = (value: string, defaults: readonly string[]) =>
  defaults.some((c) => normalize(c) === normalize(value));

export function resolveBoardTheme(
  theme?: Partial<BoardTheme>,
  appearance?: BoardAppearance,
): ResolvedBoardTheme {
  const id =
    theme?.themeColorMode &&
    Object.hasOwn(BoardThemeDefinitions, theme.themeColorMode)
      ? theme.themeColorMode
      : ThemeColorMode.default;
  const native = id === 'dark' || id === 'starry' ? 'dark' : 'light';
  const colors = BoardThemeDefinitions[id][appearance ?? 'light'];
  const raw =
    typeof theme?.boardBackground === 'string'
      ? theme.boardBackground
      : undefined;
  const historic = [
    id === 'dark' ? '#141414' : id === 'starry' ? '#0d2537' : '#f8fafc',
    ThemeColors.find((c) => c.mode === id)!.boardBackground!,
  ];
  const custom =
    raw !== undefined &&
    (theme?.backgroundMode === 'custom' ||
      (theme?.backgroundMode !== 'theme' && !matches(raw, historic)));
  return {
    ...colors,
    id,
    appearance: appearance ?? native,
    adaptive: appearance !== undefined,
    background:
      appearance === undefined
        ? (raw ?? '#f8fafc')
        : custom
          ? raw!
          : colors.background,
  };
}

/** @deprecated Adaptive presentation now treats every unmarked color as a theme color. */
export function legacyThemeColors(
  kind: string,
  field: 'fill' | 'strokeColor',
): readonly string[] {
  if (['geometry', 'table', 'swimlane'].includes(kind))
    return field === 'fill' ? ['#fff'] : ['#64748b'];
  if (['freehand', 'vector-line'].includes(kind))
    return field === 'strokeColor' ? ['#334155'] : [];
  return [];
}

/** The historical argument is retained for source compatibility; only custom sources lock colors. */
export function resolveThemeColor(
  value: string | undefined,
  source: ColorSource | undefined,
  fallback: string,
  theme: ResolvedBoardTheme,
  _historical: readonly string[] = [],
): string {
  if (typeof value !== 'string') return fallback;
  if (!theme.adaptive) return value ?? fallback;
  if (value === 'none' || value === 'transparent') return value;
  if (source === 'custom') return value ?? fallback;
  return fallback;
}

export function resolveCellAppearance(
  cell: Cell,
  theme: ResolvedBoardTheme,
  defaults?: Pick<NodeAppearance, 'fill' | 'strokeColor'>,
): NodeAppearance {
  const raw = ('appearance' in cell ? cell.appearance : undefined) as
    NodeAppearance | undefined;
  const frame = [
    'frame',
    'frame-reference',
    'document-frame',
    'document-reference',
  ].includes(cell.kind);
  const fill = resolveThemeColor(
    raw?.fill,
    raw?.colorSources?.fill,
    defaults?.fill ?? theme.surface,
    theme,
  );
  const line =
    cell.cellType === 'edge' || ['freehand', 'vector-line'].includes(cell.kind);
  const strokeBackground =
    line || fill === 'none' || fill === 'transparent' ? theme.background : fill;
  const defaultStroke =
    colorContrast(strokeBackground, defaults?.strokeColor ?? theme.stroke) >= 3
      ? (defaults?.strokeColor ?? theme.stroke)
      : readableThemeText(
          strokeBackground,
          defaults?.strokeColor ?? theme.stroke,
        );
  const strokeColor = resolveThemeColor(
    raw?.strokeColor,
    raw?.colorSources?.strokeColor,
    theme.adaptive ? defaultStroke : frame ? '#cbd5e1' : '#64748b',
    theme,
  );
  return { ...raw, fill, strokeColor };
}

export function colorContrast(a: string, b: string): number {
  const luminance = (value: string) => {
    const hex = normalize(value);
    if (!/^#[\da-f]{6}$/.test(hex)) return undefined;
    const rgb = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const x = luminance(a),
    y = luminance(b);
  return x === undefined || y === undefined
    ? 1
    : (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function readableThemeText(
  background: string,
  preferred: string,
): string {
  if (colorContrast(background, preferred) >= 4.5) return preferred;
  return colorContrast(background, '#0f172a') >=
    colorContrast(background, '#ffffff')
    ? '#0f172a'
    : '#ffffff';
}
