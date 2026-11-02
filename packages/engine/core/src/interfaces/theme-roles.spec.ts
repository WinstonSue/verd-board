import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFrameCell, type NodeCell } from '../cell/types';
import { ThemeColorMode } from './theme';
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
        themeColorMode: ThemeColorMode.starry,
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
    expect(theme.roles).toBe(BoardThemeDefinitions.starry.dark.roles);
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
