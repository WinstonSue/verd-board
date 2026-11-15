import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActionRegistry } from '@sue/board-common';
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
const setup = async (patch: Partial<WorkspaceTabsProps> = {}) => {
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
    ...patch,
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

function actionSource() {
  let epoch = 0;
  const permissions = new Map<
    string,
    { enabled?: boolean; visible?: boolean }
  >();
  const runs = vi.fn();
  const source = createActionRegistry({
    getContext: () => ({ epoch }),
    refresh: (captured) => (captured.epoch === epoch ? { epoch } : null),
  });
  for (const suffix of [
    'tab.activate',
    'tab.close',
    'tab.close-left',
    'tab.close-right',
    'tab.close-others',
    'tab.reorder',
    'create-canvas',
    'group.switch',
    'group.create-dialog',
    'group.rename-dialog',
    'group.create',
    'group.rename',
    'group.delete',
  ]) {
    const id = `workspace.${suffix}`;
    source.register<Record<string, unknown>>({
      id,
      label: `Source ${suffix}`,
      category: 'workspace',
      effect: 'view',
      getState: () => permissions.get(id) ?? {},
      execute: (_context, args) => {
        runs(id, args);
        if (typeof args?.['present'] === 'function') args['present']();
        return { status: 'completed' };
      },
    });
  }
  source.seal();
  return {
    source,
    runs,
    permissions,
    switchWorkspace: () => {
      epoch++;
      source.invalidate();
    },
  };
}

describe('WorkspaceTabs', () => {
  it('takes shadow button names, states and all event execution from the supplied source', async () => {
    const { source, runs, permissions } = actionSource();
    permissions.set('workspace.group.delete', { enabled: false });
    const { props, fire } = await setup({ actionSource: source });
    const shadow = container.querySelector('ylib-tabs')!.shadowRoot!;
    expect(
      shadow.querySelector('[part="add-button"]')!.getAttribute('aria-label'),
    ).toBe('Source create-canvas');
    expect(
      shadow
        .querySelector('[data-action-id="workspace.group.delete"]')!
        .getAttribute('aria-disabled'),
    ).toBe('true');
    await fire('tab-activate', { tabId: 'b' });
    await fire('tab-close', { tabId: 'a' });
    await fire('tab-close-right', { tabId: 'a' });
    await fire('tab-reorder', {
      tabId: 'a',
      targetTabId: 'b',
      position: 'after',
    });
    await fire('tab-add');
    await fire('group-switch', { groupId: 'one' });
    await fire('group-delete', { groupId: 'one' });
    expect(runs).toHaveBeenCalledWith('workspace.tab.activate', {
      fileId: 'b',
    });
    expect(runs).toHaveBeenCalledWith('workspace.tab.close', { fileId: 'a' });
    expect(runs).toHaveBeenCalledWith('workspace.tab.close-right', {
      fileId: 'a',
    });
    expect(runs).toHaveBeenCalledWith('workspace.tab.reorder', {
      fileId: 'a',
      targetFileId: 'b',
      position: 'after',
    });
    expect(runs).toHaveBeenCalledWith('workspace.create-canvas', {
      dirPath: '',
    });
    expect(runs).toHaveBeenCalledWith('workspace.group.switch', {
      groupId: 'one',
    });
    expect(
      runs.mock.calls.some(([id]) => id === 'workspace.group.delete'),
    ).toBe(false);
    expect(props.onActivate).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onCloseMany).not.toHaveBeenCalled();
    expect(props.onReorder).not.toHaveBeenCalled();
    expect(props.onAdd).not.toHaveBeenCalled();
    expect(props.onSwitchGroup).not.toHaveBeenCalled();
    expect(props.onDeleteGroup).not.toHaveBeenCalled();
    await act(async () => {
      permissions.set('workspace.create-canvas', { visible: false });
      source.invalidate();
    });
    expect(shadow.querySelector('[part="add-button"]')).toBeNull();
  });

  it('captures a context menu tab and reflects later source permissions without retargeting', async () => {
    const { source, runs, permissions } = actionSource();
    await setup({ actionSource: source });
    const element = container.querySelector('ylib-tabs')!;
    const shadow = element.shadowRoot!;
    await act(async () =>
      shadow.querySelector('[data-tab-id="b"]')!.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      ),
    );
    const button = shadow.querySelector<HTMLButtonElement>(
      '[part="context-menu"] [data-action-id="workspace.tab.close-others"]',
    )!;
    expect(button.textContent).toBe('Source tab.close-others');
    await act(async () => {
      permissions.set('workspace.tab.close-left', { enabled: false });
      source.invalidate();
    });
    expect(
      shadow.querySelector<HTMLButtonElement>(
        '[part="context-menu"] [data-action-id="workspace.tab.close-left"]',
      )!.disabled,
    ).toBe(true);
    await act(async () => button.click());
    expect(runs).toHaveBeenCalledExactlyOnceWith('workspace.tab.close-others', {
      fileId: 'b',
    });
  });

  it('submits a trimmed group name through the action captured before its dialog opens', async () => {
    const { source, runs } = actionSource();
    const { props, fire } = await setup({ actionSource: source });
    await fire('group-rename', { groupId: 'one' });
    const dialog = container.querySelector('dialog')!;
    expect(dialog.textContent).toContain('Source group.rename-dialog');
    const input = dialog.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, ' Renamed ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      dialog
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
    );
    expect(runs).toHaveBeenCalledWith('workspace.group.rename', {
      groupId: 'one',
      name: 'Renamed',
    });
    expect(props.onRenameGroup).not.toHaveBeenCalled();
  });

  it('keeps an animated close bound to the workspace where its button was clicked', async () => {
    const { source, runs, switchWorkspace } = actionSource();
    const { props } = await setup({ actionSource: source });
    const shadow = container.querySelector('ylib-tabs')!.shadowRoot!;
    const tab = shadow.querySelector<HTMLElement>('[data-tab-id="a"]')!;
    await act(async () =>
      tab.querySelector<HTMLButtonElement>('[part="close-button"]')!.click(),
    );
    expect(tab.hasAttribute('data-closing')).toBe(true);
    await act(async () => switchWorkspace());
    await act(async () => tab.dispatchEvent(new Event('animationend')));
    expect(runs).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(tab.hasAttribute('data-closing')).toBe(false);
  });

  it('opens group drafts through source dialogs and cancels a captured confirmation after workspace changes', async () => {
    const { source, runs, switchWorkspace } = actionSource();
    const { props, fire } = await setup({ actionSource: source });
    await fire('group-add');
    const dialog = container.querySelector('dialog')!;
    expect(dialog.textContent).toContain('Source group.create-dialog');
    const input = dialog.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, ' Work ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      switchWorkspace();
    });
    await act(async () =>
      dialog
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
    );
    expect(
      runs.mock.calls.some(([id]) => id === 'workspace.group.create'),
    ).toBe(false);
    expect(props.onCreateGroup).not.toHaveBeenCalled();
  });

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
