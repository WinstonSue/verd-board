import { describe, expect, it } from 'vitest';
import {
  BoardThemeDefinitions,
  colorContrast,
  compositeThemeFill,
  resolveThemeSeries,
  resolveThemeRole,
  readableThemeText,
  resolveBoardTheme,
  resolveCellAppearance,
} from './theme-presentation';
import { copyCellFragment } from '../cell/clipboard';
import { createCellStore, createFrameCell } from '../cell/types';
import {
  BoardStyleColors,
  ColorfulThemeColor,
  DarkThemeColor,
  DEFAULT_COLOR,
  DefaultThemeColor,
  RetroThemeColor,
  SoftThemeColor,
  ThemeColorMode,
  ThemeColors,
} from './theme';
import { updateCellAppearance } from '../cell/commands';
import type { CellStore, NodeCell } from '../cell/types';

const shape: NodeCell = {
  id: 'shape',
  kind: 'geometry',
  cellType: 'node',
  geometry: { x: 0, y: 0, width: 100, height: 50 },
  appearance: { fill: '#fff', strokeColor: '#64748b' },
};

it.each(['starry', 'missing-theme'])(
  'falls back to Classic for unknown theme %s without rewriting input',
  (unknown) => {
    const input = {
      themeColorMode: unknown as ThemeColorMode,
      boardBackground: '#0d2537',
    };
    const before = JSON.stringify(input);
    for (const appearance of ['light', 'dark'] as const) {
      const fallback = resolveBoardTheme(input, appearance);
      expect(fallback.id).toBe(ThemeColorMode.default);
      expect(fallback.background).toBe(
        BoardThemeDefinitions.default[appearance].background,
      );
      expect(
        resolveBoardTheme({ ...input, backgroundMode: 'custom' }, appearance)
          .background,
      ).toBe('#0d2537');
    }
    expect(resolveBoardTheme(input).background).toBe('#f8fafc');
    expect(JSON.stringify(input)).toBe(before);
  },
);

it('offers exactly five themes and independently designed light/dark family seeds', () => {
  expect(Object.values(ThemeColorMode)).toEqual([
    'default',
    'colorful',
    'soft',
    'retro',
    'dark',
  ]);
  for (const themeColorMode of Object.values(ThemeColorMode)) {
    const light = resolveBoardTheme({ themeColorMode }, 'light');
    const dark = resolveBoardTheme({ themeColorMode }, 'dark');
    for (let index = 0; index < 6; index++)
      expect(
        resolveThemeSeries(light, index, 'node', 'overlay').fill.slice(0, 7),
      ).not.toBe(
        resolveThemeSeries(dark, index, 'node', 'overlay').fill.slice(0, 7),
      );
  }
});

