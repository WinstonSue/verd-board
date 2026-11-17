import { expect, it } from 'vitest';
import { createInlineText, formatBoardText } from '@sue/board-common';
import {
  colorContrast,
  compositeThemeFill,
  BoardStyleColors,
  resolveThemeFamily,
  resolveBoardTheme,
  applyCellOperations,
  ThemeColorMode,
  type FrameCell,
  type NodeCell,
} from '@sue/board-core';
import { createTestCellRegistry } from '../../../../tests/fixtures/plugins/registry';
import {
  addMindChild,
  createMindChildCell,
  createMindFrameSnapshot,
} from './cell-commands';
import {
  mindBranchColor,
  mindFrameColorScheme,
  mindNoteColor,
  mindPresentation,
  mindTheme,
} from './cell-theme';

it('derives Mind palettes from the common six families in every theme and appearance', () => {
  for (const themeColorMode of Object.values(ThemeColorMode))
    for (const appearance of ['light', 'dark'] as const) {
      const theme = resolveBoardTheme({ themeColorMode }, appearance);
      const palette = mindTheme(themeColorMode, appearance);
      expect(palette.branches).toHaveLength(6);
      expect(palette.branches).toEqual(
        BoardStyleColors.map(
          (family) => resolveThemeFamily(theme, family, 'node').strokeColor,
        ),
      );
      expect(palette.rootFill).toBe(
        resolveThemeFamily(theme, 'series-1', 'emphasis').fill,
      );
    }
});

it('cycles six main branches, inherits descendants, and applies node families to outgoing edges', () => {
  const registry = createTestCellRegistry();
  let store = createMindFrameSnapshot('frame', 'root').store;
  for (let at = 0; at < 7; at++)
    store = applyCellOperations(
      store,
      addMindChild(
        store,
        'root',
        createMindChildCell(`main-${at}`),
        `edge-${at}`,
      ),
      registry,
    );
  store = applyCellOperations(
    store,
    addMindChild(store, 'main-1', createMindChildCell('child'), 'child-edge'),
    registry,
  );
  store = applyCellOperations(
    store,
    addMindChild(
      store,
      'child',
      createMindChildCell('grandchild'),
      'grandchild-edge',
    ),
    registry,
  );
  const frame = store.cells.frame as FrameCell;
  frame.view = { theme: { themeColorMode: ThemeColorMode.colorful } };
  const theme = resolveBoardTheme(frame.view.theme, 'dark');
  const before = JSON.stringify(store);
  for (let at = 0; at < 7; at++) {
    const color = resolveThemeFamily(
      theme,
      BoardStyleColors[at % 6],
      'node',
    ).strokeColor;
    expect(mindBranchColor(store, `main-${at}`, 'frame', 'dark')).toBe(color);
  }
  const child = store.cells.child as NodeCell;
  expect(mindPresentation(store, child, 'frame', 'dark').styleFamily).toBe(
    'series-2',
  );
  expect(mindPresentation(store, child, 'frame', 'dark').fill).toBe('none');
  expect(JSON.stringify(store)).toBe(before);
  child.appearance = { styleColor: 'series-5' };
  expect(mindPresentation(store, child, 'frame', 'dark').styleFamily).toBe(
    'series-5',
  );
  expect(
    mindPresentation(store, store.cells.grandchild as NodeCell, 'frame', 'dark')
      .styleFamily,
  ).toBe('series-5');
  // The incoming child edge follows its parent; its outgoing edge follows itself.
  expect(mindBranchColor(store, 'child', 'frame', 'dark')).toBe(
    resolveThemeFamily(theme, 'series-2', 'node').strokeColor,
  );
  expect(mindBranchColor(store, 'grandchild', 'frame', 'dark')).toBe(
    resolveThemeFamily(theme, 'series-5', 'node').strokeColor,
  );
  child.appearance = {
    ...child.appearance,
    strokeColor: '#ff0000',
    colorSources: { strokeColor: 'custom' },
  };
  expect(mindPresentation(store, child, 'frame', 'dark').stroke).toBe(
    '#ff0000',
  );
});

