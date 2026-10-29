import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import {
  applyCellOperations,
  colorContrast,
  isFrameCell,
  isNodeCell,
  resolveBoardTheme,
  ThemeColorMode,
  type FrameSnapshot,
} from '@sue/board-core';
import {
  addUmlCell,
  addUmlActivation,
  createUmlNoteCell,
} from '../../../engine/uml/src/public-api';
import { createTestFramePluginSet } from '../../../../tests/fixtures/plugins/ui';
import { FrameCanvas, type FrameCanvasController } from './frame-canvas';
import type { TableCellData } from '../../../engine/draw/src/cell-commands';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it.each([
  'mind-map',
  'workflow-process',
  'architecture',
  'uml-class',
  'uml-sequence',
  'whiteboard-advanced',
])(
  '%s resolves unmarked colors consistently in the actual scene and controller for all themes',
  async (fixture) => {
    const file = JSON.parse(
      readFileSync(
        path.resolve(
          process.cwd(),
          `../../../tests/fixtures/ai-canvas/${fixture}.verd.json`,
        ),
        'utf8',
      ),
    );
    const pluginSet = createTestFramePluginSet();
    let store: FrameSnapshot['store'] = {
      rootId: file.frame.id,
      cells: { ...file.cells, [file.frame.id]: file.frame },
    };
    if (fixture === 'uml-sequence') {
      const participants = Object.values(store.cells).filter(
        (cell) => cell.kind === 'uml-participant',
      );
      const actor = participants[0];
      if (isNodeCell(actor))
        actor.data = { ...(actor.data as object), actorType: 'actor' };
      store = applyCellOperations(
        store,
        addUmlCell(
          store,
          store.rootId,
          createUmlNoteCell(
            'theme-note',
            participants.map((cell) => cell.id),
          ),
        ),
        pluginSet.registry,
      );
      let n = 0;
      store = applyCellOperations(
        store,
        addUmlActivation(
          store,
          store.rootId,
          participants[1].id,
          0,
          1,
          () => `theme-activation-${n++}`,
        ),
        pluginSet.registry,
      );
    }
    // Arbitrary old colors must be ignored even when they are not factory defaults.
    for (const cell of Object.values(store.cells)) {
      if (isNodeCell(cell) && !isFrameCell(cell))
        cell.appearance = {
          ...cell.appearance,
          fill: '#ff00ff',
          strokeColor: '#00ff00',
        };
      else if (cell.cellType === 'edge')
        cell.appearance = { ...cell.appearance, strokeColor: '#00ff00' };
      if (isNodeCell(cell) && ['table', 'swimlane'].includes(cell.kind)) {
        const entries = (cell.data as TableCellData).cells;
        for (const entry of entries) {
          entry.fill = '#ff00ff';
          delete entry.fillSource;
        }
        entries[0].fill = '#ffffff';
        entries[0].fillSource = 'custom';
        entries[1].fill = 'transparent';
      }
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container),
      ref = createRef<FrameCanvasController>(),
      onChange = vi.fn();
    try {
      for (const mode of Object.values(ThemeColorMode)) {
        const frame = store.cells[store.rootId];
        if (!isFrameCell(frame)) throw new Error('Missing frame');
        const value = {
          store: {
            ...store,
            cells: {
              ...store.cells,
              [frame.id]: {
                ...frame,
                view: {
                  ...frame.view,
                  theme: {
                    themeColorMode: mode,
                    backgroundMode: 'theme' as const,
                  },
                },
              },
            },
          },
        };
        const bytes = JSON.stringify(value);
        for (const appearance of ['light', 'dark'] as const) {
          const theme = resolveBoardTheme({ themeColorMode: mode }, appearance);
          await act(async () =>
            root.render(
              <FrameCanvas
                value={value}
                pluginSet={pluginSet}
                ref={ref}
                appearance={appearance}
                onChange={onChange}
                autoFit={false}
              />,
            ),
          );
          expect(
            container.querySelectorAll('[data-cell-id]').length,
          ).toBeGreaterThan(0);
          expect(
            container.querySelector('[fill="#ff00ff"], [stroke="#00ff00"]'),
          ).toBeNull();
          for (const table of Object.values(value.store.cells)) {
            if (
              !isNodeCell(table) ||
              !['table', 'swimlane'].includes(table.kind)
            )
              continue;
            for (const entry of (table.data as TableCellData).cells) {
              const rect = container.querySelector(
                `[data-table-entry="${entry.id}"] > rect`,
              );
              if (!rect) continue; // Swimlane body cells intentionally have no individual paint.
              const expected =
                entry.fillSource === 'custom' || entry.fill === 'transparent'
                  ? entry.fill
                  : entry.role && entry.role !== 'body'
                    ? theme.header
                    : theme.surface;
              expect(rect.getAttribute('fill')).toBe(expected);
            }
          }
          for (const element of container.querySelectorAll<SVGGElement>(
            '[data-cell-id][data-cell-kind]',
          )) {
            const id = element.getAttribute('data-cell-id')!;
            const cell = value.store.cells[id];
            if (
              !cell ||
              ![
                'uml-class',
                'uml-note',
                'uml-fragment',
                'uml-participant',
                'workflow-task',
                'workflow-decision',
                'architecture-module',
              ].includes(cell.kind)
            )
              continue;
            const visual = ref.current!.resolveAppearance(id)!;
            const outline = element.querySelector(
              '[data-uml-class] rect, [data-uml-note], [data-uml-fragment], [data-uml-lifeline] > rect',
            );
            expect((outline ?? element).getAttribute('fill')).toBe(visual.fill);
            const background =
              visual.fill === 'none' || visual.fill === 'transparent'
                ? theme.background
                : visual.fill!;
            expect(
              colorContrast(visual.strokeColor!, background),
            ).toBeGreaterThanOrEqual(3);
            if (cell.kind === 'uml-note') expect(visual.fill).toBe(theme.note);
            for (const text of element.querySelectorAll('text[fill]')) {
              const color = text.getAttribute('fill');
              if (color && color !== 'none')
                expect(colorContrast(color, background)).toBeGreaterThanOrEqual(
                  4.5,
                );
            }
          }
          expect(JSON.stringify(value)).toBe(bytes);
        }
      }
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);
