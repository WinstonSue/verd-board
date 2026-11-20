import {
  createArchitectureLayerCell,
  createArchitectureModuleCell,
  createArchitecturePlugin,
} from '@sue/board-architecture';
import {
  createCellRegistry,
  colorContrast,
  compositeThemeFill,
  createFrameCell,
  resolveBoardTheme,
  resolveThemeSeries,
  ThemeColorMode,
  type CellStore,
  type EdgeCell,
} from '@sue/board-core';
import { resolveFrameCellAppearance } from '@sue/board-react';
import { expect, it } from 'vitest';
import { createArchitectureFrameExtensions } from './frame-extension';

it('colors layers and members in structural order and recomputes only for new snapshots', () => {
  const registry = createCellRegistry({
    plugins: [createArchitecturePlugin()],
  });
  const extensions = createArchitectureFrameExtensions(registry);
  const frame = createFrameCell('frame');
  const layers = Array.from({ length: 7 }, (_, i) => {
    const layer = createArchitectureLayerCell(`layer-${i}`, String(i));
    layer.data!.memberIds = [`module-${i}`];
    return layer;
  });
  const modules = layers.map((_, i) =>
    createArchitectureModuleCell(`module-${i}`),
  );
  modules[0].appearance = {
    fill: '#ffffff',
    strokeColor: '#aabbcc',
    colorSources: { fill: 'custom', strokeColor: 'custom' },
  };
  const edge: EdgeCell = {
    id: 'edge',
    kind: 'architecture-edge',
    cellType: 'edge',
    source: { cellId: modules[0].id },
    target: { cellId: modules[1].id },
    route: { mode: 'auto' },
  };
  frame.children = [...layers, ...modules, edge].map((cell) => cell.id);
  const store: CellStore = {
    rootId: frame.id,
    cells: Object.fromEntries(
      [frame, ...layers, ...modules, edge].map((cell) => [cell.id, cell]),
    ),
  };
  const original = JSON.stringify(store);
  for (const mode of Object.values(ThemeColorMode)) {
    for (const appearance of ['light', 'dark'] as const) {
      const theme = resolveBoardTheme({ themeColorMode: mode }, appearance);
      const visual = (snapshot: CellStore, id: string) =>
        resolveFrameCellAppearance(
          {
            cell: snapshot.cells[id],
            store: snapshot,
            frameId: frame.id,
            theme,
          },
          extensions,
        );
      layers.forEach((layer, i) => {
        expect(visual(store, layer.id)).toMatchObject(
          resolveThemeSeries(theme, i, 'subtle'),
        );
        if (i > 0) {
          const module = visual(store, modules[i].id);
          expect(module).toMatchObject({
            fill: resolveThemeSeries(theme, i, 'node', 'overlay').fill,
            styleLevel: 'node',
            styleFamily: `series-${(i % 6) + 1}`,
          });
          const fill = compositeThemeFill(
            module.fill!,
            visual(store, layer.id).fill!,
          );
          expect(colorContrast(fill, module.textColor!)).toBeGreaterThanOrEqual(
            4.5,
          );
          expect(
            colorContrast(fill, module.strokeColor!),
          ).toBeGreaterThanOrEqual(3);
        }
      });
      expect(visual(store, modules[0].id)).toMatchObject({
        fill: '#ffffff',
        strokeColor: '#aabbcc',
      });
      expect(visual(store, edge.id).strokeColor).toBe(
        resolveThemeSeries(theme, 0).strokeColor,
      );
      expect(visual(store, layers[0].id).fill).toBe(
        visual(store, layers[6].id).fill,
      );
      const reordered: CellStore = {
        ...store,
        cells: {
          ...store.cells,
          [layers[0].id]: {
            ...layers[0],
            data: { ...layers[0].data!, order: '9' },
          },
        },
      };
      expect(visual(reordered, layers[1].id).fill).toBe(
        resolveThemeSeries(theme, 0, 'subtle').fill,
      );
      expect(visual(reordered, modules[1].id).fill).toBe(
        resolveThemeSeries(theme, 0, 'node', 'overlay').fill,
      );
      const moved = {
        ...store,
        cells: {
          ...store.cells,
          [modules[1].id]: {
            ...modules[1],
            geometry: { ...modules[1].geometry, x: 999, y: 999 },
          },
        },
      };
      expect(visual(moved, modules[1].id)).toEqual(
        visual(store, modules[1].id),
      );
    }
  }
  expect(JSON.stringify(store)).toBe(original);
});

it('uses the first family for unlayered modules and their edges without persisting automatic choices', () => {
  const extensions = createArchitectureFrameExtensions(
    createCellRegistry({ plugins: [createArchitecturePlugin()] }),
  );
  const frame = createFrameCell('frame');
  const module = createArchitectureModuleCell('module');
  const edge: EdgeCell = {
    id: 'edge',
    kind: 'architecture-edge',
    cellType: 'edge',
    source: { cellId: module.id },
    target: { point: [400, 40] },
    route: { mode: 'auto' },
  };
  const store: CellStore = {
    rootId: frame.id,
    cells: { frame, module, edge },
  };
  frame.children = [module.id, edge.id];
  for (const themeColorMode of Object.values(ThemeColorMode))
    for (const appearance of ['light', 'dark'] as const) {
      const theme = resolveBoardTheme({ themeColorMode }, appearance);
      const visual = (id: string) =>
        resolveFrameCellAppearance(
          { cell: store.cells[id], store, frameId: frame.id, theme },
          extensions,
        );
      const before = JSON.stringify(store);
      const automatic = visual(module.id);
      expect(automatic).toMatchObject({
        ...resolveThemeSeries(theme, 0, 'node', 'overlay'),
        styleFamily: 'series-1',
      });
      expect(JSON.stringify(store)).toBe(before);
      module.appearance = { styleColor: 'series-1' };
      expect(visual(module.id)).toMatchObject(automatic);
      module.appearance = { styleColor: 'series-6' };
      expect(visual(edge.id)).toMatchObject({
        styleFamily: 'series-6',
        strokeColor: resolveThemeSeries(theme, 5, 'node', 'overlay')
          .strokeColor,
      });
      delete module.appearance;
      expect(visual(module.id)).toMatchObject(automatic);
      expect(visual(edge.id)).toMatchObject({ styleFamily: 'series-1' });
    }
});
