import { expect, it } from 'vitest';
import {
  colorContrast,
  compositeThemeFill,
  resolveBoardTheme,
  BoardStyleColors,
  resolveThemeSeries,
  type NodeCell,
} from '@sue/board-core';
import {
  resolveFrameAppearance,
  resolveFrameCellAppearance,
  frameThemeAppearance,
} from './frame-appearance';

it.each(BoardStyleColors)(
  'keeps %s bound to the same family across themes and appearances',
  (family) => {
    const cell: NodeCell = {
      id: 'node',
      kind: 'geometry',
      cellType: 'node',
      geometry: { x: 0, y: 0, width: 100, height: 60 },
      appearance: { styleColor: family },
    };
    const before = JSON.stringify(cell);
    for (const appearance of ['light', 'dark'] as const)
      for (const level of ['container', 'node', 'emphasis'] as const) {
        const fills = [];
        for (const themeColorMode of ['default', 'colorful'] as const) {
          const theme = resolveBoardTheme({ themeColorMode }, appearance);
          const context = {
            cell,
            store: { rootId: 'f', cells: { node: cell } },
            frameId: 'f',
            theme,
          };
          const visual = resolveFrameAppearance(
            context,
            frameThemeAppearance(context, 'primary', level),
          );
          expect(visual).toMatchObject(
            resolveThemeSeries(
              theme,
              BoardStyleColors.indexOf(family),
              level,
              'overlay',
            ),
          );
          expect(visual.styleFamily).toBe(family);
          expect(visual.styleLevel).toBe(level);
          fills.push(visual.fill);
        }
        expect(new Set(fills).size).toBe(2);
      }
    expect(JSON.stringify(cell)).toBe(before);
    cell.appearance = {
      ...cell.appearance,
      fill: '#ffffff',
      colorSources: { fill: 'custom' },
    };
    for (const themeColorMode of ['default', 'colorful'] as const) {
      const context = {
        cell,
        store: { rootId: 'f', cells: { node: cell } },
        frameId: 'f',
        theme: resolveBoardTheme({ themeColorMode }, 'dark'),
      };
      expect(
        resolveFrameAppearance(
          context,
          frameThemeAppearance(context, 'primary'),
        ).fill,
      ).toBe('#ffffff');
    }
  },
);

it('resolves text after per-field custom fills and preserves runtime-only defaults through reset', () => {
  const cell: NodeCell = {
    id: 'node',
    kind: 'geometry',
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 100, height: 40 },
  };
  const context = {
    cell,
    store: { rootId: 'frame', cells: { node: cell } },
    frameId: 'frame',
    theme: resolveBoardTheme(undefined, 'dark'),
  };
  const defaults = {
    fill: '#312e81',
    strokeColor: '#a5b4fc',
    textColor: '#e2e8f0',
  };
  const before = JSON.stringify(context.store);
  expect(resolveFrameAppearance(context, defaults)).toMatchObject(defaults);
  expect(JSON.stringify(context.store)).toBe(before);
  cell.appearance = { fill: '#ffffff', colorSources: { fill: 'custom' } };
  const custom = resolveFrameAppearance(context, defaults);
  expect(custom.fill).toBe('#ffffff');
  expect(colorContrast(custom.fill!, custom.textColor!)).toBeGreaterThanOrEqual(
    4.5,
  );
  expect(
    colorContrast(custom.fill!, custom.strokeColor!),
  ).toBeGreaterThanOrEqual(3);
  cell.appearance.colorSources!.fill = 'theme';
  expect(resolveFrameAppearance(context, defaults)).toMatchObject(defaults);
  expect(cell.appearance).not.toHaveProperty('textColor');
});

