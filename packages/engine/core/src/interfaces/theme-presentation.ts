import type { Cell, NodeAppearance } from '../cell/types';
import {
  ThemeColorMode,
  ThemeColors,
  type BoardAppearance,
  type BoardTheme,
  type ColorSource,
} from './theme';

export type BoardThemeRole =
  'neutral' | 'primary' | 'secondary' | 'tertiary' | 'annotation';
export type BoardThemeLevel = 'subtle' | 'normal' | 'strong';
export interface BoardThemeTone {
  fill: string;
  strokeColor: string;
  textColor: string;
}
export type BoardThemeRamp = Readonly<Record<BoardThemeLevel, BoardThemeTone>>;

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
  roles?: Readonly<Record<BoardThemeRole, BoardThemeRamp>>;
  series?: readonly BoardThemeRamp[];
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
const baseThemeDefinitions: Record<
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

// Each theme keeps its own hue character. The first three families are also
// its primary, secondary and tertiary semantic roles; the rest are categories.
const seriesSeeds: Record<ThemeColorMode, readonly string[]> = {
  default: ['#4f46e5', '#138b9e', '#b27a35', '#9669b3', '#bf667d', '#4d916b'],
  colorful: ['#7c3aed', '#e44674', '#d78b13', '#169c91', '#3483d5', '#80a52b'],
  soft: ['#687ea3', '#69947f', '#b28e61', '#a184b4', '#b58091', '#6c9dab'],
  retro: ['#8b6138', '#447e6c', '#94718a', '#b56050', '#6c7e9c', '#929251'],
  dark: ['#147d64', '#467eab', '#b98d3a', '#ad6d86', '#8574b2', '#bf7653'],
  starry: ['#246f99', '#3e918b', '#9973a4', '#b68b45', '#b96f80', '#568b73'],
};

const themeLevels: readonly BoardThemeLevel[] = ['subtle', 'normal', 'strong'];

