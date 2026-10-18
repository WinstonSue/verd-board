import '@ylib/tabs';
import { useEffect, useId, useRef, useState } from 'react';
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
  const element = useRef<TabsElement>(null);
  const interacting = useRef(false);
  const syncInputs = useRef<(() => void) | null>(null);
  const handlers = useRef({
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
  } | null>(null);

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const activate = (event: Event) =>
      handlers.current.onActivate(
        (event as CustomEvent<{ tabId: string }>).detail.tabId,
      );
    const close = (event: Event) =>
      handlers.current.onClose(
        (event as CustomEvent<{ tabId: string }>).detail.tabId,
      );
    const add = () => handlers.current.onAdd?.();
    const reorder = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          tabId: string;
          targetTabId: string;
          position: 'before' | 'after';
        }>
      ).detail;
      handlers.current.onReorder?.(
        detail.tabId,
        detail.targetTabId,
        detail.position,
      );
    };
    const groupId = (event: Event) =>
      (event as CustomEvent<{ groupId: string }>).detail.groupId;
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
            handlers.current.onCloseMany?.(
              (event as CustomEvent<{ tabId: string }>).detail.tabId,
              scope,
            ),
        ],
      ),
      [
        tabsEvents.switchGroup,
        (event) => handlers.current.onSwitchGroup?.(groupId(event)),
      ],
      [
        tabsEvents.addGroup,
        () => {
          if (handlers.current.onCreateGroup) setPrompt({ value: '' });
        },
      ],
      [
        tabsEvents.renameGroup,
        (event) => {
          const group = handlers.current.groups?.find(
            (item) => item.id === groupId(event),
          );
          if (group && handlers.current.onRenameGroup)
            setPrompt({ groupId: group.id, value: group.name });
        },
      ],
      [
        tabsEvents.deleteGroup,
        (event) => handlers.current.onDeleteGroup?.(groupId(event)),
      ],
    ];
    listeners.forEach(([name, listener]) =>
      node.addEventListener(name, listener),
    );
    node.addEventListener('pointerdown', beginInteraction, true);
    node.addEventListener('dragend', endInteraction);
    document.addEventListener('pointerup', endInteraction);
    document.addEventListener('pointercancel', endInteraction);
    return () => {
      clearTimeout(releaseTimer);
      interacting.current = false;
      node.removeEventListener('pointerdown', beginInteraction, true);
      node.removeEventListener('dragend', endInteraction);
      document.removeEventListener('pointerup', endInteraction);
      document.removeEventListener('pointercancel', endInteraction);
      listeners.forEach(([name, listener]) =>
        node.removeEventListener(name, listener),
      );
    };
  }, []);

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const sync = () => {
      if (interacting.current) return;
      const groupMenu = () =>
        node.shadowRoot
          ?.querySelector('[part="group-toggle"]')
          ?.closest('details');
      const groupMenuOpen = groupMenu()?.open;
      const items: TabItem[] = tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
      }));
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
        !onSwitchGroup ||
        !onCreateGroup ||
        !onRenameGroup ||
        !onDeleteGroup;
      if (node.hideGroupButton !== hideGroupButton)
        node.hideGroupButton = hideGroupButton;
      if (node.hideAddButton !== !onAdd) node.hideAddButton = !onAdd;
      const menu = groupMenu();
      if (groupMenuOpen && menu) menu.open = true;
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
          onClose={() => setPrompt(null)}
          onSubmit={(name) => {
            if (prompt.groupId)
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
  onSubmit,
  onClose,
}: {
  locale: 'zh' | 'en';
  initialValue: string;
  rename: boolean;
  onSubmit(name: string): void;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [value, setValue] = useState(initialValue);
  const title =
    locale === 'zh'
      ? rename
        ? '重命名分组'
        : '新建分组'
      : rename
        ? 'Rename group'
        : 'New group';
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
