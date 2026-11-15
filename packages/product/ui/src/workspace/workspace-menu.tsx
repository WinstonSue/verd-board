import { WorkspaceButton } from '../shared/workspace-design';
import { useEffect, useRef, useState, type Ref, type ReactNode } from 'react';
import {
  ChevronDown,
  Command,
  FolderOpen,
  House,
  History,
  Settings,
} from 'lucide-react';
import { useActionSource, type ActionSource } from '@sue/board-react-actions';
import { bindWorkspaceAction } from './workspace-action-bindings';
import { FileTreeMenu, type FileTreeMenuItem } from './file-tree-menu';

export interface WorkspaceMenuProps {
  updatesAvailable?: boolean;
  onUpdate?(): void;
  trailing?: ReactNode;
  switcherOpen?: boolean;
  actionSource?: ActionSource;
  name: string;
  locale?: 'zh' | 'en';
  switching?: boolean;
  isDefault?: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
  onSwitch?(): void;
  onSettings(): void;
  onOpenFolder?(): void;
  onOpenBuiltin?(): void;
  onOpenPatterns?(): void;
  history?: readonly { id: string; name: string; description?: string }[];
  currentHistoryId?: string;
  onOpenHistory?(id: string): void;
  onRefreshHistory?(): void;
}

export function WorkspaceMenu({
  updatesAvailable,
  onUpdate,
  trailing,
  switcherOpen = false,
  actionSource,
  name,
  locale = 'zh',
  switching = false,
  isDefault = false,
  triggerRef,
  onSettings,
  onSwitch,
  onOpenFolder,
  onOpenBuiltin,
  onOpenPatterns,
  history = [],
  currentHistoryId,
  onOpenHistory,
  onRefreshHistory,
}: WorkspaceMenuProps) {
  const button = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  useActionSource(actionSource);
  const zh = locale === 'zh';
  useEffect(() => {
    setOpen(false);
  }, [name, switching]);
  const items: FileTreeMenuItem[] = [
    {
      id: 'settings',
      action: bindWorkspaceAction(actionSource, 'workspace.settings'),
      label: zh ? '工作区设置' : 'Workspace settings',
      icon: Settings,
      testId: 'workspace-open-settings',
      onSelect: onSettings,
    },
  ];
  const commandPalette = bindWorkspaceAction(
    actionSource,
    'workspace.command-palette',
  );
  if (commandPalette)
    items.push({
      id: 'command-palette',
      action: commandPalette,
      label: zh ? '命令面板' : 'Command palette',
      icon: Command,
      testId: 'workspace-command-palette',
      onSelect: () => {},
    });
  if (actionSource || onOpenFolder)
    items.push({
      id: 'open-folder',
      action: bindWorkspaceAction(actionSource, 'workspace.open-folder'),
      label: zh ? '打开工作区文件夹' : 'Open workspace folder',
      icon: FolderOpen,
      testId: 'workspace-open-folder',
      groupStart: true,
      onSelect: () => onOpenFolder?.(),
    });
  if (actionSource || onOpenBuiltin)
    items.push({
      id: 'open-builtin',
      action: bindWorkspaceAction(actionSource, 'workspace.open-builtin'),
      label: zh ? '打开系统介绍' : 'Open system introduction',
      icon: House,
      testId: 'workspace-open-builtin',
      disabled: actionSource ? undefined : isDefault,
      groupStart: !onOpenFolder,
      onSelect: () => onOpenBuiltin?.(),
    });
  if (onOpenPatterns)
    items.push({
      id: 'open-patterns',
      action: bindWorkspaceAction(actionSource, 'workspace.open-patterns'),
      label: zh ? '文档编写推荐库' : 'Document authoring recommendations',
      icon: FolderOpen,
      testId: 'workspace-open-patterns',
      onSelect: onOpenPatterns,
    });
  for (const [index, entry] of history.entries()) {
    const current = entry.id === currentHistoryId;
    items.push({
      id: `history-${entry.id}`,
      action: bindWorkspaceAction(actionSource, 'workspace.open-history', {
        historyId: entry.id,
      }),
      label: `${entry.name}${entry.description ? ` · ${entry.description}` : ''}${current ? (zh ? '（当前）' : ' (current)') : ''}`,
      title: `${entry.name}${entry.description ? ` · ${entry.description}` : ''}`,
      icon: History,
      groupLabel:
        index === 0 ? (zh ? '已打开的工作区' : 'Opened workspaces') : undefined,
      disabled: current || switching,
      testId: `workspace-history-${entry.id}`,
      onSelect: () => onOpenHistory?.(entry.id),
    });
  }
  return (
    <div className="workspace-sidebar-header">
      <WorkspaceButton
        intent="ghost"
        type="button"
        className="workspace-menu-trigger"
        data-testid="workspace-menu-trigger"
        ref={(element) => {
          button.current = element;
          if (typeof triggerRef === 'function') triggerRef(element);
          else if (triggerRef) triggerRef.current = element;
        }}
        title={name}
        aria-label={`${zh ? `工作区菜单：${name}` : `Workspace menu: ${name}`}${updatesAvailable ? (zh ? '，内置内容有更新' : ', built-in content updates available') : ''}`}
        aria-haspopup={onSwitch ? 'dialog' : 'menu'}
        aria-expanded={onSwitch ? switcherOpen : open}
        disabled={switching}
        onClick={() => {
          if (onSwitch) {
            onSwitch();
            return;
          }
          if (!open) onRefreshHistory?.();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (onSwitch) {
              onSwitch();
              return;
            }
            if (!open) onRefreshHistory?.();
            setOpen(true);
          }
        }}
      >
        <span className="workspace-menu-name">
          {name}
          {updatesAvailable && !onUpdate && (
            <span
              className="vm-dot"
              title={
                zh ? '内置内容有更新' : 'Built-in content updates available'
              }
              aria-hidden
            />
          )}
        </span>
        <ChevronDown strokeWidth={1.75} size={14} aria-hidden />
      </WorkspaceButton>
      {updatesAvailable && onUpdate && (
        <WorkspaceButton
          type="button"
          className="workspace-button-ghost workspace-content-update"
          data-testid="workspace-content-update"
          title={zh ? '系统内置内容有更新' : 'Bundled content update available'}
          aria-label={zh ? '查看内置内容更新' : 'View bundled content update'}
          onClick={onUpdate}
        >
          <span className="vm-dot" aria-hidden />
        </WorkspaceButton>
      )}
      {trailing}
      {open && button.current && (
        <FileTreeMenu
          className="workspace-switch-menu"
          label={zh ? '工作区' : 'Workspace'}
          anchor={button.current}
          placement="bottom-start"
          items={items}
          actionSource={actionSource}
          preserveItemLabels
          locale={locale}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
