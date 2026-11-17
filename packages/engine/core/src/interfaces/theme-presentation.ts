import type { Cell, NodeAppearance } from '../cell/types';
import {
  themeConfig,
  themeLevelAliases,
  themeStyleLevels,
  type ThemeBaseConfig,
} from './theme-config';
import {
  BoardStyleColors,
  isBoardStyleColor,
  type BoardStyleColor,
  ThemeColorMode,
  ThemeColors,
  type BoardAppearance,
  type BoardTheme,
  type ColorSource,
} from './theme';

export type BoardThemeRole =
  'neutral' | 'primary' | 'secondary' | 'tertiary' | 'annotation';
export type BoardThemeStyleLevel = 'container' | 'node' | 'emphasis';
export type BoardThemeLegacyLevel = 'subtle' | 'normal' | 'strong';
export type BoardThemeLevel = BoardThemeStyleLevel | BoardThemeLegacyLevel;
export type BoardThemeFamily = BoardThemeRole | BoardStyleColor;
export const themeLevelKey = (level: BoardThemeLevel): BoardThemeLegacyLevel =>
  level === 'container'
    ? themeLevelAliases.container
    : level === 'node'
      ? themeLevelAliases.node
      : level === 'emphasis'
        ? themeLevelAliases.emphasis
        : level;
export interface BoardThemeTone {
  fill: string;
  strokeColor: string;
  textColor: string;
}
export type BoardThemeRamp = Readonly<
  Record<BoardThemeLegacyLevel, BoardThemeTone>
>;

export interface BoardThemePalette {
  /** Actual canvas base; background remains the compatible alias. */
  canvas?: string;
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
  canvas: string;
  id: ThemeColorMode;
  appearance: BoardAppearance;
  /** Omitted appearance preserves the pre-adaptive public renderer contract. */
  adaptive: boolean;
}
const palette = (
  { background, surface, header, text, stroke, accent }: ThemeBaseConfig,
  appearance: BoardAppearance,
): BoardThemePalette => ({
  background,
  canvas: background,
  surface,
  header,
  text,
  stroke,
  accent,
  secondaryText: text,
  grid: themeConfig.appearance[appearance].grid,
  note: themeConfig.appearance[appearance].note,
});

const normalize = (value: string) => {
  const color = value.trim().toLowerCase();
  return /^#[\da-f]{3}$/.test(color)
    ? '#' + [...color.slice(1)].map((c) => c + c).join('')
    : color;
};
const matches = (value: string, defaults: readonly string[]) =>
  defaults.some((c) => normalize(c) === normalize(value));

const nodeTonePaint = new WeakMap<
  BoardThemeTone,
  { seed: string; amount: number }
>();

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
export const readableThemeStroke = (
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
    for (const target of [
      themeConfig.readability.dark,
      themeConfig.readability.light,
    ]) {
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
  strokeColor: readableThemeStroke(
    fill,
    theme.canvas ?? theme.background,
    stroke,
  ),
  textColor: readableThemeText(fill, theme.text),
});

const paintedTone = (
  theme: BoardThemePalette,
  seed: string,
  amount: number,
): BoardThemeTone => {
  const alpha = Math.round(amount * 255) / 255;
  const tone = themeTone(
    theme,
    mixThemeColors(theme.canvas ?? theme.background, seed, alpha),
    seed,
  );
  nodeTonePaint.set(tone, { seed, amount: alpha });
  return tone;
};

const themeRamp = (
  theme: BoardThemePalette,
  seed: string,
  dark: boolean,
): BoardThemeRamp => {
  const amounts = themeConfig.styleAmounts[dark ? 'dark' : 'light'];
  return Object.fromEntries(
    themeStyleLevels.map((level) => [
      themeLevelAliases[level],
      paintedTone(theme, seed, amounts[level]),
    ]),
  ) as Record<BoardThemeLegacyLevel, BoardThemeTone>;
};

