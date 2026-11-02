import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { createBlockText } from '@sue/board-common';
import {
  colorContrast,
  createCellStore,
  createFrameCell,
  resolveBoardTheme,
  resolveThemeRole,
  resolveThemeSeries,
  ThemeColorMode,
  type Cell,
  type CellStore,
  type EdgeCell,
  type NodeCell,
} from '@sue/board-core';
import {
  createGeometryCell,
  createSwimlaneCell,
  createTableCell,
  transposeSwimlane,
  type TableCellData,
} from '@sue/board-draw';
import {
  createFramePluginSet,
  FrameCanvas,
  resolveFrameAppearance,
  type FrameCanvasController,
} from '@sue/board-react';
import { createDrawUIPlugin } from './plugin';
import {
  drawThemeAppearance,
  drawThemeSeriesIndex,
  resolveTableEntryAppearance,
  tableEntryThemeAppearance,
} from './frame-draw-theme';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const context = (
  cell: Cell,
  theme = resolveBoardTheme(undefined, 'dark'),
  store?: CellStore,
) => ({
  cell,
  theme,
  frameId: 'frame',
  store: store ?? { rootId: 'frame', cells: { [cell.id]: cell } },
});
const shape = (outline: string) =>
  createGeometryCell(outline, outline, [[0, 0]]);
const themes = Object.values(ThemeColorMode).flatMap((mode) =>
  (['light', 'dark'] as const).map((appearance) => ({ mode, appearance })),
);
const hex = (color: string) => {
  const rgb = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return rgb
    ? '#' +
        rgb
          .slice(1, 4)
          .map((value) => Number(value).toString(16).padStart(2, '0'))
          .join('')
    : color;
};

