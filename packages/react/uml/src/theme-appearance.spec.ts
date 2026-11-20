import { expect, it } from 'vitest';
import {
  createCellStore,
  createFrameCell,
  resolveBoardTheme,
  resolveThemeSeries,
  ThemeColorMode,
  type BoardStyleColor,
  type EdgeCell,
  type NodeCell,
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

it('shares note and fragment families with their edges while retaining structural transparency', () => {
  const frame = createFrameCell('frame');
  const store = createCellStore(frame);
  for (const [kind, operator, index] of [
    ['uml-note', undefined, 2],
    ['uml-fragment', 'alt', 2],
    ['uml-fragment', 'opt', 1],
    ['uml-fragment', 'loop', 0],
  ] as const) {
    const node: NodeCell = {
      id: 'source',
      kind,
      cellType: 'node',
      geometry: { x: 0, y: 0, width: 200, height: 120 },
      data: { operator },
    };
    const edge: EdgeCell = {
      id: 'edge',
      kind: 'uml-relation',
      cellType: 'edge',
      source: { cellId: node.id },
      target: { point: [400, 0] },
      route: { mode: 'auto' },
    };
    Object.assign(store.cells, { source: node, edge });
    frame.children = [node.id, edge.id];
    for (const themeColorMode of Object.values(ThemeColorMode))
      for (const appearance of ['light', 'dark'] as const) {
        const theme = resolveBoardTheme({ themeColorMode }, appearance);
        const context = (id: string) => ({
          cell: store.cells[id],
          store,
          frameId: frame.id,
          theme,
        });
        const before = JSON.stringify(store);
        const automatic = umlThemeAppearance(context(node.id));
        expect(automatic.styleFamily).toBe(`series-${index + 1}`);
        expect(automatic.fill).toBe(
          kind === 'uml-fragment'
            ? 'none'
            : resolveThemeSeries(theme, index, 'node', 'overlay').fill,
        );
        expect(umlThemeAppearance(context(edge.id))).toMatchObject({
          styleFamily: automatic.styleFamily,
          strokeColor: resolveThemeSeries(theme, index, 'node', 'overlay')
            .strokeColor,
          fill: 'none',
        });
        expect(JSON.stringify(store)).toBe(before);
        node.appearance = {
          styleColor: `series-${index + 1}` as BoardStyleColor,
        };
        expect(umlThemeAppearance(context(node.id))).toMatchObject(automatic);
        node.appearance = {
          styleColor: 'series-5',
          strokeColor: '#ff0000',
          colorSources: { strokeColor: 'custom' },
        };
        expect(umlThemeAppearance(context(edge.id))).toMatchObject({
          styleFamily: 'series-5',
          strokeColor: resolveThemeSeries(theme, 4, 'node', 'overlay')
            .strokeColor,
        });
        delete node.appearance;
        expect(umlThemeAppearance(context(node.id))).toMatchObject(automatic);
        expect(
          umlThemeAppearance({
            ...context(edge.id),
            cell: { ...edge, source: { point: [0, 0] } },
          }),
        ).toMatchObject({ styleFamily: 'series-1' });
      }
  }
});
