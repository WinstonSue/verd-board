import { createActionRegistry, type ActionResult } from '@sue/board-common';
import { createCellStore, createFrameCell } from '@sue/board-core';
import type { FrameCanvasController } from '@sue/board-react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestCellRegistry } from '../../../../../../tests/fixtures/plugins/registry';
import { FrameActionsPopover } from './frame-actions-popover';
import { I18nProvider } from '../../i18n';

vi.mock('@floating-ui/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@floating-ui/react')>()),
  autoUpdate: () => () => {},
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function mount(
  language: 'zh' | 'en' = 'en',
  empty = false,
  onAgentSelection?: (fileId: string, cellIds: string[]) => void,
) {
  const store = createCellStore(createFrameCell('root'));
  store.cells['a'] = {
    id: 'a',
    kind: 'geometry',
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 100, height: 50 },
  };
  const selection = { focus: ['root'], ids: empty ? [] : ['a'] };
  const runtime = {
    store,
    selection: structuredClone(selection),
    registry: createTestCellRegistry(),
  };
  const execute = vi
    .fn<() => Promise<ActionResult>>()
    .mockResolvedValue({ status: 'completed' });
  const context = {};
  const source = createActionRegistry({
    getContext: () => context,
    refresh: () => context,
  });
  for (const [id, zh, en, enabled] of [
    ['canvas.clipboard.cut', '剪切', 'Cut', true],
    ['canvas.clipboard.copy', '复制', 'Copy', true],
    ['canvas.clipboard.paste', '粘贴', 'Paste', true],
    ['canvas.selection.duplicate', '复制副本', 'Duplicate', true],
    ['canvas.selection.group', '组合', 'Group', false],
    ['canvas.selection.lock', '锁定', 'Lock', true],
    ['canvas.selection.unlock', '解锁', 'Unlock', false],
    ['canvas.selection.delete', '删除', 'Delete', true],
    ['canvas.selection.all', '全选当前容器', 'Select all', true],
    ['canvas.view.fit', '适配画布', 'Fit canvas', true],
    ['canvas.link.copy', '复制对象链接', 'Copy object link', false],
  ] as const)
    source.register({
      id,
      label: { zh, en },
      category: 'canvas',
      effect: 'content',
      getState: () => ({ enabled }),
      execute,
    });
  source.seal();
  const actionContext = { fileId: 'canvas' };
  const controller = {
    runtime,
    actions: source.actions,
    actionSource: source,
    getActionContext: () => actionContext,
  } as unknown as FrameCanvasController;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const onFailure = vi.fn();
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      <I18nProvider language={language} persistLanguage={false}>
        <FrameActionsPopover
          point={[20, 30]}
          store={store}
          selection={selection}
          controller={controller}
          onClose={onClose}
          onFailure={onFailure}
          onAgentSelection={onAgentSelection}
        />
      </I18nProvider>,
    ),
  );
  return {
    runtime,
    actionContext,
    execute,
    onFailure,
    onClose,
    menu: document.querySelector<HTMLElement>('[role="menu"]')!,
  };
}

it.each(['zh', 'en'] as const)(
  'renders contextual commands without property controls in %s',
  async (language) => {
    const test = await mount(language);
    expect(test.menu.getAttribute('aria-label')).toBe(
      language === 'zh' ? '画布编辑' : 'Canvas editing',
    );
    expect(
      test.menu.querySelector('input, select, textarea, [role="checkbox"]'),
    ).toBeNull();
    expect(
      test.menu.querySelector('[data-action-id="canvas.selection.duplicate"]'),
    ).not.toBeNull();
    expect(
      test.menu.querySelector('[data-action-id="canvas.selection.lock"]'),
    ).not.toBeNull();
    expect(
      test.menu.querySelector('[data-action-id="canvas.selection.unlock"]'),
    ).toBeNull();
    expect(
      test.menu.querySelector('[data-action-id="canvas.selection.group"]'),
    ).toBeNull();
    expect(
      test.menu.querySelector('[data-action-id="canvas.link.copy"]'),
    ).toBeNull();
    expect(test.menu.lastElementChild?.getAttribute('data-danger')).toBe(
      'true',
    );
  },
);

it('limits an empty selection to paste, select all and fit canvas', async () => {
  const test = await mount('en', true);
  expect(
    [...test.menu.querySelectorAll('[data-action-id]')].map((item) =>
      item.getAttribute('data-action-id'),
    ),
  ).toEqual([
    'canvas.clipboard.paste',
    'canvas.selection.all',
    'canvas.view.fit',
  ]);
});

it('refuses a stale selection and reports rejected Actions', async () => {
  const test = await mount();
  const copy = test.menu.querySelector<HTMLButtonElement>(
    '[data-action-id="canvas.clipboard.copy"]',
  )!;
  test.runtime.selection.ids = [];
  await act(async () => copy.click());
  expect(test.execute).not.toHaveBeenCalled();
  test.runtime.selection.ids = ['a'];
  test.execute.mockResolvedValueOnce({
    status: 'rejected',
    code: 'edit-rejected',
    message: 'Host denied',
  });
  await act(async () => copy.click());
  expect(test.execute).toHaveBeenCalledTimes(1);
  expect(test.onFailure).toHaveBeenCalledExactlyOnceWith('Host denied');
  expect(test.onClose).toHaveBeenCalledTimes(2);
});

it('passes only the current canvas selection to Codex', async () => {
  const onAgentSelection = vi.fn();
  const test = await mount('en', false, onAgentSelection);
  const command = test.menu.querySelector<HTMLButtonElement>(
    '[data-action-id="agent"]',
  )!;
  await act(async () => command.click());
  expect(onAgentSelection).toHaveBeenCalledExactlyOnceWith('canvas', ['a']);
  test.actionContext.fileId = 'another-canvas';
  await act(async () => command.click());
  expect(onAgentSelection).toHaveBeenCalledTimes(1);
});