it('keeps built-in dark canvases nearly neutral and yellow fills out of green', () => {
  for (const themeColorMode of Object.values(ThemeColorMode)) {
    const theme = resolveBoardTheme({ themeColorMode }, 'dark');
    const channels = (hex: string) =>
      [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
    const bg = channels(theme.canvas);
    expect(Math.max(...bg) - Math.min(...bg)).toBeLessThanOrEqual(5);
    for (let index = 0; index < 6; index++) {
      const overlay = resolveThemeSeries(theme, index, 'node', 'overlay').fill;
      const seed = channels(overlay);
      if (seed[0] < seed[1] || seed[1] - seed[2] < 20) continue;
      for (const level of ['node', 'emphasis'] as const) {
        const color = channels(
          compositeThemeFill(
            resolveThemeSeries(theme, index, level, 'overlay').fill,
            theme.canvas,
          ),
        );
        expect(color[0]).toBeGreaterThanOrEqual(color[1]);
        expect(color[1]).toBeGreaterThan(color[2]);
      }
    }
  }
});

describe('adaptive theme presentation', () => {
  it('preserves public legacy colors, family identities and array member references', () => {
    expect(DEFAULT_COLOR).toBe('#333333');
    expect(ThemeColors).toEqual([
      { mode: 'default', boardBackground: '#ffffff', textColor: '#333333' },
      { mode: 'colorful', boardBackground: '#ffffff', textColor: '#333333' },
      { mode: 'soft', boardBackground: '#f5f5f5', textColor: '#333333' },
      { mode: 'retro', boardBackground: '#f9f8ed', textColor: '#333333' },
      { mode: 'dark', boardBackground: '#141414', textColor: '#FFFFFF' },
    ]);
    const legacyExports = [
      DefaultThemeColor,
      ColorfulThemeColor,
      SoftThemeColor,
      RetroThemeColor,
      DarkThemeColor,
    ];
    legacyExports.forEach((color, index) =>
      expect(ThemeColors[index]).toBe(color),
    );
    expect(BoardStyleColors).toEqual([
      'series-1',
      'series-2',
      'series-3',
      'series-4',
      'series-5',
      'series-6',
    ]);
    // Adaptive Classic now uses the former Colorful white surface.
    expect(resolveBoardTheme(undefined, 'light').background).toBe('#ffffff');
  });

  it.each(Object.values(ThemeColorMode))(
    '%s has two readable variants and stable identity',
    (id) => {
      for (const appearance of ['light', 'dark'] as const) {
        const theme = resolveBoardTheme({ themeColorMode: id }, appearance);
        expect(theme.id).toBe(id);
        expect(theme.appearance).toBe(appearance);
        for (const background of [
          theme.background,
          theme.surface,
          theme.header,
          theme.note,
        ]) {
          expect(
            colorContrast(
              readableThemeText(background, theme.text),
              background,
            ),
          ).toBeGreaterThanOrEqual(4.5);
        }
        expect(
          colorContrast(theme.stroke, theme.background),
        ).toBeGreaterThanOrEqual(3);
        expect(
          colorContrast(theme.stroke, theme.surface),
        ).toBeGreaterThanOrEqual(3);
      }
      expect(BoardThemeDefinitions[id].light.background).not.toBe(
        BoardThemeDefinitions[id].dark.background,
      );
    },
  );

  it('recognizes historical backgrounds per theme and leaves custom backgrounds intact', () => {
    for (const [themeColorMode, boardBackground] of [
      [ThemeColorMode.default, '#fff'],
      [ThemeColorMode.colorful, '#fff'],
      [ThemeColorMode.colorful, '#f8fafc'],
      [ThemeColorMode.soft, '#f5f5f5'],
      [ThemeColorMode.soft, '#f8fafc'],
      [ThemeColorMode.retro, '#f8fafc'],
      [ThemeColorMode.retro, '#f9f8ed'],
      [ThemeColorMode.dark, '#141414'],
    ] as const) {
      expect(
        resolveBoardTheme({ themeColorMode, boardBackground }, 'dark')
          .background,
      ).toBe(BoardThemeDefinitions[themeColorMode].dark.background);
      expect(
        resolveBoardTheme(
          { themeColorMode, boardBackground, backgroundMode: 'custom' },
          'dark',
        ).background,
      ).toBe(boardBackground);
    }
    expect(
      resolveBoardTheme(
        { themeColorMode: ThemeColorMode.default, boardBackground: '#f9f8ed' },
        'dark',
      ).background,
    ).toBe('#f9f8ed');
  });

  it('takes over every unmarked color without mutating the source', () => {
    const original = JSON.stringify(shape);
    const theme = resolveBoardTheme(undefined, 'dark');
    expect(resolveCellAppearance(shape, theme)).toMatchObject({
      fill: resolveThemeRole(theme, 'neutral', 'node').fill,
      strokeColor: theme.stroke,
    });
    expect(
      resolveCellAppearance({ ...shape, kind: 'mind-child' }, theme),
    ).toMatchObject({
      fill: resolveThemeRole(theme, 'neutral', 'node').fill,
      strokeColor: theme.stroke,
    });
    expect(
      resolveCellAppearance(
        {
          ...shape,
          appearance: {
            fill: '#fff',
            strokeColor: '#64748b',
            colorSources: { fill: 'custom', strokeColor: 'custom' },
          },
        },
        theme,
      ),
    ).toMatchObject(shape.appearance!);
    expect(
      resolveCellAppearance(
        { ...shape, appearance: { fill: 'none', strokeColor: 'transparent' } },
        theme,
      ),
    ).toMatchObject({ fill: 'none', strokeColor: 'transparent' });
    expect(JSON.stringify(shape)).toBe(original);
  });

  it('preserves legacy public rendering when appearance is omitted', () => {
    expect(
      resolveBoardTheme({
        themeColorMode: ThemeColorMode.dark,
        boardBackground: '#141414',
      }),
    ).toMatchObject({ adaptive: false, background: '#141414' });
    expect(resolveCellAppearance(shape, resolveBoardTheme())).toMatchObject(
      shape.appearance!,
    );
  });

  it('tracks edits and per-field reset without losing other color sources', () => {
    const cell = {
      ...shape,
      appearance: {
        ...shape.appearance,
        colorSources: { fill: 'theme' as const, strokeColor: 'theme' as const },
      },
    };
    const store = {
      rootId: 'frame',
      cells: { shape: cell },
    } as unknown as CellStore;
    const edit = updateCellAppearance(store, ['shape'], { fill: '#ffffff' })[0];
    if (edit.type !== 'replace_cell' || edit.cell.cellType !== 'node')
      throw new Error('Expected node edit');
    expect(edit.cell.appearance?.colorSources).toEqual({
      fill: 'custom',
      strokeColor: 'theme',
    });
    store.cells.shape = JSON.parse(JSON.stringify(edit.cell));
    const reset = updateCellAppearance(store, ['shape'], {
      fill: undefined,
      colorSources: { fill: 'theme' },
    })[0];
    if (reset.type !== 'replace_cell' || reset.cell.cellType !== 'node')
      throw new Error('Expected reset');
    expect(
      resolveCellAppearance(reset.cell, resolveBoardTheme(undefined, 'dark'))
        .fill,
    ).toBe(
      resolveThemeRole(resolveBoardTheme(undefined, 'dark'), 'neutral', 'node')
        .fill,
    );
    expect(cell.appearance.colorSources.fill).toBe('theme');
  });
});

it.each(Object.values(ThemeColorMode))(
  'takes over arbitrary old colors in every kind for %s',
  (themeColorMode) => {
    for (const appearance of ['light', 'dark'] as const) {
      const theme = resolveBoardTheme({ themeColorMode }, appearance);
      for (const kind of [
        'geometry',
        'table',
        'swimlane',
        'mind-child',
        'workflow-task',
        'architecture-module',
        'uml-class',
        'uml-note',
      ]) {
        const cell = {
          ...shape,
          kind,
          appearance: { fill: '#ff00ff', strokeColor: '#123456' },
        };
        expect(resolveCellAppearance(cell, theme)).toMatchObject({
          fill: resolveThemeRole(theme, 'neutral', 'node').fill,
          strokeColor: theme.stroke,
        });
        expect(
          resolveCellAppearance(
            {
              ...cell,
              appearance: {
                ...cell.appearance,
                colorSources: { fill: 'custom', strokeColor: 'custom' },
              },
            },
            theme,
          ),
        ).toMatchObject(cell.appearance);
        expect(resolveCellAppearance(cell, resolveBoardTheme())).toMatchObject(
          cell.appearance,
        );
      }
      const note = resolveCellAppearance(shape, theme, { fill: theme.note });
      expect(note.fill).toBe(theme.note);
      expect(
        colorContrast(note.fill!, note.strokeColor!),
      ).toBeGreaterThanOrEqual(3);
    }
  },
);

it('retains explicit default-colored overrides in clipboard JSON', () => {
  const frame = createFrameCell('root');
  frame.children = ['shape'];
  const store = createCellStore(frame);
  store.cells.shape = {
    ...shape,
    appearance: { fill: '#fff', colorSources: { fill: 'custom' } },
  };
  const copied = JSON.parse(JSON.stringify(copyCellFragment(store, ['shape'])))
    .cells.shape as NodeCell;
  expect(
    resolveCellAppearance(copied, resolveBoardTheme(undefined, 'dark')).fill,
  ).toBe('#fff');
  expect(copied.appearance?.colorSources?.fill).toBe('custom');
});

it.each(['#ffffff', '#f4d35e', '#121b2f'])(
  'composites node colors over %s while keeping container ramps opaque',
  (background) => {
    for (const appearance of ['light', 'dark'] as const) {
      const theme = resolveBoardTheme(
        { backgroundMode: 'custom', boardBackground: background },
        appearance,
      );
      const unchanged = JSON.stringify(theme);
      const fills = new Set<string>();
      for (let index = 0; index < 6; index++) {
        const overlay = resolveThemeSeries(theme, index, 'normal', 'overlay');
        const opaque = resolveThemeSeries(theme, index, 'normal', 'opaque');
        const effective = compositeThemeFill(overlay.fill, background);
        expect(overlay.fill).toMatch(/^#[\da-f]{8}$/);
        expect(opaque.fill).toBe(effective);
        expect(
          colorContrast(effective, overlay.textColor),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          colorContrast(effective, overlay.strokeColor),
        ).toBeGreaterThanOrEqual(3);
        expect(
          colorContrast(background, overlay.strokeColor),
        ).toBeGreaterThanOrEqual(3);
        const alternate = compositeThemeFill(
          overlay.fill,
          background === '#ffffff' ? '#f4d35e' : '#ffffff',
        );
        expect(effective).not.toBe(alternate);
        // Alpha compositing retains each seed's channel ordering (hue family).
        const channels = (value: string) =>
          [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16));
        const seed = channels(overlay.fill),
          bg = channels(background),
          paint = channels(effective);
        const alpha = parseInt(overlay.fill.slice(7), 16) / 255;
        for (let at = 0; at < 3; at++)
          expect(
            Math.abs(paint[at] - bg[at] * (1 - alpha) - seed[at] * alpha),
          ).toBeLessThanOrEqual(0.5);
        fills.add(effective);
        expect(resolveThemeSeries(theme, index).fill).toMatch(/^#[\da-f]{6}$/);
      }
      expect(fills.size).toBe(6);
      expect(JSON.stringify(theme)).toBe(unchanged);
    }
  },
);
