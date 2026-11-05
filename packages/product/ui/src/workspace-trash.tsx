import './workspace-trash.scss';
import { useId, useMemo, useRef, useState } from 'react';
import { FileArchive, RotateCcw, Trash2 } from 'lucide-react';
import { useActionSource, type ActionSource } from '@sue/board-react-actions';
import {
  bindWorkspaceAction,
  type WorkspaceActionBinding,
} from './workspace-action-bindings';
import { WorkspaceActionConfirmation } from './workspace-action-confirmation';
import {
  WorkspaceAlert,
  WorkspaceButton,
  WorkspaceEmptyState,
  WorkspaceTag,
} from './workspace-design';

export interface WorkspaceTrashEntry {
  entryId: string;
  originalPath: string;
  trashedAt: number;
}

export interface WorkspaceTrashProps {
  actionSource?: ActionSource;
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
  actionSource,
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
  useActionSource(actionSource);
  const binding = (id: string, args?: unknown) =>
    bindWorkspaceAction(actionSource, id, args);
  const call = async (
    id: string,
    args: unknown,
    fallback: () => void | Promise<void>,
  ) => {
    if (!actionSource) return fallback();
    const result = await binding(id, args)?.execute();
    if (!result || 'code' in result)
      throw new Error(
        result && 'code' in result
          ? (result.message ?? result.code)
          : 'unknown-action',
      );
  };
  const visible = (id: string, args?: unknown) =>
    actionSource ? !!binding(id, args)?.getState().visible : !readonly;
  const disabled = (id: string, args?: unknown) =>
    busy ||
    readonly ||
    (actionSource
      ? !binding(id, args)?.getState().enabled
      : id !== 'workspace.trash.retry' && unconfirmed);
  const label = (id: string, fallback: string) =>
    binding(id)?.label(locale) ?? fallback;
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
    purge?: WorkspaceActionBinding;
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
    setConfirmation({
      title,
      entryIds,
      purge: binding('workspace.trash.purge', { entryIds }),
    });
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
            <WorkspaceTag data-testid="workspace-trash-count">
              {entries.length}
            </WorkspaceTag>
          </h2>
          <p className="workspace-trash-scope">
            {t.scope}
            {zh ? '：' : ': '}
            {workspaceName}
          </p>
        </div>
        {visible('workspace.trash.confirm-clear', {
          entryIds: entries.map((entry) => entry.entryId),
        }) && (
          <WorkspaceButton
            type="button"
            danger
            icon={<Trash2 strokeWidth={1.75} size={16} aria-hidden />}
            data-action-id="workspace.trash.confirm-clear"
            disabled={
              disabled('workspace.trash.confirm-clear', {
                entryIds: entries.map((entry) => entry.entryId),
              }) || !entries.length
            }
            onClick={() =>
              void call(
                'workspace.trash.confirm-clear',
                {
                  entryIds: entries.map((entry) => entry.entryId),
                  present: () =>
                    confirmPurge(
                      entries.map((entry) => entry.entryId),
                      `${t.clear} (${entries.length})`,
                    ),
                },
                () =>
                  confirmPurge(
                    entries.map((entry) => entry.entryId),
                    `${t.clear} (${entries.length})`,
                  ),
              )
            }
          >
            {label('workspace.trash.confirm-clear', t.clear)}
          </WorkspaceButton>
        )}
      </div>
      {(actionSource
        ? binding('workspace.trash.purge', {
            entryIds: entries.map((entry) => entry.entryId),
          })?.getState().reason === 'readonly'
        : readonly) && <p>{t.readonly}</p>}
      {unconfirmed && (
        <WorkspaceAlert
          type="warning"
          role="alert"
          title={t.unconfirmed}
          action={
            visible('workspace.trash.retry') &&
            onRetry && (
              <WorkspaceButton
                type="button"
                data-action-id="workspace.trash.retry"
                disabled={disabled('workspace.trash.retry')}
                onClick={() =>
                  void perform(() =>
                    call('workspace.trash.retry', undefined, onRetry),
                  )
                }
              >
                {label('workspace.trash.retry', t.retry)}
              </WorkspaceButton>
            )
          }
        />
      )}
      {!entries.length ? (
        <div className="workspace-trash-empty">
          <WorkspaceEmptyState
            image={WorkspaceEmptyState.PRESENTED_IMAGE_SIMPLE}
            description={t.empty}
          />
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
                    <FileArchive strokeWidth={1.75} size={18} aria-hidden />
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
                  {visible('workspace.trash.restore', {
                    entryId: entry.entryId,
                  }) && (
                    <div className="workspace-trash-actions">
                      <WorkspaceButton
                        type="button"
                        icon={
                          <RotateCcw strokeWidth={1.75} size={15} aria-hidden />
                        }
                        data-action-id="workspace.trash.restore"
                        disabled={disabled('workspace.trash.restore', {
                          entryId: entry.entryId,
                        })}
                        aria-label={`${label('workspace.trash.restore', t.restore)} ${name}`}
                        onClick={() =>
                          void perform(() =>
                            call(
                              'workspace.trash.restore',
                              { entryId: entry.entryId },
                              () => onRestore(entry.entryId),
                            ),
                          )
                        }
                      >
                        {label('workspace.trash.restore', t.restore)}
                      </WorkspaceButton>
                      <WorkspaceButton
                        type="button"
                        danger
                        icon={
                          <Trash2 strokeWidth={1.75} size={15} aria-hidden />
                        }
                        data-action-id="workspace.trash.confirm-purge"
                        disabled={disabled('workspace.trash.confirm-purge', {
                          entryIds: [entry.entryId],
                        })}
                        aria-label={`${label('workspace.trash.confirm-purge', t.purge)} ${name}`}
                        onClick={() =>
                          void call(
                            'workspace.trash.confirm-purge',
                            {
                              entryIds: [entry.entryId],
                              present: () =>
                                confirmPurge(
                                  [entry.entryId],
                                  `${t.purge} ${name}`,
                                ),
                            },
                            () =>
                              confirmPurge(
                                [entry.entryId],
                                `${t.purge} ${name}`,
                              ),
                          )
                        }
                      >
                        {label('workspace.trash.confirm-purge', t.purge)}
                      </WorkspaceButton>
                    </div>
                  )}
                </li>
              );
            })}
        </ul>
      )}
      {error && !confirmation && (
        <WorkspaceAlert type="error" role="alert" title={error} />
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
            if (actionSource)
              void perform(async () => {
                const result = await confirmation.purge?.execute();
                if (!result || 'code' in result)
                  throw new Error(
                    result && 'code' in result
                      ? (result.message ?? result.code)
                      : 'unknown-action',
                  );
              }, true);
            else if (!readonly)
              void perform(() => onPurge(confirmation.entryIds), true);
          }}
        />
      )}
    </section>
  );
}
