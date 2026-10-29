import { useEffect, useRef, useState, type Ref } from 'react';
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
  actionSource?: ActionSource;
  name: string;
  locale?: 'zh' | 'en';
  switching?: boolean;
  isDefault?: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
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
  actionSource,
  name,
  locale = 'zh',
  switching = false,
  isDefault = false,
  triggerRef,
  onSettings,
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
      label: zh ? '回到内置工作区' : 'Open built-in workspace',
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
      label: zh ? 'Agent 范式库' : 'Agent pattern library',
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
      <button
        type="button"
        className="workspace-menu-trigger"
        data-testid="workspace-menu-trigger"
        ref={(element) => {
          button.current = element;
          if (typeof triggerRef === 'function') triggerRef(element);
          else if (triggerRef) triggerRef.current = element;
        }}
        title={name}
        aria-label={zh ? `工作区菜单：${name}` : `Workspace menu: ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={switching}
        onClick={() => {
          if (!open) onRefreshHistory?.();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!open) onRefreshHistory?.();
            setOpen(true);
          }
        }}
      >
        <span className="workspace-menu-name">{name}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
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
