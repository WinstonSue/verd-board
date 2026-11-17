import type { BoardAppearance, ThemeColorMode } from './theme';

export interface ThemeBaseConfig {
  readonly background: string;
  readonly surface: string;
  readonly header: string;
  readonly text: string;
  readonly stroke: string;
  /** Theme accent is independent of the first categorical family. */
  readonly accent: string;
  readonly seriesSeeds: ThemeSeriesSeeds;
}

type ThemeSeriesSeeds = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
];
interface ThemeConfigEntry {
  readonly light: ThemeBaseConfig;
  readonly dark: ThemeBaseConfig;
  readonly nativeAppearance: BoardAppearance;
  readonly legacy: {
    readonly boardBackground: string;
    readonly textColor: string;
    readonly historicBackground: string;
  };
}

export const themeStyleLevels = ['container', 'node', 'emphasis'] as const;
export const themeLevelAliases = {
  container: 'subtle',
  node: 'normal',
  emphasis: 'strong',
} as const;
type StyleAmounts = Readonly<Record<(typeof themeStyleLevels)[number], number>>;
const legacyText = '#333333';

/** Color data only. Names remain in i18n; presentation derives all paint. */
export const themeConfig = {
  // Purple, red/rose, yellow/ochre, teal, blue, grass/olive in every theme.
  styleColors: [
    'series-1',
    'series-2',
    'series-3',
    'series-4',
    'series-5',
    'series-6',
  ],
  styleAmounts: {
    light: { container: 0.1, node: 0.24, emphasis: 0.44 },
    dark: { container: 0.14, node: 0.3, emphasis: 0.48 },
  } satisfies Record<BoardAppearance, StyleAmounts>,
  neutralAmounts: {
    container: 0,
    node: 0.06,
    emphasis: 0.14,
  } satisfies StyleAmounts,
  appearance: {
    light: { grid: '#94a3b8', note: '#fef9c3', annotationSeed: '#c4a33a' },
    dark: { grid: '#64748b', note: '#40371c', annotationSeed: '#b39a43' },
  },
  readability: {
    dark: '#0f172a',
    light: '#ffffff',
    maximumContrastDark: '#000000',
  },
  legacy: {
    defaultText: legacyText,
    canvas: '#f8fafc',
    frameStroke: '#cbd5e1',
    nodeStroke: '#64748b',
  },
  themes: {
    default: {
      light: {
        background: '#ffffff',
        surface: '#ffffff',
        header: '#f3edfc',
        text: '#1e293b',
        stroke: '#64748b',
        accent: '#b59ad7',
        seriesSeeds: [
          '#b59ad7',
          '#d89baf',
          '#d7b477',
          '#83b8ab',
          '#91afcf',
          '#a8bd85',
        ],
      },
      dark: {
        background: '#1c1d20',
        surface: '#26282d',
        header: '#30333a',
        text: '#e4e7ec',
        stroke: '#9aa1ab',
        accent: '#cba6f7',
        seriesSeeds: [
          '#cba6f7',
          '#f2a6bc',
          '#f9d89c',
          '#94d8c5',
          '#9dbfef',
          '#b8d59a',
        ],
      },
      nativeAppearance: 'light',
      legacy: {
        boardBackground: '#ffffff',
        textColor: legacyText,
        historicBackground: '#f8fafc',
      },
    },
    colorful: {
      light: {
        background: '#ffffff',
        surface: '#ffffff',
        header: '#f3edfc',
        text: '#1e293b',
        stroke: '#64748b',
        accent: '#8b5cf6',
        seriesSeeds: [
          '#8b5cf6',
          '#f43f5e',
          '#f5b800',
          '#00b8a9',
          '#2f7cf6',
          '#74bc1f',
        ],
      },
      dark: {
        background: '#1c1d20',
        surface: '#26282d',
        header: '#30333a',
        text: '#e4e7ec',
        stroke: '#9aa1ab',
        accent: '#bb8aff',
        seriesSeeds: [
          '#bb8aff',
          '#ff718b',
          '#ffd84d',
          '#43d7c5',
          '#73adff',
          '#a5d94f',
        ],
      },
      nativeAppearance: 'light',
      legacy: {
        boardBackground: '#ffffff',
        textColor: legacyText,
        historicBackground: '#f8fafc',
      },
    },
    soft: {
      light: {
        background: '#faf9f7',
        surface: '#ffffff',
        header: '#f0ede9',
        text: '#494746',
        stroke: '#8b8682',
        accent: '#748fae',
        seriesSeeds: [
          '#9a83ad',
          '#b47f89',
          '#ba9d68',
          '#6e9e9a',
          '#748fae',
          '#8da579',
        ],
      },
      dark: {
        background: '#1c1d20',
        surface: '#26282d',
        header: '#30333a',
        text: '#e4e7ec',
        stroke: '#9aa1ab',
        accent: '#b1c0c9',
        seriesSeeds: [
          '#c5b7c7',
          '#cfb5b8',
          '#d0bfa7',
          '#b2c7c6',
          '#b1c0c9',
          '#b7c3b4',
        ],
      },
      nativeAppearance: 'light',
      legacy: {
        boardBackground: '#f5f5f5',
        textColor: legacyText,
        historicBackground: '#f8fafc',
      },
    },
    retro: {
      light: {
        background: '#f9f8ed',
        surface: '#fffdf4',
        header: '#eee8d7',
        text: '#493e32',
        stroke: '#8a7155',
        accent: '#8b6138',
        seriesSeeds: [
          '#94718a',
          '#b56050',
          '#8b6138',
          '#447e6c',
          '#6c7e9c',
          '#929251',
        ],
      },
      dark: {
        background: '#242321',
        surface: '#302e2b',
        header: '#3c3833',
        text: '#e9dfcf',
        stroke: '#b2a797',
        accent: '#d7b77b',
        seriesSeeds: [
          '#c5a4b5',
          '#d69b88',
          '#d7b77b',
          '#99b8a2',
          '#9cb1c9',
          '#cabd85',
        ],
      },
      nativeAppearance: 'light',
      legacy: {
        boardBackground: '#f9f8ed',
        textColor: legacyText,
        historicBackground: '#f8fafc',
      },
    },
    dark: {
      light: {
        background: '#f2f8f9',
        surface: '#ffffff',
        header: '#e4eff1',
        text: '#243e43',
        stroke: '#63858b',
        accent: '#2a8793',
        seriesSeeds: [
          '#8d87af',
          '#b47e91',
          '#b89a69',
          '#2a8793',
          '#568db4',
          '#85a582',
        ],
      },
      dark: {
        background: '#1c1d20',
        surface: '#26282d',
        header: '#30333a',
        text: '#e4e7ec',
        stroke: '#9aa1ab',
        accent: '#7fc7cd',
        seriesSeeds: [
          '#b7afd6',
          '#d8a7b9',
          '#dbc18e',
          '#7fc7cd',
          '#9abedf',
          '#b5cca5',
        ],
      },
      nativeAppearance: 'dark',
      legacy: {
        boardBackground: '#141414',
        textColor: '#FFFFFF',
        historicBackground: '#141414',
      },
    },
  } satisfies Record<ThemeColorMode, ThemeConfigEntry>,
} as const;
