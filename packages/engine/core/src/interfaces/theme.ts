import { themeConfig } from './theme-config';

export interface BoardTheme {
  themeColorMode: ThemeColorMode;
  boardBackground?: string;
  /** Missing sources are interpreted using the historical defaults, without rewriting files. */
  backgroundMode?: ColorSource;
  gridEnabled?: boolean;
  gridSize?: number;
}

export type BoardAppearance = 'light' | 'dark';
export type ColorSource = 'theme' | 'custom';

export interface ThemeColor {
  mode: ThemeColorMode | string;
  boardBackground?: string;
  textColor: string;
}

export enum ThemeColorMode {
  default = 'default',
  colorful = 'colorful',
  soft = 'soft',
  retro = 'retro',
  dark = 'dark',
}

export const DEFAULT_COLOR = themeConfig.legacy.defaultText;

const legacyThemeColor = (mode: ThemeColorMode): ThemeColor => ({
  mode,
  boardBackground: themeConfig.themes[mode].legacy.boardBackground,
  textColor: themeConfig.themes[mode].legacy.textColor,
});

export const DefaultThemeColor: ThemeColor = legacyThemeColor(
  ThemeColorMode.default,
);
export const ColorfulThemeColor: ThemeColor = legacyThemeColor(
  ThemeColorMode.colorful,
);
export const SoftThemeColor: ThemeColor = legacyThemeColor(ThemeColorMode.soft);
export const RetroThemeColor: ThemeColor = legacyThemeColor(
  ThemeColorMode.retro,
);
export const DarkThemeColor: ThemeColor = legacyThemeColor(ThemeColorMode.dark);

export const ThemeColors: ThemeColor[] = [
  DefaultThemeColor,
  ColorfulThemeColor,
  SoftThemeColor,
  RetroThemeColor,
  DarkThemeColor,
];
/** Stable family identities; theme changes replace colors, never these ids. */
export const BoardStyleColors = themeConfig.styleColors;
export type BoardStyleColor = (typeof BoardStyleColors)[number];
export const isBoardStyleColor = (value: unknown): value is BoardStyleColor =>
  typeof value === 'string' &&
  (BoardStyleColors as readonly string[]).includes(value);
