import '@ylib/tabs';
import { useEffect, useRef } from 'react';
import type { TabItem, TabsElement } from '@ylib/tabs';

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
  onAdd,
  onReorder,
}: WorkspaceTabsProps) {
  const element = useRef<TabsElement>(null);
  const handlers = useRef({ onActivate, onClose, onAdd, onReorder });
  handlers.current = { onActivate, onClose, onAdd, onReorder };

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
    node.addEventListener('tab-activate', activate);
    node.addEventListener('tab-close', close);
    node.addEventListener('tab-add', add);
    node.addEventListener('tab-reorder', reorder);
    return () => {
      node.removeEventListener('tab-activate', activate);
      node.removeEventListener('tab-close', close);
      node.removeEventListener('tab-add', add);
      node.removeEventListener('tab-reorder', reorder);
    };
  }, []);

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const items: TabItem[] = tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
    }));
    node.tabs = items;
    node.activeTabId = activeTabId ?? '';
    node.locale = locale;
    node.reorderable = true;
  }, [tabs, activeTabId, locale]);

  return <ylib-tabs ref={element} class="workspace-tabs" />;
}
