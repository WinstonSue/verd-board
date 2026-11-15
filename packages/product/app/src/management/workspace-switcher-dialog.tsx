import { useState } from 'react';
import { VmDialog, IconButton } from '@sue/verd-board-ui';
import {
  BookOpen,
  FolderOpen,
  House,
  Plus,
  Search,
  Settings,
  Star,
  X,
} from 'lucide-react';
import type { WorkspaceHistoryEntry } from '@sue/verd-board-workspace';
export interface WorkspaceSwitcherDialogProps {
  locale: 'zh' | 'en';
  isDefault?: boolean;
  name: string;
  currentHistoryId?: string;
  history: WorkspaceHistoryEntry[];
  busy?: boolean;
  error?: string;
  onClose(): void;
  onHistory(id: string): void;
  onUpdateHistory?(
    id: string,
    patch: { pinned?: boolean; remove?: boolean },
  ): void;
  onCreate?(): void;
  onOpenFolder?(): void;
  onOpenBuiltin?(): void;
  onOpenPatterns?(): void;
  onSettings(): void;
}
export function WorkspaceSwitcherDialog(p: WorkspaceSwitcherDialogProps) {
  const zh = p.locale === 'zh';
  const t = (a: string, b: string) => (zh ? a : b);
  const [query, setQuery] = useState('');
  const current = p.history.find((h) => h.id === p.currentHistoryId);
  const rows = [
    current ?? { id: p.currentHistoryId ?? 'current', name: p.name },
    ...p.history
      .filter((h) => h.id !== p.currentHistoryId)
      .filter((h) =>
        `${h.name} ${h.description ?? ''}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          b.lastOpenedAt - a.lastOpenedAt,
      ),
  ];
  return (
    <VmDialog
      title={t('工作区', 'Workspaces')}
      closeLabel={t('关闭', 'Close')}
      busy={p.busy}
      onClose={p.onClose}
      className="workspace-switcher-dialog"
      data-testid="workspace-switcher-dialog"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
          return;
        if (
          event.target instanceof HTMLInputElement &&
          !event.key.startsWith('Arrow')
        )
          return;
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            '.workspace-switcher-name:not(:disabled), .workspace-switcher-operation:not(:disabled)',
          ),
        ];
        if (!buttons.length) return;
        event.preventDefault();
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : event.key === 'ArrowDown'
                ? (at + 1) % buttons.length
                : (Math.max(at, 0) + buttons.length - 1) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      <label className="vm-search workspace-switcher-search">
        <Search
          strokeWidth={1.75}
          className="vm-search__icon"
          size={16}
          aria-hidden
        />
        <input
          className="vm-input vm-input--search"
          type="search"
          aria-label={t('查找工作区', 'Find workspace')}
          placeholder={t('搜索工作区', 'Search workspaces')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="workspace-switcher-section">
        <h3 className="vm-section-label workspace-switcher-label">
          {t('最近打开', 'Recently opened')}
        </h3>
        {rows.map((h, index) => {
          const currentRow = index === 0;
          const entry = p.history.find((e) => e.id === h.id);
          const unavailable =
            entry?.availability && entry.availability !== 'available';
          return (
            <div
              className="workspace-switcher-item workspace-switcher-row"
              key={h.id}
              aria-current={currentRow ? 'true' : undefined}
            >
              <button
                type="button"
                className="workspace-switcher-name"
                data-testid={`workspace-history-${h.id}`}
                disabled={p.busy || currentRow}
                onClick={() => p.onHistory(h.id)}
              >
                <FolderOpen strokeWidth={1.75} size={16} aria-hidden />
                <span className="workspace-switcher-copy">
                  <span className="workspace-switcher-title">
                    <span className="workspace-switcher-text" title={h.name}>
                      {h.name}
                    </span>
                    {currentRow && (
                      <span className="vm-badge">{t('当前', 'Current')}</span>
                    )}
                    {unavailable && (
                      <span className="vm-badge">
                        {t('不可用', 'Unavailable')}
                      </span>
                    )}
                  </span>
                  {entry?.description && <small>{entry.description}</small>}
                </span>
              </button>

              {p.onUpdateHistory && entry && (
                <span className="workspace-switcher-actions">
                  <IconButton
                    icon={Star}
                    aria-label={
                      entry.pinned
                        ? t('取消置顶', 'Unpin workspace')
                        : t('置顶', 'Pin workspace')
                    }
                    aria-pressed={!!entry.pinned}
                    disabled={p.busy}
                    onClick={() =>
                      p.onUpdateHistory?.(h.id, { pinned: !entry.pinned })
                    }
                  />
                  <IconButton
                    icon={X}
                    aria-label={t('移除记录', 'Remove record')}
                    disabled={p.busy || currentRow}
                    onClick={() => p.onUpdateHistory?.(h.id, { remove: true })}
                  />
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="workspace-switcher-section">
        <h3 className="vm-section-label workspace-switcher-label">
          {t('工作区操作', 'Workspace actions')}
        </h3>
        {[
          {
            icon: Plus,
            label: t('新建工作区', 'Create workspace'),
            run: p.onCreate,
          },
          {
            icon: FolderOpen,
            label: t('打开工作区文件夹', 'Open workspace folder'),
            run: p.onOpenFolder,
            testId: 'workspace-open-folder',
          },
          {
            icon: House,
            label: t('打开系统介绍', 'Open system introduction'),
            run: p.onOpenBuiltin,
            disabled: p.isDefault,
            testId: 'workspace-open-builtin',
          },
          {
            icon: BookOpen,
            label: t(
              '打开 文档编写推荐库',
              'Open Document authoring recommendations',
            ),
            run: p.onOpenPatterns,
            testId: 'workspace-open-patterns',
          },
          {
            icon: Settings,
            label: t('工作区设置', 'Workspace settings'),
            run: p.onSettings,
            testId: 'workspace-open-settings',
          },
        ]
          .filter((a) => a.run)
          .map((a) => (
            <button
              type="button"
              className="workspace-switcher-item workspace-switcher-operation"
              key={a.label}
              data-testid={a.testId}
              disabled={p.busy || a.disabled}
              onClick={a.run}
            >
              <a.icon size={16} aria-hidden />
              <span className="workspace-switcher-text">{a.label}</span>
            </button>
          ))}
      </div>
      {p.error && <p role="alert">{p.error}</p>}
    </VmDialog>
  );
}