describe('Draw role colors', () => {
  it('keeps local readable text on fixed white table cells when entering the text editor in dark appearance', async () => {
    const frame = createFrameCell('frame');
    const table = createTableCell(
      'table',
      [[0, 0]],
      2,
      2,
    ) as NodeCell<TableCellData>;
    table.appearance = {
      ...table.appearance,
      fill: '#ffffff',
      colorSources: { ...table.appearance?.colorSources, fill: 'custom' },
    };
    table.data!.cells[0].text = createBlockText('Editable cell');
    const store = createCellStore(frame);
    store.cells.table = table;
    frame.children.push(table.id);
    const container = document.createElement('div'),
      root = createRoot(container);
    document.body.append(container);
    const onChange = vi.fn();
    try {
      await act(async () =>
        root.render(
          <FrameCanvas
            value={{ store }}
            pluginSet={createFramePluginSet([createDrawUIPlugin()])}
            appearance="dark"
            onChange={onChange}
            autoFit={false}
          />,
        ),
      );
      const entry = container.querySelector(
        `[data-table-entry="${table.data!.cells[0].id}"]`,
      )!;
      expect(
        colorContrast(
          hex(
            getComputedStyle(entry.querySelector('[data-frame-rich-text] p')!)
              .color,
          ),
          '#ffffff',
        ),
      ).toBeGreaterThanOrEqual(4.5);
      await act(async () =>
        entry.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
      );
      const editor = container.querySelector('.ProseMirror p');
      expect(editor).not.toBeNull();
      expect(
        colorContrast(hex(getComputedStyle(editor!).color), '#ffffff'),
      ).toBeGreaterThanOrEqual(4.5);
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
  it.each(themes)(
    '$mode/$appearance maps structural shape families and source edges without inheriting custom colors',
    ({ mode, appearance }) => {
      const theme = resolveBoardTheme({ themeColorMode: mode }, appearance);
      const nodes = ['rectangle', 'ellipse', 'diamond', 'store'].map(shape);
      const fills = nodes.map((node, index) => {
        expect(drawThemeSeriesIndex(node)).toBe(index);
        const actual = drawThemeAppearance(context(node, theme));
        expect(actual).toEqual(resolveThemeSeries(theme, index));
        return actual!.fill;
      });
      expect(new Set(fills).size).toBe(4);
      expect(drawThemeSeriesIndex(shape('database'))).toBe(3);
      expect(drawThemeSeriesIndex(shape('decision'))).toBe(2);
      expect(drawThemeSeriesIndex(shape('cloud'))).toBe(0);
      const source = {
        ...nodes[2],
        appearance: {
          fill: '#ffffff',
          strokeColor: '#ff0000',
          colorSources: {
            fill: 'custom' as const,
            strokeColor: 'custom' as const,
          },
        },
      };
      const edge: EdgeCell = {
        id: 'edge',
        kind: 'arrow',
        cellType: 'edge',
        source: { cellId: source.id },
        target: { point: [300, 30] },
        route: { mode: 'straight' },
      };
      const store = { rootId: 'frame', cells: { [source.id]: source, edge } };
      expect(drawThemeAppearance(context(edge, theme, store))).toEqual({
        strokeColor: resolveThemeSeries(theme, 2).strokeColor,
      });
      expect(
        drawThemeAppearance(
          context({ ...edge, source: { point: [0, 0] } }, theme),
        ),
      ).toEqual({
        strokeColor: resolveThemeRole(theme, 'neutral').strokeColor,
      });
      expect(drawThemeAppearance(context(shape('text'), theme))).toMatchObject({
        fill: 'none',
        strokeColor: 'none',
      });
      expect(
        drawThemeAppearance(context({ ...nodes[0], kind: 'image' }, theme)),
      ).toBeUndefined();
      expect(
        drawThemeAppearance(context(nodes[0], resolveBoardTheme())),
      ).toBeUndefined();
    },
  );

  it.each(themes)(
    '$mode/$appearance resolves declared table headers, gentle stripes and per-entry/whole-table overrides',
    ({ mode, appearance }) => {
      const theme = resolveBoardTheme({ themeColorMode: mode }, appearance);
      const table = createTableCell(
        'table',
        [[0, 0]],
        3,
        2,
      ) as NodeCell<TableCellData>;
      const [first, , second] = table.data!.cells;
      expect(tableEntryThemeAppearance(context(table, theme), first)).toEqual(
        resolveThemeRole(theme, 'neutral', 'subtle'),
      );
      expect(tableEntryThemeAppearance(context(table, theme), second)).toEqual(
        resolveThemeRole(theme, 'neutral', 'normal'),
      );
      const header = { ...table, data: { ...table.data!, header: true } };
      expect(tableEntryThemeAppearance(context(header, theme), first)).toEqual(
        resolveThemeRole(theme, 'primary', 'normal'),
      );
      expect(tableEntryThemeAppearance(context(header, theme), second)).toEqual(
        resolveThemeRole(theme, 'primary', 'subtle'),
      );
      const fixed = {
        ...header,
        appearance: {
          ...header.appearance,
          fill: '#ffffff',
          colorSources: {
            ...header.appearance?.colorSources,
            fill: 'custom' as const,
          },
        },
      };
      const white = resolveTableEntryAppearance(context(fixed, theme), second);
      expect(white.fill).toBe('#ffffff');
      expect(
        resolveTableEntryAppearance(context(fixed, theme), {
          ...second,
          fill: undefined,
          fillSource: 'custom',
        }).fill,
      ).toBe('#ffffff');
      expect(
        colorContrast(white.textColor!, white.fill!),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        colorContrast(white.strokeColor!, white.fill!),
      ).toBeGreaterThanOrEqual(3);
      const entry = {
        ...second,
        fill: '#123456',
        fillSource: 'custom' as const,
      };
      expect(
        resolveTableEntryAppearance(context(fixed, theme), entry).fill,
      ).toBe('#123456');
      expect(
        resolveTableEntryAppearance(context(fixed, theme), {
          ...entry,
          fill: 'transparent',
          fillSource: 'theme',
        }).fill,
      ).toBe('transparent');
      const reset = {
        ...header,
        appearance: {
          ...header.appearance,
          fill: undefined,
          colorSources: {
            ...header.appearance?.colorSources,
            fill: 'theme' as const,
          },
        },
      };
      expect(
        resolveTableEntryAppearance(context(reset, theme), {
          ...entry,
          fillSource: 'theme',
        }).fill,
      ).toBe(resolveThemeRole(theme, 'primary', 'subtle').fill);
      expect(
        resolveTableEntryAppearance(context(table, resolveBoardTheme()), {
          ...second,
          fill: '#ffcc00',
        }).fill,
      ).toBe('#ffcc00');
    },
  );

  it('assigns swimlanes by axis order, excluding the whole title, with matching normal/subtle parts', () => {
    const lane = createSwimlaneCell('lane', [[0, 0]], 'horizontal', true, 8);
    const theme = resolveBoardTheme(undefined, 'dark');
    for (const table of [lane, transposeSwimlane(lane)]) {
      expect(
        tableEntryThemeAppearance(
          context(table, theme),
          table.data!.cells.find((entry) => entry.role === 'title')!,
        ),
      ).toEqual(resolveThemeRole(theme, 'primary', 'strong'));
      for (let at = 0; at < 8; at++) {
        const title = table.data!.cells.find(
          (entry) => entry.id === `lane-lane${at}`,
        )!;
        const body = table.data!.cells.find(
          (entry) => entry.id === `lane-body${at}`,
        )!;
        expect(tableEntryThemeAppearance(context(table, theme), title)).toEqual(
          resolveThemeSeries(theme, at, 'normal'),
        );
        expect(tableEntryThemeAppearance(context(table, theme), body)).toEqual(
          resolveThemeSeries(theme, at, 'subtle'),
        );
      }
    }
    const reordered = {
      ...lane,
      data: { ...lane.data!, rows: [...lane.data!.rows].reverse() },
    };
    const title = lane.data!.cells.find((entry) => entry.id === 'lane-lane0')!;
    expect(tableEntryThemeAppearance(context(reordered, theme), title)).toEqual(
      resolveThemeSeries(theme, 7, 'normal'),
    );
    const moved = {
      ...lane,
      geometry: { ...lane.geometry, x: 200, y: 500, width: 800 },
    };
    expect(tableEntryThemeAppearance(context(moved, theme), title)).toEqual(
      tableEntryThemeAppearance(context(lane, theme), title),
    );
  });

  it.each(themes)(
    '$mode/$appearance paints Rough paths, table parts and actual text using the same resolved roles',
    async ({ mode, appearance }) => {
      const frame = createFrameCell('frame');
      frame.view = { theme: { themeColorMode: mode, backgroundMode: 'theme' } };
      const store = createCellStore(frame);
      const nodes = ['rectangle', 'ellipse', 'diamond', 'store'].map(
        (outline, at) => ({
          ...shape(outline),
          geometry: { ...shape(outline).geometry, x: at * 200 },
          content: { label: outline, text: createBlockText(outline) },
        }),
      );
      const lane = createSwimlaneCell(
        'lane',
        [[0, 150]],
        'horizontal',
        true,
        3,
      );
      for (const cell of [...nodes, lane]) {
        store.cells[cell.id] = cell;
        frame.children.push(cell.id);
      }
      const pluginSet = createFramePluginSet([createDrawUIPlugin()]);
      const container = document.createElement('div'),
        root = createRoot(container),
        ref = createRef<FrameCanvasController>(),
        onChange = vi.fn();
      document.body.append(container);
      const theme = resolveBoardTheme(frame.view.theme, appearance);
      const before = JSON.stringify(store);
      try {
        for (const exporting of [false, true]) {
          await act(async () =>
            root.render(
              <FrameCanvas
                value={{ store }}
                ref={ref}
                pluginSet={pluginSet}
                appearance={appearance}
                onChange={onChange}
                autoFit={false}
                readonly={exporting}
                exporting={exporting}
              />,
            ),
          );
          for (const [index, cell] of nodes.entries()) {
            const visual = resolveFrameAppearance(
              context(cell, theme, store),
              resolveThemeSeries(theme, index),
            );
            const element = container.querySelector(
              `[data-cell-id="${cell.id}"]`,
            )!;
            expect(
              element.querySelector(
                `[data-shape-renderer="rough"] path[fill="${visual.fill}"]`,
              ),
            ).not.toBeNull();
            const text = element.querySelector('[data-frame-rich-text] p')!;
            expect(hex(getComputedStyle(text).color)).toBe(visual.textColor);
            expect(
              colorContrast(hex(getComputedStyle(text).color), visual.fill!),
            ).toBeGreaterThanOrEqual(4.5);
          }
          for (const entry of lane.data!.cells) {
            const element = container.querySelector(
              `[data-table-entry="${entry.id}"]`,
            )!;
            const visual = resolveTableEntryAppearance(
              context(lane, theme, store),
              entry,
            );
            expect(element.querySelector('rect')!.getAttribute('fill')).toBe(
              visual.fill,
            );
            expect(element.querySelector('rect')!.getAttribute('stroke')).toBe(
              visual.strokeColor,
            );
            if (entry.text)
              expect(
                colorContrast(
                  hex(
                    getComputedStyle(
                      element.querySelector('[data-frame-rich-text] p')!,
                    ).color,
                  ),
                  visual.fill!,
                ),
              ).toBeGreaterThanOrEqual(4.5);
          }
          expect(JSON.stringify(store)).toBe(before);
        }
        expect(onChange).not.toHaveBeenCalled();
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    },
  );
});
