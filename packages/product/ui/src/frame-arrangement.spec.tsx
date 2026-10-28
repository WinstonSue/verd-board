import {
  applyCellOperations,
  createCellStore,
  createFrameCell,
  groupCells,
  type CellSelection,
  type CellStore,
} from '@sue/board-core';
import { createTestCellRegistry } from '../../../../tests/fixtures/plugins/registry';
import type { FrameCanvasController } from '@sue/board-react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { FrameArrangement } from './frame-arrangement';
import { I18nProvider } from './i18n';
import { FrameRoutingButton } from './frame-routing-button';

// Layout and clipping are covered in the real-browser regression.
vi.mock('@floating-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@floating-ui/react')>();
  return { ...actual, autoUpdate: () => () => {} };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function mountRouting(
  controller: FrameCanvasController,
  language: 'en' | 'zh' = 'en',
) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  await act(async () =>
    root.render(
      <I18nProvider defaultLanguage={language} persistLanguage={false}>
        <FrameRoutingButton controller={controller} />
        <FrameRoutingButton controller={controller} />
      </I18nProvider>,
    ),
  );
  return {
    triggers: () =>
      container.querySelectorAll<HTMLButtonElement>('[aria-haspopup="menu"]'),
    mains: () =>
      container.querySelectorAll<HTMLButtonElement>(
        '[data-testid="frame-reroute-edges"]',
      ),
    choices: () =>
      document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    open: async (index = 0) =>
      act(async () => {
        container
          .querySelectorAll<HTMLButtonElement>('[aria-haspopup="menu"]')
          [index].click();
      }),
  };
}

it.each(['en', 'zh'] as const)(
  'executes menu choices once and shares the selected mode across surfaces in %s',
  async (language) => {
    const executeAction = vi.fn().mockResolvedValue({ status: 'completed' });
    const controller = {
      executeAction,
      getActionState: () => ({ enabled: true }),
    } as unknown as FrameCanvasController;
    const test = await mountRouting(controller, language);
    await test.open();
    expect(executeAction).not.toHaveBeenCalled();
    expect(test.choices()[0].textContent).toContain(
      language === 'zh' ? '保存为可编辑折线' : 'save editable paths',
    );
    expect(test.choices()[1].textContent).toContain(
      language === 'zh' ? '恢复普通自动走线' : 'restore automatic routing',
    );
    await act(async () => test.choices()[1].click());
    expect(executeAction).toHaveBeenCalledExactlyOnceWith(
      'canvas.edges.reroute',
    );
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(
      [...test.mains()].every(
        (button) => button.dataset['routingMode'] === 'reset',
      ),
    ).toBe(true);
    expect(document.activeElement).toBe(test.triggers()[0]);
    await test.open(1);
    expect(test.choices()[1].getAttribute('aria-checked')).toBe('true');
    await act(async () => test.choices()[1].click());
    expect(executeAction).toHaveBeenCalledTimes(2);
    await act(async () => test.mains()[0].click());
    expect(executeAction).toHaveBeenCalledTimes(3);
    expect(executeAction).toHaveBeenLastCalledWith('canvas.edges.reroute');
  },
);

it('keeps unavailable choices focusable without switching, and checks the latest availability', async () => {
  const executeAction = vi.fn();
  let canReset = true;
  const controller = {
    executeAction,
    getActionState: (id: string) => ({
      enabled: id === 'canvas.edges.reroute' && canReset,
      reason: 'no manual paths',
    }),
  } as unknown as FrameCanvasController;
  const test = await mountRouting(controller);
  expect(test.mains()[0].disabled).toBe(true);
  await test.open();
  expect(test.choices()[0].getAttribute('aria-disabled')).toBe('true');
  await act(async () => {
    test.choices()[0].focus();
    test.choices()[0].click();
  });
  expect(document.activeElement).toBe(test.choices()[0]);
  expect(executeAction).not.toHaveBeenCalled();
  expect(test.mains()[0].dataset['routingMode']).toBe('optimize');
  canReset = false;
  await act(async () => test.choices()[1].click());
  expect(executeAction).not.toHaveBeenCalled();
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  expect(test.mains()[0].dataset['routingMode']).toBe('optimize');
});

it('blocks repeated execution across surfaces while pending and retains the chosen mode after rejection', async () => {
  let resolve!: (result: { status: 'rejected'; message: string }) => void;
  const executeAction = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const controller = {
    executeAction,
    getActionState: () => ({ enabled: true }),
  } as unknown as FrameCanvasController;
  const test = await mountRouting(controller);
  await test.open();
  await act(async () => test.choices()[1].click());
  expect(
    [...test.mains()].every(
      (button) => button.disabled && button.dataset['routingMode'] === 'reset',
    ),
  ).toBe(true);
  await test.open(1);
  expect(
    [...test.choices()].every(
      (choice) => choice.getAttribute('aria-disabled') === 'true',
    ),
  ).toBe(true);
  await act(async () => {
    test.choices()[0].click();
    test.mains()[0].click();
  });
  expect(executeAction).toHaveBeenCalledTimes(1);
  await act(async () =>
    resolve({ status: 'rejected', message: 'Host refused' }),
  );
  expect(
    [...test.mains()].every(
      (button) => !button.disabled && button.dataset['routingMode'] === 'reset',
    ),
  ).toBe(true);
});

