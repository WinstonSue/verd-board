import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceTabs, type WorkspaceTabsProps } from './workspace-tabs';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
HTMLDialogElement.prototype.showModal ??= function () {
  this.open = true;
};
let root: Root;
let container: HTMLDivElement;
const setup = async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const props: WorkspaceTabsProps = {
    tabs: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ],
    activeTabId: 'a',
    groups: [{ id: 'one', name: 'One' }],
    activeGroupId: 'one',
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onCloseMany: vi.fn(),
    onAdd: vi.fn(),
    onReorder: vi.fn(),
    onSwitchGroup: vi.fn(),
    onCreateGroup: vi.fn(),
    onRenameGroup: vi.fn(),
    onDeleteGroup: vi.fn(),
  };
  await act(async () =>
    root.render(
      <React.StrictMode>
        <WorkspaceTabs {...props} />
      </React.StrictMode>,
    ),
  );
  const fire = async (name: string, detail = {}) =>
    act(async () => {
      container
        .querySelector('ylib-tabs')!
        .dispatchEvent(new CustomEvent(name, { detail }));
    });
  return { props, fire };
};
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

describe('WorkspaceTabs', () => {
  it('lets a group-menu click finish when blurring a document changes a tab title', async () => {
    const { props } = await setup();
    const element = container.querySelector('ylib-tabs')!;
    const menu =
      element.shadowRoot!.querySelector<HTMLDetailsElement>('.group-menu')!;
    const firstTab = element.shadowRoot!.querySelector('[role="tab"]');
    await act(async () =>
      element.dispatchEvent(new Event('pointerdown', { bubbles: true })),
    );
    await act(async () =>
      root.render(
        <React.StrictMode>
          <WorkspaceTabs
            {...props}
            tabs={[{ id: 'a', title: 'Renamed' }, props.tabs[1]]}
          />
        </React.StrictMode>,
      ),
    );
    expect(element.shadowRoot!.querySelector('[role="tab"]')).toBe(firstTab);
    // The summary's native click opens its menu before deferred inputs apply.
    menu.open = true;
    await act(async () => {
      document.dispatchEvent(new Event('pointerup'));
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(
      element.shadowRoot!.querySelector<HTMLDetailsElement>('.group-menu')!
        .open,
    ).toBe(true);
    expect(
      element.shadowRoot!.querySelector('[role="tab"]')!.textContent,
    ).toContain('Renamed');
  });
  it('preserves open menus and tab nodes when only parent callbacks change', async () => {
    const { props } = await setup();
    const element = container.querySelector('ylib-tabs')!;
    const menu =
      element.shadowRoot!.querySelector<HTMLDetailsElement>('.group-menu')!;
    const tab = element.shadowRoot!.querySelector('[role="tab"]');
    menu.open = true;
    const activate = vi.fn();
    await act(async () =>
      root.render(
        <React.StrictMode>
          <WorkspaceTabs
            {...props}
            tabs={[...props.tabs]}
            groups={[...props.groups!]}
            onActivate={activate}
          />
        </React.StrictMode>,
      ),
    );
    expect(element.shadowRoot!.querySelector('.group-menu')).toBe(menu);
    expect(menu.open).toBe(true);
    expect(element.shadowRoot!.querySelector('[role="tab"]')).toBe(tab);
    await act(async () =>
      element.dispatchEvent(
        new CustomEvent('tab-activate', { detail: { tabId: 'b' } }),
      ),
    );
    expect(activate).toHaveBeenCalledExactlyOnceWith('b');
    expect(props.onActivate).not.toHaveBeenCalled();
  });
  it('bridges all closing, activation, add, reorder and group events once in StrictMode', async () => {
    const { props, fire } = await setup();
    await fire('tab-close', { tabId: 'a' });
    expect(props.onClose).toHaveBeenCalledExactlyOnceWith('a');
    for (const scope of ['left', 'right', 'others'])
      await fire(`tab-close-${scope}`, { tabId: 'b' });
    expect(props.onCloseMany).toHaveBeenCalledTimes(3);
    expect(props.onCloseMany).toHaveBeenCalledWith('b', 'right');
    await fire('tab-activate', { tabId: 'b' });
    await fire('tab-add');
    await fire('tab-reorder', {
      tabId: 'a',
      targetTabId: 'b',
      position: 'after',
    });
    await fire('group-switch', { groupId: 'one' });
    await fire('group-delete', { groupId: 'one' });
    expect(props.onActivate).toHaveBeenCalledExactlyOnceWith('b');
    expect(props.onAdd).toHaveBeenCalledTimes(1);
    expect(props.onReorder).toHaveBeenCalledExactlyOnceWith('a', 'b', 'after');
    expect(props.onSwitchGroup).toHaveBeenCalledExactlyOnceWith('one');
    expect(props.onDeleteGroup).toHaveBeenCalledExactlyOnceWith('one');
  });

  it('uses a cancellable dialog, rejects blank names and submits trimmed group names', async () => {
    const { props, fire } = await setup();
    await fire('group-add');
    const dialog = container.querySelector('dialog')!;
    expect(document.activeElement).toBe(dialog.querySelector('input'));
    expect(
      dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!
        .disabled,
    ).toBe(true);
    const input = dialog.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, '  Work  ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      dialog
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
    );
    expect(props.onCreateGroup).toHaveBeenCalledExactlyOnceWith('Work');
    expect(container.querySelector('dialog')).toBeNull();
    await fire('group-rename', { groupId: 'one' });
    expect(container.querySelector('input')!.value).toBe('One');
    await act(async () =>
      container
        .querySelector('dialog')!
        .dispatchEvent(new Event('cancel', { cancelable: true })),
    );
    expect(props.onRenameGroup).not.toHaveBeenCalled();
    expect(container.querySelector('dialog')).toBeNull();
  });
});