it('shares domain defaults with inspectors, while transparent parts use the supporting background', () => {
  const cell: NodeCell = {
    id: 'node',
    kind: 'geometry',
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 100, height: 40 },
    appearance: { fill: 'transparent' },
  };
  const context = {
    cell,
    store: { rootId: 'frame', cells: { node: cell } },
    frameId: 'frame',
    theme: resolveBoardTheme(undefined, 'dark'),
    background: '#ffffff',
  };
  const visual = resolveFrameCellAppearance(context, [
    {
      kind: 'geometry',
      themeAppearance: () => ({ fill: '#312e81', textColor: '#e2e8f0' }),
    },
  ]);
  expect(visual.fill).toBe('transparent');
  expect(colorContrast('#ffffff', visual.textColor!)).toBeGreaterThanOrEqual(
    4.5,
  );
  expect(visual).toEqual(
    resolveFrameAppearance(context, { fill: '#312e81', textColor: '#e2e8f0' }),
  );
});

it('ignores adaptive role defaults when appearance is omitted', () => {
  const cell: NodeCell = {
    id: 'node',
    kind: 'geometry',
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 100, height: 40 },
    appearance: { fill: '#abcdef', strokeColor: '#123456' },
  };
  const context = {
    cell,
    store: { rootId: 'frame', cells: { node: cell } },
    frameId: 'frame',
    theme: resolveBoardTheme(),
  };
  const visual = resolveFrameAppearance(context, {
    fill: '#312e81',
    strokeColor: '#a5b4fc',
    textColor: '#fff',
  });
  expect(visual).toMatchObject(cell.appearance!);
  expect(visual).not.toHaveProperty('textColor');
});

it('carries the effective overlay paint into exports and preserves custom alpha fills', () => {
  const cell: NodeCell = {
    id: 'node',
    kind: 'geometry',
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 100, height: 40 },
  };
  const context = {
    cell,
    store: { rootId: 'frame', cells: { node: cell } },
    frameId: 'frame',
    theme: resolveBoardTheme(
      { backgroundMode: 'custom', boardBackground: '#121b2f' },
      'light',
    ),
  };
  const visual = resolveFrameAppearance(context, { fill: '#7c3aed3d' });
  expect(visual.exportFill).toMatch(/^#[\da-f]{6}$/);
  expect(
    colorContrast(visual.exportFill!, visual.textColor!),
  ).toBeGreaterThanOrEqual(4.5);
  cell.appearance = { fill: '#ff000080', colorSources: { fill: 'custom' } };
  expect(
    resolveFrameAppearance(context, { fill: '#7c3aed3d' }).exportFill,
  ).toBeUndefined();
});

it('applies explicit style families per field and freezes overlays against the supporting container', () => {
  const cell: NodeCell = {
    id: 'n',
    kind: 'geometry',
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 100, height: 60 },
    appearance: { styleColor: 'series-5' },
  };
  const theme = resolveBoardTheme(
    { backgroundMode: 'custom', boardBackground: '#f4d35e' },
    'light',
  );
  const context = {
    cell,
    store: { rootId: 'f', cells: { n: cell } },
    frameId: 'f',
    theme,
    background: '#faf0dd',
  };
  const defaults = {
    styleFamily: 'neutral' as const,
    styleLevel: 'emphasis' as const,
    fillMode: 'overlay' as const,
  };
  const visual = resolveFrameAppearance(context, defaults);
  expect(visual.styleFamily).toBe('series-5');
  expect(visual.styleLevel).toBe('emphasis');
  expect(visual.exportFill).toBe(
    compositeThemeFill(visual.fill!, context.background),
  );
  expect(theme.canvas).toBe('#f4d35e');
  cell.appearance = {
    ...cell.appearance,
    fill: '#ffffff',
    colorSources: { fill: 'custom' },
  };
  expect(resolveFrameAppearance(context, defaults)).toMatchObject({
    fill: '#ffffff',
    styleFamily: 'series-5',
  });
  expect(resolveFrameAppearance(context, defaults).strokeColor).not.toBe(
    '#ffffff',
  );
});