it('falls back unknown Mind schemes to Classic and inherits only when absent', () => {
  const frame = createMindFrameSnapshot('frame', 'root').store.cells
    .frame as FrameCell;
  frame.view = {
    theme: { themeColorMode: ThemeColorMode.retro },
    mind: { colorScheme: 'starry' as never },
  };
  const before = JSON.stringify(frame);
  expect(mindFrameColorScheme(frame)).toBe('default');
  expect(mindTheme('missing-theme', 'dark')).toEqual(
    mindTheme('default', 'dark'),
  );
  expect(JSON.stringify(frame)).toBe(before);
  delete frame.view.mind;
  expect(mindFrameColorScheme(frame)).toBe('retro');
});

it('adapts inherited and explicit schemes without changing explicit text, fill or branch colors', () => {
  const registry = createTestCellRegistry();
  let store = createMindFrameSnapshot('frame', 'root').store;
  store = applyCellOperations(
    store,
    addMindChild(store, 'root', createMindChildCell('child'), 'edge'),
    registry,
  );
  const frame = store.cells.frame as FrameCell;
  frame.view = {
    theme: { themeColorMode: ThemeColorMode.retro },
    mind: { colorScheme: 'retro' },
  };
  const before = JSON.stringify(store);
  for (const appearance of ['light', 'dark'] as const) {
    const colors = mindTheme('retro', appearance);
    expect(
      compositeThemeFill(
        mindPresentation(
          store,
          store.cells.root as NodeCell,
          'frame',
          appearance,
        ).fill!,
        resolveBoardTheme(frame.view.theme, appearance).canvas,
      ),
    ).toBe(colors.rootFill);
    expect(mindBranchColor(store, 'child', 'frame', appearance)).toBe(
      colors.branches[0],
    );
    expect(mindNoteColor(store, 'child', 'frame', appearance)).toBe(
      colors.note,
    );
  }
  expect(JSON.stringify(store)).toBe(before);
  const child = store.cells.child as NodeCell;
  child.appearance = {
    fill: '#ffffff',
    strokeColor: '#f00',
    colorSources: { fill: 'custom', strokeColor: 'custom' },
  };
  child.content = {
    text: {
      ...createInlineText('Custom'),
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Custom',
                marks: [
                  {
                    type: 'textStyle',
                    attrs: { color: '#b91c1c', colorSource: 'custom' },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };
  expect(mindPresentation(store, child, 'frame', 'dark')).toMatchObject({
    fill: '#ffffff',
    stroke: '#f00',
    color: '#b91c1c',
  });
  delete frame.view.mind;
  expect(
    compositeThemeFill(
      mindPresentation(store, store.cells.root as NodeCell, 'frame', 'dark')
        .fill!,
      resolveBoardTheme(frame.view?.theme, 'dark').canvas,
    ),
  ).toBe(mindTheme('retro', 'dark').rootFill);
});

it('carries per-field source information when a styled sibling is inherited', () => {
  const registry = createTestCellRegistry();
  let store = createMindFrameSnapshot('frame', 'root').store;
  const first = createMindChildCell('first');
  first.appearance = { fill: '#fff', colorSources: { fill: 'custom' } };
  store = applyCellOperations(
    store,
    addMindChild(store, 'root', first, 'first-edge'),
    registry,
  );
  store = applyCellOperations(
    store,
    addMindChild(
      store,
      'root',
      createMindChildCell('second'),
      'second-edge',
      undefined,
      'first',
    ),
    registry,
  );
  const copied = JSON.parse(JSON.stringify(store.cells.second)) as NodeCell;
  expect(copied.appearance?.colorSources?.fill).toBe('custom');
  expect(mindPresentation(store, copied, 'frame', 'dark').fill).toBe('#fff');
});

it('keeps automatic text and outlines readable on a fixed white root in dark appearance', () => {
  const store = createMindFrameSnapshot('frame', 'root').store;
  const root = store.cells.root as NodeCell;
  root.appearance = { fill: '#ffffff', colorSources: { fill: 'custom' } };
  const presentation = mindPresentation(store, root, 'frame', 'dark');
  expect(
    colorContrast(presentation.fill!, presentation.color),
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    colorContrast(presentation.fill!, presentation.stroke!),
  ).toBeGreaterThanOrEqual(3);
  expect(
    colorContrast(
      presentation.fill!,
      mindNoteColor(store, 'root', 'frame', 'dark'),
    ),
  ).toBeGreaterThanOrEqual(4.5);
});

it('takes over unmarked branch, fill and legacy text colors, while preserving manual branches and reset inheritance', () => {
  const registry = createTestCellRegistry();
  let store = createMindFrameSnapshot('frame', 'root').store;
  const first = createMindChildCell('first');
  first.appearance = { fill: '#ff00ff', strokeColor: '#00ff00' };
  first.data = {
    ...first.data,
    color: '#ff0000',
    branchAppearance: { strokeColor: '#123456' },
  } as typeof first.data;
  store = applyCellOperations(
    store,
    addMindChild(store, 'root', first, 'edge'),
    registry,
  );
  expect(mindBranchColor(store, 'first', 'frame', 'dark')).not.toBe('#123456');
  expect(
    mindPresentation(store, store.cells.first as NodeCell, 'frame', 'dark'),
  ).toMatchObject({ fill: 'none' });
  expect(
    mindPresentation(store, store.cells.first as NodeCell, 'frame', 'dark')
      .color,
  ).not.toBe('#ff0000');
  const child = store.cells.first as NodeCell<import('./types').MindNodeData>;
  child.data!.branchAppearance = {
    strokeColor: '#123456',
    colorSources: { strokeColor: 'custom' },
  };
  expect(mindBranchColor(store, 'first', 'frame', 'dark')).toBe('#123456');
  child.data!.branchAppearance = {
    strokeColor: '#123456',
    colorSources: { strokeColor: 'theme' },
  };
  child.appearance = {
    strokeColor: '#00ff00',
    colorSources: { strokeColor: 'custom' },
  };
  expect(mindBranchColor(store, 'first', 'frame', 'dark')).not.toBe('#00ff00');
  expect(mindBranchColor(store, 'first', 'frame')).toBe('#123456');
});

it('resolves legacy and theme rich text for every appearance, while retaining custom text and literal third-party rendering', () => {
  const store = createMindFrameSnapshot('frame', 'root').store;
  const root = store.cells.root as NodeCell;
  const frame = store.cells.frame as FrameCell;
  const text = createInlineText('Legacy title');
  text.content.content![0].content![0].marks = [
    { type: 'textStyle', attrs: { color: '#24354b', fontSize: '18px' } },
  ];
  root.content = { text };
  for (const themeColorMode of Object.values(ThemeColorMode)) {
    frame.view = { theme: { themeColorMode } };
    for (const appearance of ['light', 'dark'] as const) {
      for (const source of [undefined, 'theme'] as const) {
        text.content.content![0].content![0].marks![0].attrs!['colorSource'] =
          source;
        const before = JSON.stringify(store);
        const result = mindPresentation(store, root, 'frame', appearance);
        const background = compositeThemeFill(
          result.fill ?? 'none',
          resolveBoardTheme(frame.view.theme, appearance).background,
        );
        expect(colorContrast(background, result.color)).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(JSON.stringify(store)).toBe(before);
      }
      root.content.text = formatBoardText(text, { color: '#24354b' });
      expect(mindPresentation(store, root, 'frame', appearance).color).toBe(
        '#24354b',
      );
      root.content.text = formatBoardText(root.content.text, { color: null });
      expect(mindPresentation(store, root, 'frame', appearance).color).not.toBe(
        '#24354b',
      );
      root.content.text = text;
    }
  }
  expect(mindPresentation(store, root, 'frame').color).toBe('#24354b');
});