it('supports keyboard navigation, dismissal and restoring trigger focus', async () => {
  const controller = {
    executeAction: vi.fn(),
    getActionState: () => ({ enabled: false, reason: 'readonly' }),
  } as unknown as FrameCanvasController;
  const test = await mountRouting(controller);
  const key = async (
    value: string,
    target: Element | null = document.activeElement,
  ) =>
    act(async () => {
      target?.dispatchEvent(
        new KeyboardEvent('keydown', { key: value, bubbles: true }),
      );
    });
  await key('ArrowDown', test.triggers()[0]);
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
  expect(test.choices()).toHaveLength(2);
  await key('End', document.querySelector('[role="menu"]'));
  expect(document.activeElement).toBe(test.choices()[1]);
  await key('ArrowDown');
  expect(document.activeElement).toBe(test.choices()[0]);
  await key('ArrowUp');
  expect(document.activeElement).toBe(test.choices()[1]);
  await key('Home');
  expect(document.activeElement).toBe(test.choices()[0]);
  await key('Escape');
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(test.triggers()[0]);
  await test.open();
  await key('Tab', document.querySelector('[role="menu"]'));
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it('separates node layout from routing, shows group scope and explains conflicts in both languages', async () => {
  const registry = createTestCellRegistry();
  let store = applyCellOperations(
    createCellStore(createFrameCell('root')),
    ['a', 'b'].map((id, i) => ({
      type: 'insert_cell' as const,
      parentId: 'root',
      cell: {
        id,
        cellType: 'node' as const,
        kind: 'geometry',
        geometry: { x: i * 200, y: 0, width: 40, height: 20 },
      },
    })),
    registry,
  );
  store = applyCellOperations(
    store,
    groupCells(store, 'root', ['a', 'b'], 'g', registry),
    registry,
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const executeAction = vi.fn();
  let conflict = false;
  const controller = {
    executeAction,
    getActionState: (id: string) => ({
      enabled: !(conflict && id === 'canvas.layout.grid'),
      reason:
        conflict && id === 'canvas.layout.grid' ? 'layout-overlap' : undefined,
    }),
  } as unknown as FrameCanvasController;
  const render = (language: 'zh' | 'en', selection: CellSelection) =>
    act(async () =>
      root.render(
        <I18nProvider
          key={language}
          defaultLanguage={language}
          persistLanguage={false}
        >
          <FrameArrangement
            store={store}
            controller={controller}
            selection={selection}
          />
        </I18nProvider>,
      ),
    );
  await render('zh', { focus: ['root'], ids: ['g'] });
  const layout = () =>
    container.querySelector<HTMLButtonElement>(
      '[data-testid="frame-auto-layout"]',
    )!;
  const reroute = () =>
    container.querySelector<HTMLButtonElement>(
      '[data-testid="frame-reroute-edges"]',
    )!;
  expect(layout().textContent).toBe('布局组内节点');
  expect(reroute().textContent).toBe('优化全部连线');
  expect(
    container.querySelector('option[value="relationships"]')?.textContent,
  ).toBe('按连接关系');
  expect(
    container.querySelector('[data-testid="frame-arrangement-scope"]')
      ?.textContent,
  ).toContain('Group 内部');
  await act(async () => layout().click());
  expect(executeAction).toHaveBeenLastCalledWith('canvas.layout.grid');
  await act(async () => reroute().click());
  expect(executeAction).toHaveBeenLastCalledWith('canvas.edges.optimize');
  conflict = true;
  await render('en', { focus: ['root', 'g'], ids: [] });
  expect(layout().textContent).toBe('Layout group contents');
  expect(layout().disabled).toBe(true);
  expect(layout().hasAttribute('title')).toBe(false);
  expect(reroute().disabled).toBe(false);
  expect(
    container.querySelector('[data-testid="frame-arrangement-scope"]')
      ?.textContent,
  ).toContain('Nothing was changed');
  conflict = false;
  await render('en', { focus: ['root', 'g'], ids: ['a', 'b'] });
  expect(layout().textContent).toBe('Layout nodes');
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
  const executeAction = vi.fn();
  const controller = {
    executeAction,
    getActionState: () => ({ enabled: true }),
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
  expect(executeAction).not.toHaveBeenCalled();
  await apply();
  expect(executeAction).toHaveBeenLastCalledWith('canvas.layout.layers');
  await act(async () => {
    select().value = 'grid';
    select().dispatchEvent(new Event('change', { bubbles: true }));
  });
  await render('architecture');
  expect(select().value).toBe('grid');
  await apply();
  expect(executeAction).toHaveBeenLastCalledWith('canvas.layout.grid');
  await render('workflow');
  expect(select().value).toBe('flow');
  await apply();
  expect(executeAction).toHaveBeenLastCalledWith('canvas.layout.flow');
  await render('drawing');
  expect(select().value).toBe('grid');
  await render('mind');
  expect(
    container.querySelector('[data-testid="frame-arrangement"]'),
  ).toBeNull();
});
