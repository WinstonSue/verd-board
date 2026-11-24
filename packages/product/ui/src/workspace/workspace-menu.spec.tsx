import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceMenu, type WorkspaceMenuProps } from './workspace-menu';
import { createActionRegistry } from '@sue/board-common';

vi.mock('@floating-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@floating-ui/react')>();
  return { ...actual, autoUpdate: () => () => {} };
});
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
let root: Root;
let container: HTMLDivElement;
const setup = async (props: Partial<WorkspaceMenuProps> = {}) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const value = { name: '工作区', onSettings: vi.fn(), ...props };
  await act(async () => root.render(<WorkspaceMenu {...value} />));
  return value;
};
const trigger = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-testid="workspace-menu-trigger"]',
  )!;
const item = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

it('groups desktop actions and never invokes a disabled built-in action', async () => {
  const onOpenBuiltin = vi.fn();
  const props = await setup({
    isDefault: true,
    onOpenFolder: vi.fn(),
    onOpenBuiltin,
  });
  await act(async () => trigger().click());
  expect(
    [...document.querySelectorAll('[role="menuitem"]')].map(
      (element) => element.textContent,
    ),
  ).toEqual(['工作区设置', '导入工作区', '打开系统介绍']);
  expect(item('workspace-open-folder').hasAttribute('data-group-start')).toBe(
    true,
  );
  expect(item('workspace-open-builtin').disabled).toBe(true);
  await act(async () => {
    item('workspace-open-builtin').click();
    item('workspace-open-builtin').dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
  });
  expect(onOpenBuiltin).not.toHaveBeenCalled();
  await act(async () => item('workspace-open-settings').click());
  expect(props.onSettings).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it('hides unavailable switching actions and exposes the full name and trigger ref', async () => {
  const ref = createRef<HTMLButtonElement>();
  await setup({ name: 'A long workspace name', locale: 'en', triggerRef: ref });
  expect(trigger().title).toBe('A long workspace name');
  expect(ref.current).toBe(trigger());
  await act(async () => trigger().click());
  expect(
    [...document.querySelectorAll('[role="menuitem"]')].map(
      (element) => element.textContent,
    ),
  ).toEqual(['Workspace settings']);
  await act(async () =>
    root.render(
      <WorkspaceMenu
        name="A long workspace name"
        onSettings={vi.fn()}
        switching
      />,
    ),
  );
  expect(trigger().disabled).toBe(true);
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it('puts the registered palette after settings and executes its captured action', async () => {
  const execute = vi.fn(() => ({ status: 'completed' as const }));
  const actions = createActionRegistry({ getContext: () => ({}) });
  actions.register({
    id: 'workspace.command-palette',
    label: { zh: '命令面板', en: 'Command palette' },
    effect: 'dialog',
    execute,
  });
  const props = await setup({ actionSource: actions });
  await act(async () => trigger().click());
  expect(
    [...document.querySelectorAll('[role="menuitem"]')].map(
      (element) => element.textContent,
    ),
  ).toEqual(['工作区设置', '命令面板', '导入工作区', '打开系统介绍']);
  await act(async () => item('workspace-command-palette').click());
  expect(execute).toHaveBeenCalledOnce();
  expect(props.onSettings).not.toHaveBeenCalled();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await act(async () => actions.dispose());
});

it('shows every recorded workspace, disambiguates names and disables the current entry', async () => {
  const onOpenHistory = vi.fn();
  const onRefreshHistory = vi.fn();
  await setup({
    history: [
      { id: 'a', name: 'project', description: 'left/shared' },
      { id: 'b', name: 'project', description: 'right/shared' },
      ...Array.from({ length: 21 }, (_, index) => ({
        id: `older-${index}`,
        name: `Older ${index}`,
      })),
    ],
    currentHistoryId: 'a',
    onOpenHistory,
    onRefreshHistory,
  });
  await act(async () => trigger().click());
  expect(onRefreshHistory).toHaveBeenCalledOnce();
  expect(
    document.querySelector('.workspace-menu-group-label')?.textContent,
  ).toBe('已打开的工作区');
  expect(item('workspace-history-a').textContent).toBe(
    'project · left/shared（当前）',
  );
  expect(item('workspace-history-a').disabled).toBe(true);
  expect(
    document.querySelectorAll('[data-testid^="workspace-history-"]'),
  ).toHaveLength(23);
  await act(async () => item('workspace-history-b').click());
  expect(onOpenHistory).toHaveBeenCalledWith('b');
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it('keeps contextual history labels when executing registered semantic actions', async () => {
  const execute = vi.fn(() => ({ status: 'completed' as const }));
  const actions = createActionRegistry({ getContext: () => ({}) });
  actions.register({
    id: 'workspace.open-history',
    label: { zh: '打开历史工作区', en: 'Open recorded workspace' },
    effect: 'dialog',
    execute,
  });
  await setup({
    actionSource: actions,
    locale: 'en',
    history: [{ id: 'a', name: 'My project' }],
  });
  await act(async () => trigger().click());
  expect(item('workspace-history-a').textContent).toBe('My project');
  expect(
    document.querySelector('.workspace-menu-group-label')?.textContent,
  ).toBe('Opened workspaces');
  await act(async () => item('workspace-history-a').click());
  expect(execute).toHaveBeenCalledWith(
    expect.anything(),
    { historyId: 'a' },
    expect.anything(),
  );
  await act(async () => actions.dispose());
});

it('opens the same switcher for click and ArrowDown and exposes update status', async () => {
  const onSwitch = vi.fn();
  await setup({ onSwitch, updatesAvailable: true, switcherOpen: true });
  expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
  expect(trigger().getAttribute('aria-expanded')).toBe('true');
  expect(trigger().getAttribute('aria-label')).toContain('内置内容有更新');
  expect(trigger().querySelector('.vm-dot')).toBeTruthy();
  await act(async () => trigger().click());
  await act(async () =>
    trigger().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    ),
  );
  expect(onSwitch).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[role="menu"]')).toBeNull();
});
