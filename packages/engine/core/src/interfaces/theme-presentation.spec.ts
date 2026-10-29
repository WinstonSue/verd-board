import { describe, expect, it } from 'vitest';
import {
  BoardThemeDefinitions,
  colorContrast,
  readableThemeText,
  resolveBoardTheme,
  resolveCellAppearance,
} from './theme-presentation';
import { copyCellFragment } from '../cell/clipboard';
import { createCellStore, createFrameCell } from '../cell/types';
import { ThemeColorMode } from './theme';
import { updateCellAppearance } from '../cell/commands';
import type { CellStore, NodeCell } from '../cell/types';

const shape: NodeCell = {
  id: 'shape',
  kind: 'geometry',
  cellType: 'node',
  geometry: { x: 0, y: 0, width: 100, height: 50 },
  appearance: { fill: '#fff', strokeColor: '#64748b' },
};

describe('adaptive theme presentation', () => {
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
      [ThemeColorMode.retro, '#f8fafc'],
      [ThemeColorMode.retro, '#f9f8ed'],
      [ThemeColorMode.dark, '#141414'],
      [ThemeColorMode.starry, '#0d2537'],
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
      fill: theme.surface,
      strokeColor: theme.stroke,
    });
    expect(
      resolveCellAppearance({ ...shape, kind: 'mind-child' }, theme),
    ).toMatchObject({ fill: theme.surface, strokeColor: theme.stroke });
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
        themeColorMode: ThemeColorMode.starry,
        boardBackground: '#0d2537',
      }),
    ).toMatchObject({ adaptive: false, background: '#0d2537' });
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
    ).toBe(BoardThemeDefinitions.default.dark.surface);
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
          fill: theme.surface,
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
