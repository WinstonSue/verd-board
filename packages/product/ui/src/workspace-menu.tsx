import { useEffect, useRef, useState, type Ref } from 'react';
import { ChevronDown, FolderOpen, House, Settings } from 'lucide-react';
import { FileTreeMenu, type FileTreeMenuItem } from './file-tree-menu';

export interface WorkspaceMenuProps {
  name: string;
  locale?: 'zh' | 'en';
  switching?: boolean;
  isDefault?: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
  onSettings(): void;
  onOpenFolder?(): void;
  onOpenBuiltin?(): void;
}

export function WorkspaceMenu({
  name,
  locale = 'zh',
  switching = false,
  isDefault = false,
  triggerRef,
  onSettings,
  onOpenFolder,
  onOpenBuiltin,
}: WorkspaceMenuProps) {
  const button = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const zh = locale === 'zh';
  useEffect(() => {
    setOpen(false);
  }, [name, switching]);
  const items: FileTreeMenuItem[] = [
    {
      id: 'settings',
      label: zh ? '工作区设置' : 'Workspace settings',
      icon: Settings,
      testId: 'workspace-open-settings',
      onSelect: onSettings,
    },
  ];
  if (onOpenFolder)
    items.push({
      id: 'open-folder',
      label: zh ? '打开工作区文件夹' : 'Open workspace folder',
      icon: FolderOpen,
      testId: 'workspace-open-folder',
      groupStart: true,
      onSelect: onOpenFolder,
    });
  if (onOpenBuiltin)
    items.push({
      id: 'open-builtin',
      label: zh ? '回到内置工作区' : 'Open built-in workspace',
      icon: House,
      testId: 'workspace-open-builtin',
      disabled: isDefault,
      groupStart: !onOpenFolder,
      onSelect: onOpenBuiltin,
    });
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
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="workspace-menu-name">{name}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && button.current && (
        <FileTreeMenu
          label={zh ? '工作区' : 'Workspace'}
          anchor={button.current}
          placement="bottom-start"
          items={items}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
