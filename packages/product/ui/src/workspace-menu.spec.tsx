import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceMenu, type WorkspaceMenuProps } from './workspace-menu';

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
  ).toEqual(['工作区设置', '打开工作区文件夹', '回到内置工作区']);
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
