import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFrameCell, type NodeCell } from '../cell/types';
import { ThemeColorMode } from './theme';
import { themeConfig } from './theme-config';
import {
  BoardThemeDefinitions,
  colorContrast,
  resolveBoardTheme,
  resolveCellAppearance,
  resolveThemeRole,
  resolveThemeSeries,
  type BoardThemeLevel,
  type BoardThemePalette,
  type BoardThemeRole,
  type BoardThemeTone,
} from './theme-presentation';

const levels: readonly BoardThemeLevel[] = ['subtle', 'normal', 'strong'];
const roles: readonly BoardThemeRole[] = [
  'neutral',
  'primary',
  'secondary',
  'tertiary',
  'annotation',
];
const opaqueHex = /^#[\da-f]{6}$/i;
const assertReadableTone = (tone: BoardThemeTone, theme: BoardThemePalette) => {
  for (const color of Object.values(tone)) expect(color).toMatch(opaqueHex);
  expect(colorContrast(tone.fill, tone.textColor)).toBeGreaterThanOrEqual(4.5);
  expect(colorContrast(tone.fill, tone.strokeColor)).toBeGreaterThanOrEqual(3);
  expect(
    colorContrast(theme.background, tone.strokeColor),
  ).toBeGreaterThanOrEqual(3);
};

describe('diagram theme roles and category families', () => {
  it.each(Object.values(ThemeColorMode))(
    '%s has coordinated, distinct and readable ramps in both appearances',
    (id) => {
      for (const appearance of ['light', 'dark'] as const) {
        const theme = resolveBoardTheme({ themeColorMode: id }, appearance);
        expect(theme.series).toHaveLength(6);
        expect(
          new Set(
            theme.series!.map(
              (_, index) => resolveThemeSeries(theme, index).fill,
            ),
          ).size,
        ).toBe(6);
        for (const role of roles) {
          expect(
            new Set(
              levels.map((level) => resolveThemeRole(theme, role, level).fill),
            ).size,
          ).toBe(3);
          for (const level of levels)
            assertReadableTone(resolveThemeRole(theme, role, level), theme);
        }
        for (let index = 0; index < 6; index++) {
          expect(
            new Set(
              levels.map(
                (level) => resolveThemeSeries(theme, index, level).fill,
              ),
            ).size,
          ).toBe(3);
          for (const level of levels)
            assertReadableTone(resolveThemeSeries(theme, index, level), theme);
        }
        for (const level of levels) {
          expect(resolveThemeRole(theme, 'primary', level)).toBe(
            resolveThemeSeries(theme, 0, level),
          );
          expect(resolveThemeRole(theme, 'secondary', level)).toBe(
            resolveThemeSeries(theme, 1, level),
          );
          expect(resolveThemeRole(theme, 'tertiary', level)).toBe(
            resolveThemeSeries(theme, 2, level),
          );
        }
        expect(resolveThemeRole(theme, 'primary')).toBe(
          theme.roles!.primary.normal,
        );
      }
      const light = BoardThemeDefinitions[id].light,
        dark = BoardThemeDefinitions[id].dark;
      for (const role of roles)
        for (const level of levels)
          expect(resolveThemeRole(light, role, level).fill).not.toBe(
            resolveThemeRole(dark, role, level).fill,
          );
    },
  );

  it('wraps category indices without random or order-dependent results', () => {
    const theme = resolveBoardTheme(undefined, 'dark');
    expect(resolveThemeSeries(theme, 6)).toBe(resolveThemeSeries(theme, 0));
    expect(resolveThemeSeries(theme, -1)).toBe(resolveThemeSeries(theme, 5));
    expect(resolveThemeSeries(theme, 1.8)).toBe(resolveThemeSeries(theme, 1));
    expect(resolveThemeSeries(theme, Number.NaN)).toBe(
      resolveThemeSeries(theme, 0),
    );
    expect(resolveThemeSeries(theme, Infinity)).toBe(
      resolveThemeSeries(theme, 0),
    );
  });

  it('supports older custom theme palettes without adding fields or changing existing colors', () => {
    const {
      roles: _roles,
      series: _series,
      ...legacy
    } = BoardThemeDefinitions.retro.dark;
    const before = JSON.stringify(legacy);
    for (const role of roles)
      for (const level of levels)
        assertReadableTone(resolveThemeRole(legacy, role, level), legacy);
    assertReadableTone(
      resolveThemeSeries({ ...legacy, series: [] }, 2),
      legacy,
    );
    expect(JSON.stringify(legacy)).toBe(before);
    expect(legacy).not.toHaveProperty('roles');
    expect(legacy).not.toHaveProperty('series');
  });

  it('adjusts borders for an explicit canvas background without mutating the shared ramps', () => {
    const theme = resolveBoardTheme(
      {
        themeColorMode: ThemeColorMode.dark,
        backgroundMode: 'custom',
        boardBackground: '#ffffff',
      },
      'dark',
    );
    const before = JSON.stringify(theme);
    for (const role of roles)
      for (const level of levels) {
        const shared = theme.roles![role][level];
        const tone = resolveThemeRole(theme, role, level);
        const score = (stroke: string) =>
          Math.min(
            colorContrast(tone.fill, stroke),
            colorContrast(theme.background, stroke),
          );
        expect(colorContrast(tone.fill, tone.textColor)).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(score(tone.strokeColor)).toBeGreaterThanOrEqual(
          score(shared.strokeColor),
        );
      }
    assertReadableTone(resolveThemeRole(theme, 'primary', 'subtle'), theme);
    expect(JSON.stringify(theme)).toBe(before);
    expect(theme.roles).not.toBe(BoardThemeDefinitions.dark.dark.roles);
    expect(theme.canvas).toBe('#ffffff');
    expect(resolveThemeSeries(theme, 0).fill).not.toBe(
      resolveThemeSeries(BoardThemeDefinitions.dark.dark, 0).fill,
    );
  });

  it('supplies defaults without overriding custom colors or legacy rendering', () => {
    const theme = resolveBoardTheme(undefined, 'dark');
    const tone = resolveThemeRole(theme, 'secondary', 'strong');
    const cell: NodeCell = {
      ...createFrameCell('node'),
      cellType: 'node',
      kind: 'geometry',
      appearance: {
        fill: '#ffffff',
        strokeColor: '#123456',
        colorSources: { fill: 'custom', strokeColor: 'custom' },
      },
    };
    expect(resolveCellAppearance(cell, theme, tone)).toMatchObject(
      cell.appearance!,
    );
    expect(
      resolveCellAppearance(
        { ...cell, appearance: { fill: '#f00', strokeColor: '#00f' } },
        resolveBoardTheme(),
        tone,
      ),
    ).toMatchObject({ fill: '#f00', strokeColor: '#00f' });
  });
});

