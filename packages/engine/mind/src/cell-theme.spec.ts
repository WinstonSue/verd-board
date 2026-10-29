import { expect, it } from 'vitest';
import { createInlineText, formatBoardText } from '@sue/board-common';
import {
  colorContrast,
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
  mindNoteColor,
  mindPresentation,
  mindTheme,
} from './cell-theme';

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
    mind: { colorScheme: 'starry' },
  };
  const before = JSON.stringify(store);
  for (const appearance of ['light', 'dark'] as const) {
    const colors = mindTheme('starry', appearance);
    expect(
      mindPresentation(store, store.cells.root as NodeCell, 'frame', appearance)
        .fill,
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
    mindPresentation(store, store.cells.root as NodeCell, 'frame', 'dark').fill,
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
        const background =
          result.fill && result.fill !== 'none'
            ? result.fill
            : resolveBoardTheme(frame.view.theme, appearance).background;
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