/** Mix opaque colors, so nested surfaces and image exports have identical paint. */
const mixThemeColors = (from: string, to: string, amount: number): string => {
  const a = normalize(from),
    b = normalize(to);
  if (!/^#[\da-f]{6}$/.test(a) || !/^#[\da-f]{6}$/.test(b))
    return amount < 0.5 ? from : to;
  return (
    '#' +
    [1, 3, 5]
      .map((offset) => {
        const x = parseInt(a.slice(offset, offset + 2), 16);
        const y = parseInt(b.slice(offset, offset + 2), 16);
        return Math.round(x + (y - x) * amount)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
};

/** Keep a border visible on both sides, including an explicitly fixed canvas. */
const readableThemeStroke = (
  fill: string,
  background: string,
  preferred: string,
): string => {
  const score = (color: string) =>
    Math.min(colorContrast(fill, color), colorContrast(background, color));
  let best = preferred,
    bestScore = score(preferred);
  if (bestScore >= 3) return preferred;
  // Search both directions, nearest first, retaining the hue wherever possible.
  for (let step = 1; step <= 100; step++) {
    for (const target of ['#0f172a', '#ffffff']) {
      const color = mixThemeColors(preferred, target, step / 100);
      const contrast = score(color);
      if (contrast >= 3) return color;
      if (contrast > bestScore) {
        best = color;
        bestScore = contrast;
      }
    }
  }
  // Some fixed backgrounds and fills have no single border that reaches 3:1
  // on both sides. Preserve the best minimum contrast instead of oscillating.
  return best;
};

const themeTone = (
  theme: BoardThemePalette,
  fill: string,
  stroke: string,
): BoardThemeTone => ({
  fill,
  strokeColor: readableThemeStroke(fill, theme.background, stroke),
  textColor: readableThemeText(fill, theme.text),
});

const themeRamp = (
  theme: BoardThemePalette,
  seed: string,
  dark: boolean,
): BoardThemeRamp => {
  const amounts = dark ? [0.14, 0.3, 0.48] : [0.1, 0.24, 0.44];
  return Object.fromEntries(
    themeLevels.map((level, at) => [
      level,
      themeTone(theme, mixThemeColors(theme.surface, seed, amounts[at]), seed),
    ]),
  ) as Record<BoardThemeLevel, BoardThemeTone>;
};

const createThemeRoles = (
  theme: BoardThemePalette,
  seeds: readonly string[],
  dark: boolean,
): Pick<BoardThemePalette, 'roles' | 'series'> => {
  const series = seeds.map((seed) => themeRamp(theme, seed, dark));
  const neutral: BoardThemeRamp = {
    subtle: themeTone(theme, theme.surface, theme.stroke),
    normal: themeTone(
      theme,
      mixThemeColors(theme.surface, theme.stroke, 0.06),
      theme.stroke,
    ),
    strong: themeTone(
      theme,
      mixThemeColors(theme.surface, theme.stroke, 0.14),
      theme.stroke,
    ),
  };
  return {
    series,
    roles: {
      neutral,
      primary: series[0],
      secondary: series[1],
      tertiary: series[2],
      annotation: themeRamp(theme, dark ? '#b39a43' : '#c4a33a', dark),
    },
  };
};

/** Theme identity describes a style; appearance selects its opaque color ramps. */
export const BoardThemeDefinitions: Record<
  ThemeColorMode,
  Record<BoardAppearance, BoardThemePalette>
> = Object.fromEntries(
  Object.values(ThemeColorMode).map((id) => [
    id,
    Object.fromEntries(
      (['light', 'dark'] as const).map((appearance) => {
        const base = baseThemeDefinitions[id][appearance];
        return [
          appearance,
          {
            ...base,
            ...createThemeRoles(base, seriesSeeds[id], appearance === 'dark'),
          },
        ];
      }),
    ),
  ]),
) as Record<ThemeColorMode, Record<BoardAppearance, BoardThemePalette>>;

const fallbackRoles = new WeakMap<
  BoardThemePalette,
  Pick<BoardThemePalette, 'roles' | 'series'>
>();
const rolesForTheme = (theme: BoardThemePalette) => {
  let colors = fallbackRoles.get(theme);
  if (!colors) {
    const dark =
      colorContrast(theme.surface, '#ffffff') >
      colorContrast(theme.surface, '#0f172a');
    colors = createThemeRoles(
      theme,
      [theme.accent, ...seriesSeeds.default.slice(1)],
      dark,
    );
    fallbackRoles.set(theme, colors);
  }
  return colors;
};

const presentedTones = new WeakMap<
  BoardThemePalette,
  WeakMap<
    BoardThemeTone,
    {
      background: string;
      fill: string;
      strokeColor: string;
      textColor: string;
      result: BoardThemeTone;
    }
  >
>();

const presentThemeTone = (
  theme: BoardThemePalette,
  tone: BoardThemeTone,
): BoardThemeTone => {
  let tones = presentedTones.get(theme);
  if (!tones) {
    tones = new WeakMap();
    presentedTones.set(theme, tones);
  }
  const cached = tones.get(tone);
  if (
    cached?.background === theme.background &&
    cached.fill === tone.fill &&
    cached.strokeColor === tone.strokeColor &&
    cached.textColor === tone.textColor
  )
    return cached.result;
  const strokeColor = readableThemeStroke(
    tone.fill,
    theme.background,
    tone.strokeColor,
  );
  const textColor = readableThemeText(tone.fill, tone.textColor);
  const result =
    strokeColor === tone.strokeColor && textColor === tone.textColor
      ? tone
      : { ...tone, strokeColor, textColor };
  tones.set(tone, {
    background: theme.background,
    fill: tone.fill,
    strokeColor: tone.strokeColor,
    textColor: tone.textColor,
    result,
  });
  return result;
};

export function resolveThemeRole(
  theme: BoardThemePalette,
  role: BoardThemeRole,
  level: BoardThemeLevel = 'normal',
): BoardThemeTone {
  const ramp = theme.roles?.[role] ?? rolesForTheme(theme).roles![role];
  return presentThemeTone(theme, ramp[level]);
}

/** Category indices wrap deterministically; invalid indices use the first family. */
export function resolveThemeSeries(
  theme: BoardThemePalette,
  index: number,
  level: BoardThemeLevel = 'normal',
): BoardThemeTone {
  const series = theme.series?.length
    ? theme.series
    : rolesForTheme(theme).series!;
  const ordinal = Number.isFinite(index) ? Math.trunc(index) : 0;
  const ramp =
    series[((ordinal % series.length) + series.length) % series.length];
  return presentThemeTone(theme, ramp[level]);
}

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

/** Only custom sources lock colors. */
export function resolveThemeColor(
  value: string | undefined,
  source: ColorSource | undefined,
  fallback: string,
  theme: ResolvedBoardTheme,
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
  const defaultStroke = readableThemeStroke(
    strokeBackground,
    theme.background,
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