it('keeps the native design palette values synchronized with the actual theme definitions', () => {
  const document = JSON.parse(
    readFileSync(
      path.resolve(
        process.cwd(),
        '../../../workspace/文档/架构/系统架构.verd-doc.json',
      ),
      'utf8',
    ),
  );
  const block = document.text.content.content.find(
    (node: { type: string; content?: { text?: string }[] }) =>
      node.type === 'codeBlock' &&
      node.content?.[0]?.text?.includes('"neutral"') &&
      node.content?.[0]?.text?.includes('"series"'),
  );
  expect(block).toBeDefined();
  const tuple = (tone: BoardThemeTone) => [
    tone.fill,
    tone.strokeColor,
    tone.textColor,
  ];
  const expected = Object.values(ThemeColorMode).flatMap((themeColorMode) =>
    (['light', 'dark'] as const).map((appearance) => {
      const theme = resolveBoardTheme({ themeColorMode }, appearance);
      return {
        theme: themeColorMode,
        appearance,
        neutral: levels.map((level) =>
          tuple(resolveThemeRole(theme, 'neutral', level)),
        ),
        annotation: levels.map((level) =>
          tuple(resolveThemeRole(theme, 'annotation', level)),
        ),
        series: Array.from({ length: 6 }, (_, index) =>
          levels.map((level) => tuple(resolveThemeSeries(theme, index, level))),
        ),
      };
    }),
  );
  expect(JSON.parse(block.content[0].text)).toEqual(expected);
});

it('aliases semantic levels without changing legacy ramps', () => {
  const theme = resolveBoardTheme(undefined, 'light');
  for (const [level, legacy] of [
    ['container', 'subtle'],
    ['node', 'normal'],
    ['emphasis', 'strong'],
  ] as const)
    expect(resolveThemeSeries(theme, 2, level)).toBe(
      resolveThemeSeries(theme, 2, legacy),
    );
});

it('gives Classic the complete former Colorful light and dark palettes', () => {
  expect(themeConfig.themes.default.light).toEqual({
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
  });
  expect(themeConfig.themes.default.dark).toEqual({
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
  });
});

