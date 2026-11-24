import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { IconButton } from '@sue/verd-board-ui';
import { FolderOpen, Pin, PinOff, Plus, Settings, X } from 'lucide-react';
import type { ActionResult } from '@sue/board-common';
import type { WorkspaceHistoryEntry } from '@sue/verd-board-workspace';

export function myWorkspaceEntries(
  history: WorkspaceHistoryEntry[],
  locale: 'zh' | 'en',
) {
  return history
    .filter((entry) => entry.kind !== 'agent-patterns')
    .sort(
      (a, b) =>
        Number(!!b.pinned) - Number(!!a.pinned) ||
        a.name.localeCompare(b.name, locale) ||
        (a.description ?? '').localeCompare(b.description ?? '', locale),
    );
}

interface WorkspaceSwitcherProps {
  locale: 'zh' | 'en';
  name: string;
  readonly?: boolean;
  currentHistoryId?: string;
  history: WorkspaceHistoryEntry[];
  switching: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onRefreshHistory(): void;
  onHistory(id: string): Promise<ActionResult>;
  onUpdateHistory?(
    id: string,
    patch: { pinned?: boolean; remove?: boolean },
  ): Promise<void>;
  onCreate?(): void;
  onOpenFolder?(): void;
  onSettings(): void;
}

const rowSelector =
  '.workspace-switcher-name:enabled, .workspace-switcher-operation:enabled';

export function WorkspaceSwitcher(p: WorkspaceSwitcherProps) {
  const t = (a: string, b: string) => (p.locale === 'zh' ? a : b);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const focusRow = useRef(false);
  const panelId = useId();
  const labelId = useId();
  const rows = myWorkspaceEntries(p.history, p.locale);
  const blocked = busy || p.switching;
  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) p.triggerRef.current?.focus();
  };
  const show = (focus: boolean) => {
    focusRow.current = focus;
    setError('');
    setOpen(true);
    p.onRefreshHistory();
  };
  useEffect(() => {
    if (!open) return;
    if (focusRow.current) {
      focusRow.current = false;
      root.current?.querySelector<HTMLButtonElement>(rowSelector)?.focus();
    }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      ref={root}
      className="workspace-switcher"
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          close(false);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (open && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close(true);
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
          return;
        if (!open) {
          if (event.key === 'ArrowDown' && !blocked) {
            event.preventDefault();
            show(true);
          }
          return;
        }
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            rowSelector,
          ),
        ];
        if (!buttons.length) return;
        event.preventDefault();
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End' || (index < 0 && event.key === 'ArrowUp')
              ? buttons.length - 1
              : (index +
                  (event.key === 'ArrowDown' ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }}
    >
      <div className="workspace-sidebar-header">
        <button
          ref={p.triggerRef}
          type="button"
          className="workspace-menu-trigger"
          data-testid="workspace-menu-trigger"
          aria-expanded={open}
          aria-controls={panelId}
          title={p.name}
          onClick={() => (open ? close(false) : show(false))}
        >
          <span className="workspace-menu-name">{p.name}</span>
        </button>
        {p.readonly && (
          <span
            className="workspace-readonly-label"
            data-testid="workspace-readonly"
          >
            {t('只读', 'Read only')}
          </span>
        )}
      </div>
      <div
        id={panelId}
        hidden={!open}
        aria-labelledby={labelId}
        role="region"
        className="workspace-switcher-panel"
        data-testid="workspace-switcher"
        aria-busy={blocked}
      >
        <h2 id={labelId} className="vm-section-label workspace-switcher-label">
          {t('我的工作区', 'My workspaces')}
        </h2>
        <div className="workspace-switcher-section">
          {rows.map((entry) => {
            const current = entry.id === p.currentHistoryId;
            const unavailable =
              !!entry.availability && entry.availability !== 'available';
            return (
              <div
                className="workspace-switcher-item workspace-switcher-row"
                key={entry.id}
                aria-current={current ? 'true' : undefined}
              >
                <button
                  type="button"
                  className="workspace-switcher-name"
                  data-testid={`workspace-history-${entry.id}`}
                  disabled={current}
                  aria-disabled={blocked || undefined}
                  onClick={(event) => {
                    if (blocked || current) return;
                    const row = event.currentTarget;
                    void perform(async () => {
                      const result = await p.onHistory(entry.id);
                      if (
                        result.status === 'completed' ||
                        result.status === 'noop'
                      )
                        close(true);
                      else {
                        row.focus();
                        if (
                          result.status === 'failed' ||
                          result.status === 'rejected'
                        )
                          setError(result.message ?? result.code);
                      }
                    });
                  }}
                >
                  <FolderOpen strokeWidth={1.75} size={16} aria-hidden />
                  <span className="workspace-switcher-copy">
                    <span className="workspace-switcher-title">
                      <span
                        className="workspace-switcher-text"
                        title={entry.name}
                      >
                        {entry.name}
                      </span>
                      {current && (
                        <span className="vm-badge">{t('当前', 'Current')}</span>
                      )}
                      {unavailable && (
                        <span className="vm-badge">
                          {t('不可用', 'Unavailable')}
                        </span>
                      )}
                    </span>
                    {entry.description && (
                      <small title={entry.description}>
                        {entry.description}
                      </small>
                    )}
                  </span>
                </button>
                {p.onUpdateHistory && (
                  <span className="workspace-switcher-actions">
                    <IconButton
                      icon={entry.pinned ? PinOff : Pin}
                      aria-label={
                        entry.pinned
                          ? t('取消置顶', 'Unpin workspace')
                          : t('置顶', 'Pin workspace')
                      }
                      aria-pressed={!!entry.pinned}
                      disabled={blocked}
                      onClick={() =>
                        void perform(() =>
                          p.onUpdateHistory!(entry.id, {
                            pinned: !entry.pinned,
                          }),
                        )
                      }
                    />
                    <IconButton
                      icon={X}
                      aria-label={t('移除记录', 'Remove record')}
                      disabled={blocked || current}
                      onClick={() =>
                        void perform(() =>
                          p.onUpdateHistory!(entry.id, { remove: true }),
                        )
                      }
                    />
                  </span>
                )}
              </div>
            );
          })}
          {!rows.length && (
            <p className="workspace-switcher-label">
              {t('暂无工作区', 'No workspaces yet')}
            </p>
          )}
        </div>
        <div className="workspace-switcher-operations">
          {[
            {
              icon: Plus,
              label: t('新建工作区', 'Create workspace'),
              run: p.onCreate,
            },
            {
              icon: FolderOpen,
              label: t('导入工作区', 'Import workspace'),
              run: p.onOpenFolder,
              testId: 'workspace-open-folder',
            },
            {
              icon: Settings,
              label: t('工作区设置', 'Workspace settings'),
              run: p.onSettings,
              testId: 'workspace-open-settings',
            },
          ].map(
            ({ icon: Icon, label, run, testId }) =>
              run && (
                <button
                  type="button"
                  className="workspace-switcher-item workspace-switcher-operation"
                  key={label}
                  data-testid={testId}
                  disabled={blocked}
                  onClick={() => {
                    close(true);
                    run();
                  }}
                >
                  <Icon strokeWidth={1.75} size={16} aria-hidden />
                  <span className="workspace-switcher-text">{label}</span>
                </button>
              ),
          )}
        </div>
        {error && (
          <p className="workspace-switcher-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