const createThemeRoles = (
  theme: BoardThemePalette,
  seeds: readonly string[],
  dark: boolean,
): Pick<BoardThemePalette, 'roles' | 'series'> => {
  const series = seeds.map((seed) => themeRamp(theme, seed, dark));
  const neutral: BoardThemeRamp = {
    subtle: paintedTone(
      theme,
      theme.stroke,
      themeConfig.neutralAmounts.container,
    ),
    normal: paintedTone(theme, theme.stroke, themeConfig.neutralAmounts.node),
    strong: paintedTone(
      theme,
      theme.stroke,
      themeConfig.neutralAmounts.emphasis,
    ),
  };
  return {
    series,
    roles: {
      neutral,
      primary: series[0],
      secondary: series[1],
      tertiary: series[2],
      annotation: themeRamp(
        theme,
        themeConfig.appearance[dark ? 'dark' : 'light'].annotationSeed,
        dark,
      ),
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
        const base = palette(themeConfig.themes[id][appearance], appearance);
        return [
          appearance,
          {
            ...base,
            ...createThemeRoles(
              base,
              themeConfig.themes[id][appearance].seriesSeeds,
              appearance === 'dark',
            ),
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
      colorContrast(
        theme.canvas ?? theme.background,
        themeConfig.readability.light,
      ) >
      colorContrast(
        theme.canvas ?? theme.background,
        themeConfig.readability.dark,
      );
    colors = createThemeRoles(
      theme,
      [
        theme.accent,
        ...themeConfig.themes.default[
          dark ? 'dark' : 'light'
        ].seriesSeeds.slice(1),
      ],
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
  nodeFill?: 'overlay' | 'opaque',
): BoardThemeTone {
  const ramp = theme.roles?.[role] ?? rolesForTheme(theme).roles![role];
  return nodeFill
    ? resolveThemeNodeTone(theme, ramp[themeLevelKey(level)], nodeFill)
    : presentThemeTone(theme, ramp[themeLevelKey(level)]);
}

/** Category indices wrap deterministically; invalid indices use the first family. */
export function resolveThemeSeries(
  theme: BoardThemePalette,
  index: number,
  level: BoardThemeLevel = 'normal',
  nodeFill?: 'overlay' | 'opaque',
): BoardThemeTone {
  const series = theme.series?.length
    ? theme.series
    : rolesForTheme(theme).series!;
  const ordinal = Number.isFinite(index) ? Math.trunc(index) : 0;
  const ramp =
    series[((ordinal % series.length) + series.length) % series.length];
  return nodeFill
    ? resolveThemeNodeTone(theme, ramp[themeLevelKey(level)], nodeFill)
    : presentThemeTone(theme, ramp[themeLevelKey(level)]);
}

export function resolveThemeFamily(
  theme: BoardThemePalette,
  family: BoardThemeFamily,
  level: BoardThemeLevel = 'node',
  fillMode?: 'overlay' | 'opaque',
): BoardThemeTone {
  return isBoardStyleColor(family)
    ? resolveThemeSeries(
        theme,
        BoardStyleColors.indexOf(family),
        level,
        fillMode,
      )
    : resolveThemeRole(theme, family, level, fillMode);
}

/** Composite a node's hex alpha paint onto its actual supporting surface. */
export function compositeThemeFill(fill: string, background: string): string {
  const color = normalize(fill);
  if (/^#[\da-f]{8}$/.test(color))
    return mixThemeColors(
      background,
      color.slice(0, 7),
      parseInt(color.slice(7), 16) / 255,
    );
  return fill === 'none' || fill === 'transparent' ? background : fill;
}

/** Nodes float over the canvas; containers retain their opaque surface ramps. */
export function resolveThemeNodeTone(
  theme: BoardThemePalette,
  tone: BoardThemeTone,
  mode: 'overlay' | 'opaque' = 'overlay',
): BoardThemeTone {
  const paint = nodeTonePaint.get(tone);
  if (!paint) return presentThemeTone(theme, tone);
  const seed = normalize(paint.seed);
  if (!/^#[\da-f]{6}$/.test(seed)) return presentThemeTone(theme, tone);
  const amount = paint.amount;
  const overlay =
    seed +
    Math.round(amount * 255)
      .toString(16)
      .padStart(2, '0');
  const effective = compositeThemeFill(
    overlay,
    theme.canvas ?? theme.background,
  );
  return {
    fill: mode === 'overlay' ? overlay : effective,
    strokeColor: readableThemeStroke(
      effective,
      theme.canvas ?? theme.background,
      seed,
    ),
    textColor: readableThemeText(effective, theme.text),
  };
}

export function resolveBoardTheme(
  theme?: Partial<BoardTheme>,
  appearance?: BoardAppearance,
): ResolvedBoardTheme {
  const known =
    theme?.themeColorMode !== undefined &&
    Object.hasOwn(BoardThemeDefinitions, theme.themeColorMode);
  const unknown = theme?.themeColorMode !== undefined && !known;
  const id = known ? theme!.themeColorMode! : ThemeColorMode.default;
  const native = themeConfig.themes[id].nativeAppearance;
  const colors = BoardThemeDefinitions[id][appearance ?? 'light'];
  const raw =
    typeof theme?.boardBackground === 'string'
      ? theme.boardBackground
      : undefined;
  const historic = [
    themeConfig.themes[id].legacy.historicBackground,
    ThemeColors.find((c) => c.mode === id)!.boardBackground!,
  ];
  const custom =
    raw !== undefined &&
    (theme?.backgroundMode === 'custom' ||
      (!unknown &&
        theme?.backgroundMode !== 'theme' &&
        !matches(raw, historic)));
  const canvas =
    appearance === undefined
      ? unknown && theme?.backgroundMode !== 'custom'
        ? themeConfig.legacy.canvas
        : (raw ?? themeConfig.legacy.canvas)
      : custom
        ? raw!
        : colors.background;
  const resolved = { ...colors, background: canvas, canvas };
  return {
    ...resolved,
    ...(appearance !== undefined && canvas !== colors.background
      ? createThemeRoles(
          resolved,
          themeConfig.themes[id][appearance ?? 'light'].seriesSeeds,
          appearance === 'dark',
        )
      : {}),
    id,
    appearance: appearance ?? native,
    adaptive: appearance !== undefined,
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
  background = theme.canvas ?? theme.background,
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
    defaults?.fill ??
      (theme.adaptive
        ? resolveThemeRole(theme, 'neutral', 'node').fill
        : theme.surface),
    theme,
  );
  const line =
    cell.cellType === 'edge' || ['freehand', 'vector-line'].includes(cell.kind);
  const strokeBackground = line
    ? background
    : compositeThemeFill(fill, background);
  const defaultStroke = readableThemeStroke(
    strokeBackground,
    background,
    defaults?.strokeColor ?? theme.stroke,
  );
  const strokeColor = resolveThemeColor(
    raw?.strokeColor,
    raw?.colorSources?.strokeColor,
    theme.adaptive
      ? defaultStroke
      : frame
        ? themeConfig.legacy.frameStroke
        : themeConfig.legacy.nodeStroke,
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
  backdrop: string = themeConfig.readability.light,
): string {
  background = compositeThemeFill(background, backdrop);
  // Leave room for channel/alpha rounding in browser compositing.
  const readableContrast = 4.55;
  if (colorContrast(background, preferred) >= readableContrast)
    return preferred;
  const fallback =
    colorContrast(background, themeConfig.readability.dark) >=
    colorContrast(background, themeConfig.readability.light)
      ? themeConfig.readability.dark
      : themeConfig.readability.light;
  return colorContrast(background, fallback) >= readableContrast
    ? fallback
    : themeConfig.readability.maximumContrastDark;
}