it('keeps the same purple, rose, ochre, teal, blue and grass family ordinals in every appearance', () => {
  const expected = {
    default: [
      ['#b59ad7', '#d89baf', '#d7b477', '#83b8ab', '#91afcf', '#a8bd85'],
      ['#cba6f7', '#f2a6bc', '#f9d89c', '#94d8c5', '#9dbfef', '#b8d59a'],
    ],
    colorful: [
      ['#8b5cf6', '#f43f5e', '#f5b800', '#00b8a9', '#2f7cf6', '#74bc1f'],
      ['#bb8aff', '#ff718b', '#ffd84d', '#43d7c5', '#73adff', '#a5d94f'],
    ],
    soft: [
      ['#9a83ad', '#b47f89', '#ba9d68', '#6e9e9a', '#748fae', '#8da579'],
      ['#c5b7c7', '#cfb5b8', '#d0bfa7', '#b2c7c6', '#b1c0c9', '#b7c3b4'],
    ],
    retro: [
      ['#94718a', '#b56050', '#8b6138', '#447e6c', '#6c7e9c', '#929251'],
      ['#c5a4b5', '#d69b88', '#d7b77b', '#99b8a2', '#9cb1c9', '#cabd85'],
    ],
    dark: [
      ['#8d87af', '#b47e91', '#b89a69', '#2a8793', '#568db4', '#85a582'],
      ['#b7afd6', '#d8a7b9', '#dbc18e', '#7fc7cd', '#9abedf', '#b5cca5'],
    ],
  };
  for (const id of Object.values(ThemeColorMode)) {
    for (const [modeIndex, appearance] of (
      ['light', 'dark'] as const
    ).entries()) {
      const theme = resolveBoardTheme({ themeColorMode: id }, appearance);
      expect(themeConfig.themes[id][appearance].seriesSeeds).toEqual(
        expected[id][modeIndex],
      );
      for (let index = 0; index < 6; index++) {
        expect(
          resolveThemeSeries(theme, index, 'node', 'overlay').fill.slice(0, 7),
        ).toBe(expected[id][modeIndex][index]);
      }
    }
  }
});

it('retains theme accents independently from categorical primary and preserves the fill weights', () => {
  for (const id of [
    ThemeColorMode.soft,
    ThemeColorMode.retro,
    ThemeColorMode.dark,
  ]) {
    for (const appearance of ['light', 'dark'] as const) {
      const theme = resolveBoardTheme({ themeColorMode: id }, appearance);
      expect(theme.accent).toBe(themeConfig.themes[id][appearance].accent);
      expect(theme.accent).not.toBe(
        resolveThemeRole(theme, 'primary', 'node', 'overlay').fill.slice(0, 7),
      );
      expect(resolveThemeRole(theme, 'primary')).toBe(
        resolveThemeSeries(theme, 0),
      );
    }
  }
  expect(themeConfig.styleAmounts).toEqual({
    light: { container: 0.1, node: 0.24, emphasis: 0.44 },
    dark: { container: 0.14, node: 0.3, emphasis: 0.48 },
  });
  expect(themeConfig.neutralAmounts).toEqual({
    container: 0,
    node: 0.06,
    emphasis: 0.14,
  });
});

it('gives Soft a lighter warm canvas and more separated muted hues', () => {
  expect(themeConfig.themes.soft.light).toMatchObject({
    background: '#faf9f7',
    surface: '#ffffff',
    header: '#f0ede9',
    text: '#494746',
    stroke: '#8b8682',
    accent: '#748fae',
  });
  const lightness = (hex: string) =>
    [1, 3, 5].reduce((sum, at) => sum + parseInt(hex.slice(at, at + 2), 16), 0);
  expect(lightness(themeConfig.themes.soft.light.background)).toBeGreaterThan(
    lightness('#f3f1ef'),
  );
  // Expand the blue/teal and purple/rose hue gaps from the former palette.
  const hue = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(
      (at) => parseInt(hex.slice(at, at + 2), 16) / 255,
    );
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      delta = max - min;
    const value =
      max === r
        ? (g - b) / delta
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
    return (value * 60 + 360) % 360;
  };
  const distance = (a: string, b: string) => {
    const value = Math.abs(hue(a) - hue(b));
    return Math.min(value, 360 - value);
  };
  const seeds = themeConfig.themes.soft.light.seriesSeeds;
  expect(distance(seeds[3], seeds[4])).toBeGreaterThan(
    distance('#8ea5a6', '#8497a5'),
  );
  expect(distance(seeds[0], seeds[1])).toBeGreaterThan(
    distance('#a295a8', '#b09a9e'),
  );
});
