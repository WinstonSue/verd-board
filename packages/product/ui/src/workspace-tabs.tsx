import '@ylib/tabs';
import { useEffect, useId, useRef, useState } from 'react';
import { useActionSource, type ActionSource } from '@sue/board-react-actions';
import {
  bindWorkspaceAction,
  type WorkspaceActionBinding,
} from './workspace-action-bindings';
import {
  tabsEvents,
  type TabItem,
  type TabGroup,
  type TabsElement,
} from '@ylib/tabs';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'ylib-tabs': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & { class?: string };
    }
  }
}

export interface WorkspaceTabItem {
  /** Stable file identity — tabs deduplicate on it. */
  id: string;
  title: string;
}

export interface WorkspaceTabsProps {
  actionSource?: ActionSource;
  tabs: WorkspaceTabItem[];
  activeTabId: string | null;
  locale?: 'zh' | 'en';
  onActivate(id: string): void;
  onClose(id: string): void;
  onCloseMany?(id: string, scope: 'left' | 'right' | 'others'): void;
  groups?: TabGroup[];
  activeGroupId?: string;
  onSwitchGroup?(id: string): void;
  onCreateGroup?(name: string): void;
  onRenameGroup?(id: string, name: string): void;
  onDeleteGroup?(id: string): void;
  onAdd?(): void;
  onReorder?(
    tabId: string,
    targetTabId: string,
    position: 'before' | 'after',
  ): void;
}

/**
 * React wrapper over the `<ylib-tabs>` Web Component. Property-shaped inputs
 * (tabs, activeTabId, locale) are assigned on the element; DOM events are
 * bridged to callbacks.
 */
