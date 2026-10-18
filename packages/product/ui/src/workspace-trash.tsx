import './workspace-trash.scss';
import { useId, useMemo, useRef, useState } from 'react';
import { FileArchive, RotateCcw, Trash2 } from 'lucide-react';
import { WorkspaceActionConfirmation } from './workspace-action-confirmation';

export interface WorkspaceTrashEntry {
  entryId: string;
  originalPath: string;
  trashedAt: number;
}

export interface WorkspaceTrashProps {
  entries: WorkspaceTrashEntry[];
  workspaceName: string;
  locale?: 'zh' | 'en';
  readonly?: boolean;
  unconfirmed?: boolean;
  onRestore(entryId: string): void | Promise<void>;
  onPurge(entryIds: string[]): Promise<void>;
  onRetry?(): Promise<void>;
  onBusyChange?(busy: boolean): void;
}

export function WorkspaceTrash({
  entries,
  workspaceName,
  locale = 'zh',
  readonly = false,
  unconfirmed = false,
  onRestore,
  onPurge,
  onRetry,
  onBusyChange,
}: WorkspaceTrashProps) {
  const zh = locale === 'zh';
  const titleId = useId();
  const t = zh
    ? {
        title: '回收站',
        empty: '回收站为空',
        restore: '还原',
        purge: '永久删除',
        clear: '清空回收站',
        scope: '当前工作区',
        confirm: '确定',
        cancel: '取消',
        processing: '处理中…',
        irreversible: '永久删除后无法恢复，相关撤销记录也会移除。',
        unconfirmed: '操作结果尚未确认，请重试后继续。',
        retry: '重试',
        readonly: '当前工作区为只读，无法修改回收站。',
      }
    : {
        title: 'Trash',
        empty: 'Trash is empty',
        restore: 'Restore',
        purge: 'Delete permanently',
        clear: 'Empty trash',
        scope: 'Current workspace',
        confirm: 'OK',
        cancel: 'Cancel',
        processing: 'Processing…',
        irreversible:
          'This cannot be undone. Related undo history will also be removed.',
        unconfirmed: 'The operation is unconfirmed. Retry before continuing.',
        retry: 'Retry',
        readonly: 'This workspace is read-only. Trash cannot be modified.',
      };
  const [confirmation, setConfirmation] = useState<{
    title: string;
    entryIds: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const perform = async (action: () => void | Promise<void>, close = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      await action();
      if (close) setConfirmation(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  };
  const confirmPurge = (entryIds: string[], title: string) => {
    setError('');
    setConfirmation({ title, entryIds });
  };
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [zh],
  );
  const date = (timestamp: number) =>
    Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp).getTime())
      ? formatter.format(timestamp)
      : '—';
  return (
    <section
      className="workspace-trash"
      data-testid="workspace-trash"
      aria-labelledby={titleId}
    >
      <div className="workspace-trash-heading">
        <div>
          <h2 id={titleId}>
            {t.title}{' '}
            <span
              className="workspace-trash-count"
              data-testid="workspace-trash-count"
            >
              {entries.length}
            </span>
          </h2>
          <p className="workspace-trash-scope">
            {t.scope}
            {zh ? '：' : ': '}
            {workspaceName}
          </p>
        </div>
        {!readonly && (
          <button
            type="button"
            className="workspace-trash-clear"
            disabled={busy || unconfirmed || !entries.length}
            onClick={() =>
              confirmPurge(
                entries.map((entry) => entry.entryId),
                `${t.clear} (${entries.length})`,
              )
            }
          >
            <Trash2 size={16} aria-hidden />
            {t.clear}
          </button>
        )}
      </div>
      {readonly && <p>{t.readonly}</p>}
      {unconfirmed && (
        <div className="workspace-trash-error" role="alert">
          <p>{t.unconfirmed}</p>
          {!readonly && onRetry && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void perform(onRetry)}
            >
              {t.retry}
            </button>
          )}
        </div>
      )}
      {!entries.length ? (
        <div className="workspace-trash-empty">
          <Trash2 size={32} aria-hidden />
          <p>{t.empty}</p>
        </div>
      ) : (
        <ul className="workspace-trash-list">
          {[...entries]
            .sort((a, b) => b.trashedAt - a.trashedAt)
            .map((entry) => {
              const name =
                entry.originalPath.split('/').pop() ?? entry.originalPath;
              return (
                <li key={entry.entryId} className="workspace-trash-row">
                  <div className="workspace-trash-file">
                    <FileArchive size={18} aria-hidden />
                    <div>
                      <strong title={name}>{name}</strong>
                      <span title={entry.originalPath}>
                        {entry.originalPath}
                      </span>
                    </div>
                  </div>
                  <time
                    className="workspace-trash-date"
                    dateTime={
                      Number.isFinite(entry.trashedAt) &&
                      !Number.isNaN(new Date(entry.trashedAt).getTime())
                        ? new Date(entry.trashedAt).toISOString()
                        : undefined
                    }
                  >
                    {date(entry.trashedAt)}
                  </time>
                  {!readonly && (
                    <div className="workspace-trash-actions">
                      <button
                        type="button"
                        disabled={busy || unconfirmed}
                        aria-label={`${t.restore} ${name}`}
                        onClick={() =>
                          void perform(() => onRestore(entry.entryId))
                        }
                      >
                        <RotateCcw size={15} aria-hidden />
                        {t.restore}
                      </button>
                      <button
                        type="button"
                        className="workspace-trash-purge"
                        disabled={busy || unconfirmed}
                        aria-label={`${t.purge} ${name}`}
                        onClick={() =>
                          confirmPurge([entry.entryId], `${t.purge} ${name}`)
                        }
                      >
                        <Trash2 size={15} aria-hidden />
                        {t.purge}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
        </ul>
      )}
      {error && !confirmation && (
        <p className="workspace-trash-error" role="alert">
          {error}
        </p>
      )}
      {confirmation && (
        <WorkspaceActionConfirmation
          title={confirmation.title}
          message={t.irreversible}
          confirm={busy ? t.processing : t.confirm}
          cancel={t.cancel}
          busy={busy}
          error={error}
          onClose={() => {
            setConfirmation(null);
            setError('');
          }}
          onConfirm={() => {
            if (!readonly)
              void perform(() => onPurge(confirmation.entryIds), true);
          }}
        />
      )}
    </section>
  );
}
