import { expect, it } from 'vitest';
import {
  createCellStore,
  createFrameCell,
  resolveBoardTheme,
  type EdgeCell,
} from '@sue/board-core';
import { createUmlClassCell } from '@sue/board-uml';
import {
  umlThemeAppearance,
  resolveUmlPartAppearance,
} from './theme-appearance';

it('keeps ordinary classes in the classifier family while allowing individual family overrides', () => {
  const frame = createFrameCell('frame');
  const store = createCellStore(frame);
  for (const id of ['a', 'b', 'c', 'd']) {
    store.cells[id] = createUmlClassCell(id);
    frame.children.push(id);
  }
  const theme = resolveBoardTheme(undefined, 'light');
  const context = (id: string) => ({
    cell: store.cells[id],
    store,
    frameId: 'frame',
    theme,
  });
  const before = JSON.stringify(store);
  expect(
    new Set(
      ['a', 'b', 'c', 'd'].map((id) => umlThemeAppearance(context(id)).fill),
    ).size,
  ).toBe(1);
  expect(resolveUmlPartAppearance(context('b'), 'title').fill).not.toBe(
    umlThemeAppearance(context('b')).fill,
  );
  expect(JSON.stringify(store)).toBe(before);
  const edge: EdgeCell = {
    id: 'edge',
    kind: 'uml-relation',
    cellType: 'edge',
    source: { cellId: 'b' },
    target: { cellId: 'c' },
    route: { mode: 'auto' },
  };
  store.cells.edge = edge;
  frame.children.push('edge');
  store.cells.b = {
    ...createUmlClassCell('b'),
    appearance: { styleColor: 'series-5' },
  };
  expect(umlThemeAppearance(context('b')).fill).not.toBe(
    umlThemeAppearance(context('c')).fill,
  );
  expect(umlThemeAppearance(context('edge')).strokeColor).toBe(
    umlThemeAppearance(context('b')).strokeColor,
  );
});
