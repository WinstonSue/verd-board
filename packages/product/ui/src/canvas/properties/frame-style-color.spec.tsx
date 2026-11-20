import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import {
  createCellStore,
  createFrameCell,
  type NodeCell,
  resolveBoardTheme,
  resolveThemeSeries,
} from '@sue/board-core';
import type { FrameCanvasController } from '@sue/board-react';
import { I18nProvider } from '../../i18n';
import { FrameSelectionAppearance } from './frame-selection-appearance';
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('updates theme swatches without changing the selected family or dispatching node writes', async () => {
  const frame = createFrameCell('f');
  const store = createCellStore(frame);
  const node: NodeCell = {
    id: 'n',
    kind: 'geometry',
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 100, height: 60 },
    appearance: { styleColor: 'series-5' },
  };
  store.cells.n = node;
  frame.children = ['n'];
  const before = JSON.stringify(node);
  const dispatch = vi.fn();
  const controller = {
    resolveAppearance: () => ({ styleFamily: 'series-5' }),
  } as unknown as FrameCanvasController;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    const colors = [];
    for (const appearance of ['light', 'dark'] as const)
      for (const themeColorMode of [
        'default',
        'colorful',
        'soft',
        'retro',
        'dark',
      ] as const) {
        const next = {
          ...store,
          cells: {
            ...store.cells,
            f: { ...frame, view: { theme: { themeColorMode } } },
          },
        };
        await act(async () =>
          root.render(
            <I18nProvider language="en">
              <FrameSelectionAppearance
                store={next}
                ids={['n']}
                dispatch={dispatch}
                single
                controller={controller}
                appearance={appearance}
              />
            </I18nProvider>,
          ),
        );
        const swatches = [
          ...container.querySelectorAll<HTMLButtonElement>(
            '.frame-style-colors button[aria-label]',
          ),
        ];
        expect(swatches).toHaveLength(6);
        expect(
          swatches
            .filter((button) => button.getAttribute('aria-pressed') === 'true')
            .map((button) => button.getAttribute('aria-label')),
        ).toEqual(['Style color 5']);
        colors.push(swatches.map((button) => button.style.backgroundColor));
      }
    expect(new Set(colors.map((row) => JSON.stringify(row))).size).toBe(10);
    expect(dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(node)).toBe(before);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it.each(['en', 'zh'] as const)(
  'edits mixed node families in one transaction and preserves custom colors in %s',
  async (language) => {
    const frame = createFrameCell('f');
    const store = createCellStore(frame);
    for (const [index, id] of ['a', 'b'].entries()) {
      const node: NodeCell = {
        id,
        kind: 'geometry',
        cellType: 'node',
        geometry: { x: index * 120, y: 0, width: 100, height: 60 },
        appearance: {
          styleColor: index ? 'series-2' : 'series-1',
          fill: '#ffffff',
          colorSources: { fill: 'custom' },
        },
      };
      store.cells[id] = node;
      frame.children.push(id);
    }
    const controller = {
      resolveAppearance: () => ({ styleFamily: 'series-1', fill: '#ffffff' }),
    } as unknown as FrameCanvasController;
    const dispatch = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <I18nProvider language={language}>
            <FrameSelectionAppearance
              store={store}
              ids={['a', 'b']}
              dispatch={dispatch}
              single={false}
              controller={controller}
              appearance="light"
            />
          </I18nProvider>,
        ),
      );
      expect(
        container.querySelector('.frame-style-colors')?.textContent,
      ).toContain(language === 'en' ? 'Mixed values' : '混合值');
      expect(
        container.querySelectorAll(
          '.frame-style-colors button[aria-pressed="true"]',
        ),
      ).toHaveLength(0);
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            `[aria-label="${language === 'en' ? 'Style color 3' : '风格色 3'}"]`,
          )!
          .click(),
      );
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0][0]).toHaveLength(2);
      for (const op of dispatch.mock.calls[0][0])
        expect(op.cell.appearance).toMatchObject({
          styleColor: 'series-3',
          fill: '#ffffff',
          colorSources: { fill: 'custom' },
        });
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>('.frame-style-colors button')!
          .click(),
      );
      for (const operation of dispatch.mock.calls[1][0]) {
        expect(operation.cell.appearance.styleColor).toBeUndefined();
        const original = store.cells[operation.cell.id] as NodeCell;
        expect(operation.cell).toEqual({
          ...original,
          appearance: { ...original.appearance, styleColor: undefined },
        });
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);

it('uses the explicit Mind theme for swatches while keeping the saved family selected', async () => {
  const frame = createFrameCell('f');
  frame.view = {
    theme: { themeColorMode: 'retro' },
    mind: { colorScheme: 'soft' },
  };
  frame.children = ['n'];
  const store = createCellStore(frame);
  store.cells.n = {
    id: 'n',
    kind: 'mind-child',
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 100, height: 50 },
    appearance: { styleColor: 'series-5' },
  };
  const controller = {
    resolveAppearance: () => ({ styleFamily: 'series-5' }),
  } as unknown as FrameCanvasController;
  const dispatch = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <I18nProvider language="en">
          <FrameSelectionAppearance
            store={store}
            ids={['n']}
            dispatch={dispatch}
            single
            controller={controller}
            appearance="dark"
          />
        </I18nProvider>,
      ),
    );
    const selected = container.querySelector<HTMLButtonElement>(
      '[aria-label="Style color 5"]',
    )!;
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    const tone = resolveThemeSeries(
      resolveBoardTheme(
        {
          themeColorMode: 'soft' as never,
          backgroundMode: 'custom',
          boardBackground: resolveBoardTheme(frame.view.theme, 'dark').canvas,
        },
        'dark',
      ),
      4,
    );
    const expected = document.createElement('button');
    expected.style.backgroundColor = tone.fill;
    expect(selected.style.backgroundColor).toBe(expected.style.backgroundColor);
    expect(dispatch).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