export function WorkspaceTabs({
  actionSource,
  tabs,
  activeTabId,
  locale = 'zh',
  onActivate,
  onClose,
  onCloseMany,
  groups,
  activeGroupId,
  onSwitchGroup,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onAdd,
  onReorder,
}: WorkspaceTabsProps) {
  const actionRevision = useActionSource(actionSource);
  const element = useRef<TabsElement>(null);
  const interacting = useRef(false);
  const appliedSource = useRef(actionSource);
  const syncInputs = useRef<(() => void) | null>(null);
  const handlers = useRef({
    actionSource,
    locale,
    onActivate,
    onClose,
    onAdd,
    onReorder,
    onCloseMany,
    groups,
    onSwitchGroup,
    onCreateGroup,
    onRenameGroup,
    onDeleteGroup,
  });
  handlers.current = {
    actionSource,
    locale,
    onActivate,
    onClose,
    onAdd,
    onReorder,
    onCloseMany,
    groups,
    onSwitchGroup,
    onCreateGroup,
    onRenameGroup,
    onDeleteGroup,
  };
  const [prompt, setPrompt] = useState<{
    groupId?: string;
    value: string;
    title?: string;
    submit?(name: string): void;
  } | null>(null);
  const applyShadowActions = useRef<() => void>(() => {});
  const contextBindings = useRef(
    new Map<HTMLButtonElement, WorkspaceActionBinding>(),
  );

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const invoke = (id: string, args: unknown, fallback: () => void) => {
      if (handlers.current.actionSource)
        void bindWorkspaceAction(
          handlers.current.actionSource,
          id,
          args,
        )?.execute();
      else fallback();
    };
    const tabId = (event: Event) =>
      (event as CustomEvent<{ tabId: string }>).detail.tabId;
    const closing = new Map<
      string,
      { action: WorkspaceActionBinding; tab: HTMLElement }
    >();
    let dragging: {
      args: {
        fileId: string;
        targetFileId: string;
        position: 'before' | 'after';
      };
      action: WorkspaceActionBinding;
    } | null = null;
    const eventTab = (event: Event) =>
      event
        .composedPath()
        .find(
          (item): item is HTMLElement =>
            item instanceof HTMLElement && item.getAttribute('role') === 'tab',
        );
    const captureClose = (event: Event) => {
      const closeButton = event
        .composedPath()
        .some(
          (item) =>
            item instanceof HTMLElement &&
            item.getAttribute('part') === 'close-button',
        );
      const fileId = eventTab(event)?.dataset['tabId'];
      if (!closeButton || !fileId) return;
      const action = bindWorkspaceAction(
        handlers.current.actionSource,
        'workspace.tab.close',
        { fileId },
      );
      const tab = eventTab(event);
      if (action && tab) closing.set(fileId, { action, tab });
    };
    const captureDrag = (event: Event) => {
      const fileId = eventTab(event)?.dataset['tabId'];
      if (!fileId) return;
      const args = {
        fileId,
        targetFileId: '',
        position: 'before' as 'before' | 'after',
      };
      const action = bindWorkspaceAction(
        handlers.current.actionSource,
        'workspace.tab.reorder',
        args,
      );
      dragging = action ? { args, action } : null;
    };
    const activate = (event: Event) =>
      invoke('workspace.tab.activate', { fileId: tabId(event) }, () =>
        handlers.current.onActivate(tabId(event)),
      );
    const close = (event: Event) => {
      const captured = closing.get(tabId(event));
      closing.delete(tabId(event));
      if (captured)
        void captured.action.execute().then((result) => {
          if (result.status !== 'completed' && result.status !== 'noop')
            captured.tab.removeAttribute('data-closing');
        });
      else
        invoke('workspace.tab.close', { fileId: tabId(event) }, () =>
          handlers.current.onClose(tabId(event)),
        );
    };
    const add = () =>
      invoke('workspace.create-canvas', { dirPath: '' }, () =>
        handlers.current.onAdd?.(),
      );
    const reorder = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          tabId: string;
          targetTabId: string;
          position: 'before' | 'after';
        }>
      ).detail;
      if (dragging?.args.fileId === detail.tabId) {
        dragging.args.targetFileId = detail.targetTabId;
        dragging.args.position = detail.position;
        void dragging.action.execute();
        dragging = null;
        return;
      }
      invoke(
        'workspace.tab.reorder',
        {
          fileId: detail.tabId,
          targetFileId: detail.targetTabId,
          position: detail.position,
        },
        () =>
          handlers.current.onReorder?.(
            detail.tabId,
            detail.targetTabId,
            detail.position,
          ),
      );
    };
    const groupId = (event: Event) =>
      (event as CustomEvent<{ groupId: string }>).detail.groupId;
    const openPrompt = (id?: string) => {
      const group = handlers.current.groups?.find((item) => item.id === id);
      if (id && !group) return;
      const source = handlers.current.actionSource;
      const args = { ...(id ? { groupId: id } : {}), name: '' };
      const submit = bindWorkspaceAction(
        source,
        id ? 'workspace.group.rename' : 'workspace.group.create',
        args,
      );
      const present = () =>
        setPrompt({
          ...(id ? { groupId: id } : {}),
          value: group?.name ?? '',
          title: bindWorkspaceAction(
            source,
            id
              ? 'workspace.group.rename-dialog'
              : 'workspace.group.create-dialog',
            { groupId: id },
          )?.label(handlers.current.locale),
          submit: source
            ? (name) => {
                args.name = name;
                void submit?.execute();
              }
            : undefined,
        });
      if (source)
        invoke(
          id
            ? 'workspace.group.rename-dialog'
            : 'workspace.group.create-dialog',
          { ...(id ? { groupId: id } : {}), present },
          present,
        );
      else if (
        id ? handlers.current.onRenameGroup : handlers.current.onCreateGroup
      )
        present();
    };
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const beginInteraction = () => {
      clearTimeout(releaseTimer);
      interacting.current = true;
    };
    const endInteraction = () => {
      clearTimeout(releaseTimer);
      // Let click/default actions complete on the original shadow DOM first.
      releaseTimer = setTimeout(() => {
        interacting.current = false;
        syncInputs.current?.();
      }, 0);
    };
    const listeners: [string, EventListener][] = [
      [tabsEvents.activate, activate],
      [tabsEvents.close, close],
      [tabsEvents.add, add],
      [tabsEvents.reorder, reorder],
      ...(['left', 'right', 'others'] as const).map(
        (scope): [string, EventListener] => [
          scope === 'left'
            ? tabsEvents.closeLeft
            : scope === 'right'
              ? tabsEvents.closeRight
              : tabsEvents.closeOthers,
          (event) =>
            invoke(
              `workspace.tab.close-${scope}`,
              { fileId: tabId(event) },
              () => handlers.current.onCloseMany?.(tabId(event), scope),
            ),
        ],
      ),
      [
        tabsEvents.switchGroup,
        (event) =>
          invoke('workspace.group.switch', { groupId: groupId(event) }, () =>
            handlers.current.onSwitchGroup?.(groupId(event)),
          ),
      ],
      [tabsEvents.addGroup, () => openPrompt()],
      [tabsEvents.renameGroup, (event) => openPrompt(groupId(event))],
      [
        tabsEvents.deleteGroup,
        (event) =>
          invoke('workspace.group.delete', { groupId: groupId(event) }, () =>
            handlers.current.onDeleteGroup?.(groupId(event)),
          ),
      ],
    ];
    const contextMenu = (event: Event) => {
      if (!handlers.current.actionSource) return;
      const tab = event
        .composedPath()
        .find(
          (item): item is HTMLElement =>
            item instanceof HTMLElement && item.getAttribute('role') === 'tab',
        );
      const fileId = tab?.dataset['tabId'];
      const menu = node.shadowRoot?.querySelector<HTMLElement>(
        '[part="context-menu"]',
      );
      if (!fileId || !menu) return;
      contextBindings.current.clear();
      const buttons = [
        'close',
        'close-right',
        'close-others',
        'close-left',
      ].flatMap((suffix) => {
        const action = bindWorkspaceAction(
          handlers.current.actionSource,
          `workspace.tab.${suffix}`,
          { fileId },
        );
        if (!action) return [];
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset['actionId'] = action.id;
        button.textContent = action.label(handlers.current.locale);
        const refresh = () => {
          const state = action.getState();
          button.disabled = !state.enabled;
          button.hidden = !state.visible;
          button.title = state.reason ?? '';
        };
        refresh();
        button.addEventListener('click', (click) => {
          click.stopPropagation();
          menu.hidden = true;
          void action.execute();
        });
        contextBindings.current.set(button, action);
        return [button];
      });
      menu.replaceChildren(...buttons);
    };
    listeners.forEach(([name, listener]) =>
      node.addEventListener(name, listener),
    );
    node.addEventListener('pointerdown', beginInteraction, true);
    node.shadowRoot?.addEventListener('click', captureClose, true);
    node.shadowRoot?.addEventListener('dragstart', captureDrag, true);
    node.shadowRoot?.addEventListener('contextmenu', contextMenu);
    node.addEventListener('dragend', endInteraction);
    document.addEventListener('pointerup', endInteraction);
    document.addEventListener('pointercancel', endInteraction);
    return () => {
      clearTimeout(releaseTimer);
      interacting.current = false;
      node.removeEventListener('pointerdown', beginInteraction, true);
      node.shadowRoot?.removeEventListener('click', captureClose, true);
      node.shadowRoot?.removeEventListener('dragstart', captureDrag, true);
      node.shadowRoot?.removeEventListener('contextmenu', contextMenu);
      node.removeEventListener('dragend', endInteraction);
      document.removeEventListener('pointerup', endInteraction);
      document.removeEventListener('pointercancel', endInteraction);
      listeners.forEach(([name, listener]) =>
        node.removeEventListener(name, listener),
      );
    };
  }, []);

  applyShadowActions.current = () => {
    const node = element.current;
    const shadow = node?.shadowRoot;
    if (!node || !shadow || !actionSource) return;
    const bind = (id: string, args?: unknown) =>
      bindWorkspaceAction(actionSource, `workspace.${id}`, args);
    const decorate = (
      target: HTMLElement | null,
      action: WorkspaceActionBinding | undefined,
      suffix = '',
      label = true,
    ) => {
      if (!target) return;
      const state = action?.getState();
      target.hidden = !state?.visible;
      target.setAttribute('aria-disabled', String(!state?.enabled));
      if (target instanceof HTMLButtonElement)
        target.disabled = !state?.enabled;
      if (action) {
        target.dataset['actionId'] = action.id;
        target.title = state?.reason ?? action.label(locale);
        if (label)
          target.setAttribute('aria-label', `${action.label(locale)}${suffix}`);
      }
    };
    for (const tab of shadow.querySelectorAll<HTMLElement>(
      '[role="tab"][data-tab-id]',
    )) {
      const fileId = tab.dataset['tabId']!;
      decorate(tab, bind('tab.activate', { fileId }), '', false);
      const title = tabs.find((item) => item.id === fileId)?.title ?? '';
      decorate(
        tab.querySelector('[part="close-button"]'),
        bind('tab.close', { fileId }),
        ` ${title}`,
      );
      tab.draggable = tabs.some(
        (target) =>
          target.id !== fileId &&
          bind('tab.reorder', {
            fileId,
            targetFileId: target.id,
            position: 'before',
          })?.getState().enabled,
      );
    }
    decorate(
      shadow.querySelector('[part="add-button"]'),
      bind('create-canvas', { dirPath: '' }),
    );
    shadow.querySelectorAll<HTMLElement>('.group-row').forEach((row, index) => {
      const group = node.groups[index];
      if (!group) return;
      row.dataset['groupId'] = group.id;
      decorate(
        row.querySelector('.group-option'),
        bind('group.switch', { groupId: group.id }),
        ` ${group.name}`,
        false,
      );
      const controls = row.querySelectorAll<HTMLElement>('.group-row-action');
      decorate(
        controls[0] ?? null,
        bind('group.rename-dialog', { groupId: group.id }),
        ` ${group.name}`,
      );
      decorate(
        controls[1] ?? null,
        bind('group.delete', { groupId: group.id }),
        ` ${group.name}`,
      );
    });
    const createGroup = shadow.querySelector<HTMLButtonElement>(
      '.group-actions button',
    );
    const create = bind('group.create-dialog');
    decorate(createGroup, create);
    if (createGroup && create) createGroup.textContent = create.label(locale);
    for (const [button, action] of contextBindings.current) {
      if (!button.isConnected) {
        contextBindings.current.delete(button);
        continue;
      }
      decorate(button, action);
      button.textContent = action.label(locale);
    }
  };

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const sync = () => {
      if (interacting.current) {
        applyShadowActions.current();
        return;
      }
      const groupMenu = () =>
        node.shadowRoot
          ?.querySelector('[part="group-toggle"]')
          ?.closest('details');
      const groupMenuOpen = groupMenu()?.open;
      const items: TabItem[] = tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
      }));
      if (appliedSource.current !== actionSource) {
        appliedSource.current = actionSource;
        contextBindings.current.clear();
        node.tabs = items;
        node.groups = groups ?? [];
      }
      // Each Web Component setter rebuilds its shadow DOM. Saving a file must
      // not dismiss an open menu or replace the tab currently being dragged.
      if (JSON.stringify(node.tabs) !== JSON.stringify(items))
        node.tabs = items;
      if (node.activeTabId !== (activeTabId ?? ''))
        node.activeTabId = activeTabId ?? '';
      if (node.locale !== locale) node.locale = locale;
      if (!node.reorderable) node.reorderable = true;
      if (JSON.stringify(node.groups) !== JSON.stringify(groups ?? []))
        node.groups = groups ?? [];
      if (node.activeGroupId !== (activeGroupId ?? ''))
        node.activeGroupId = activeGroupId ?? '';
      const hideGroupButton =
        !groups ||
        (!actionSource &&
          (!onSwitchGroup ||
            !onCreateGroup ||
            !onRenameGroup ||
            !onDeleteGroup));
      if (node.hideGroupButton !== hideGroupButton)
        node.hideGroupButton = hideGroupButton;
      const hideAdd = actionSource
        ? !bindWorkspaceAction(actionSource, 'workspace.create-canvas', {
            dirPath: '',
          })?.getState().visible
        : !onAdd;
      if (node.hideAddButton !== hideAdd) node.hideAddButton = hideAdd;
      const menu = groupMenu();
      if (groupMenuOpen && menu) menu.open = true;
      applyShadowActions.current();
    };
    syncInputs.current = sync;
    sync();
  }, [
    tabs,
    activeTabId,
    locale,
    groups,
    activeGroupId,
    onSwitchGroup,
    onCreateGroup,
    onRenameGroup,
    onDeleteGroup,
    onAdd,
    actionSource,
    actionRevision,
  ]);

  return (
    <>
      <ylib-tabs ref={element} class="workspace-tabs" />
      {prompt && (
        <TabGroupPrompt
          key={prompt.groupId ?? 'create'}
          locale={locale}
          initialValue={prompt.value}
          rename={!!prompt.groupId}
          title={prompt.title}
          onClose={() => setPrompt(null)}
          onSubmit={(name) => {
            if (prompt.submit) prompt.submit(name);
            else if (prompt.groupId)
              handlers.current.onRenameGroup?.(prompt.groupId, name);
            else handlers.current.onCreateGroup?.(name);
            setPrompt(null);
          }}
        />
      )}
    </>
  );
}

function TabGroupPrompt({
  locale,
  initialValue,
  rename,
  title: actionTitle,
  onSubmit,
  onClose,
}: {
  locale: 'zh' | 'en';
  initialValue: string;
  rename: boolean;
  title?: string;
  onSubmit(name: string): void;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [value, setValue] = useState(initialValue);
  const title =
    actionTitle ??
    (locale === 'zh'
      ? rename
        ? '重命名分组'
        : '新建分组'
      : rename
        ? 'Rename group'
        : 'New group');
  useEffect(() => {
    dialog.current?.showModal();
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="file-tree-prompt workspace-tab-group-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <h2 id={titleId} className="file-tree-prompt__title">
          {title}
        </h2>
        <input
          ref={input}
          aria-label={locale === 'zh' ? '分组名称' : 'Group name'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="file-tree-prompt__actions">
          <button
            type="button"
            className="workspace-button-ghost"
            onClick={onClose}
          >
            {locale === 'zh' ? '取消' : 'Cancel'}
          </button>
          <button
            type="submit"
            className="workspace-button-primary"
            disabled={!value.trim()}
          >
            {locale === 'zh' ? '确定' : 'OK'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
