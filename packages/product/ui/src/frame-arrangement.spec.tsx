import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createCellStore,
  createFrameCell,
  type CellStore,
} from '@sue/board-core';
import type { FrameCanvasController } from '@sue/board-react';
import { FrameArrangement } from './frame-arrangement';
import { I18nProvider } from './i18n';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it('defaults to the focused scene layout, honors an explicit choice and only applies on demand', async () => {
  const store: CellStore = createCellStore(createFrameCell('root'));
  for (const [id, kind] of [
    ['architecture', 'architecture-layer'],
    ['workflow', 'workflow-start'],
    ['drawing', 'geometry'],
    ['mind', 'mind-root'],
  ]) {
    store.cells[id] = { ...createFrameCell(id), children: [`${id}-node`] };
    store.cells[`${id}-node`] = {
      id: `${id}-node`,
      cellType: 'node',
      kind,
      geometry: { x: 0, y: 0, width: 80, height: 40 },
    };
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const executeSelectionCommand = vi.fn();
  const controller = {
    executeSelectionCommand,
    selectionCommandState: () => ({ enabled: true }),
  } as unknown as FrameCanvasController;
  const render = (frameId: string) =>
    act(async () =>
      root.render(
        <I18nProvider defaultLanguage="en" persistLanguage={false}>
          <FrameArrangement
            store={store}
            controller={controller}
            selection={{ focus: ['root', frameId], ids: [] }}
          />
        </I18nProvider>,
      ),
    );
  const select = () => container.querySelector('select')!;
  const apply = () =>
    act(async () => {
      (
        container.querySelector(
          '[data-testid="frame-auto-layout"]',
        ) as HTMLButtonElement
      ).click();
    });
  await render('architecture');
  expect(select().value).toBe('layers');
  expect(executeSelectionCommand).not.toHaveBeenCalled();
  await apply();
  expect(executeSelectionCommand).toHaveBeenLastCalledWith({
    type: 'layout',
    style: 'layers',
  });
  await act(async () => {
    select().value = 'grid';
    select().dispatchEvent(new Event('change', { bubbles: true }));
  });
  await render('architecture');
  expect(select().value).toBe('grid');
  await apply();
  expect(executeSelectionCommand).toHaveBeenLastCalledWith({
    type: 'layout',
    style: 'grid',
  });
  await render('workflow');
  expect(select().value).toBe('flow');
  await apply();
  expect(executeSelectionCommand).toHaveBeenLastCalledWith({
    type: 'layout',
    style: 'flow',
  });
  await render('drawing');
  expect(select().value).toBe('grid');
  await render('mind');
  expect(
    container.querySelector('[data-testid="frame-arrangement"]'),
  ).toBeNull();
});
