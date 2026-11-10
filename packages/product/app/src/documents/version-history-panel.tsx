import { useEffect, useRef, useState } from 'react';
import {
  WorkspaceAlert,
  WorkspaceButton,
  WorkspaceEmptyState,
  WorkspaceInput,
} from '@sue/verd-board-ui';
import {
  VersionError,
  type VersionScope,
  type VersionStatus,
  type VersionPlan,
  type ContentVersion,
  type VersionFile,
} from '../host/workspace-versions';
import type { WorkspaceSession } from '../session/workspace-session';
import { ContentVersionPreview } from './version-preview';

export interface VersionHistoryPanelProps {
  session: WorkspaceSession;
  scope: VersionScope;
  readonly?: boolean;
  locale?: 'zh' | 'en';
  onSettings?(): void;
  onBusyChange?(busy: boolean): void;
  purgeEntryIds?: string[];
}
export function VersionHistoryPanel({
  session,
  scope,
  readonly = false,
  locale = 'zh',
  onSettings,
  onBusyChange,
  purgeEntryIds,
}: VersionHistoryPanelProps) {
  const t = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const [status, setStatus] = useState<VersionStatus>();
  const [versions, setVersions] = useState<ContentVersion[]>([]);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [plan, setPlan] = useState<VersionPlan>();
  const [preview, setPreview] = useState<{
    version: ContentVersion;
    files: VersionFile[];
  }>();
  const generation = useRef(0),
    running = useRef(false);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const scopeKey = JSON.stringify(scope);
  const load = async (epoch: number) => {
    const result = await session.versions({ type: 'status' });
    if (generation.current !== epoch) return;
    setStatus(result.status);
    if (result.status.enabled) {
      const history = await session.versions({
        type: 'list',
        scope,
        limit: 30,
      });
      if (generation.current === epoch) setVersions(history.versions ?? []);
    } else setVersions([]);
  };
  const perform = (action: (epoch: number) => Promise<void>): Promise<void> => {
    if (running.current) return pending.current;
    running.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    setNotice('');
    const epoch = generation.current;
    const operation = (async () => {
      try {
        await action(epoch);
      } catch (cause) {
        if (generation.current === epoch) {
          const messages = {
            'stale-plan': t(
              '内容已变化，请刷新并重新预览。',
              'Content changed. Refresh and preview again.',
            ),
            'dirty-target': t(
              '请先为受影响内容创建版本，再恢复。',
              'Create a version of affected changes before restoring.',
            ),
            'scope-collision': t(
              '目标路径或内容身份存在冲突。请检查目录外的同一内容和被占用的路径。',
              'A target path or identity conflicts. Check occupied paths and matching content outside this scope.',
            ),
            'missing-dependency': t(
              '所需引用或附件尚未纳入版本，请一并选择必要内容。',
              'Required references or attachments are missing. Include the necessary content.',
            ),
            unsupported: t(
              '当前版本服务无法完成此操作，请前往版本设置查看详情。',
              'The version service could not complete this operation. Check version settings.',
            ),
            'needs-settings': t(
              '版本服务需要配置，请前往版本设置。',
              'Configure the service in version settings.',
            ),
          };
          setError(
            cause instanceof VersionError
              ? messages[cause.code]
              : t(
                  '版本操作未完成，请刷新后重试或前往版本设置。',
                  'Version operation did not complete. Refresh or open version settings.',
                ),
          );
        }
      } finally {
        running.current = false;
        if (generation.current === epoch) {
          setBusy(false);
          onBusyChange?.(false);
        }
      }
    })();
    pending.current = operation;
    return operation;
  };
  useEffect(() => {
    const epoch = ++generation.current;
    setStatus(undefined);
    setVersions([]);
    setPlan(undefined);
    setPreview(undefined);
    setSelected([]);
    setError('');
    void pending.current.then(() => {
      if (generation.current === epoch)
        return perform(async () => {
          await load(epoch);
        });
      return undefined;
    });
    return () => {
      generation.current++;
      onBusyChange?.(false);
    };
    // Scope identity owns requests and drafts.
  }, [session, scopeKey]);
  const inScope = (path: string) =>
    scope.kind === 'workspace' ||
    (scope.kind === 'directory'
      ? path.startsWith(scope.path + '/')
      : path ===
        (scope.path ??
          session.getState().documents.get(scope.fileId!)?.path ??
          session.getState().files.get(scope.fileId!)?.path));
  const changes = status?.changes.filter((c) => inScope(c.path)) ?? [];
  const locked = readonly || busy;
  const executePlan = async (next: VersionPlan, epoch: number) => {
    const result = await session.versions({
      type:
        next.kind === 'create'
          ? 'create'
          : next.kind === 'purge'
            ? 'purge'
            : 'restore',
      planId: next.id,
      expectedToken: next.token,
    });
    if (epoch !== generation.current) return;
    setStatus(result.status);
    setPlan(undefined);
    setPreview(undefined);
    setMessage('');
    setSelected([]);
    await load(epoch);
    setNotice(
      next.kind === 'create'
        ? t('版本已创建', 'Version created')
        : next.kind === 'purge'
          ? t(
              '清理已执行，请在设置中检查后续处理状态。',
              'Cleanup executed. Check follow-up status in settings.',
            )
          : t(
              '已恢复，结果尚未创建版本。',
              'Restored. The changes have not been saved as a version.',
            ),
    );
  };
  const create = (paths?: string[]) =>
    perform(async (epoch) => {
      const result = await session.versions({
        type: 'create-plan',
        scope,
        paths,
        message: message.trim() || t('更新内容', 'Update content'),
      });
      if (epoch !== generation.current) return;
      if (result.plan?.requiresReview) setPlan(result.plan);
      else if (result.plan) await executePlan(result.plan, epoch);
    });
  return (
    <section
      className="workspace-git-panel workspace-version-panel"
      data-testid="version-history-panel"
      aria-busy={busy}
    >
      <div className="workspace-git-heading">
        <strong>{t('版本历史', 'Version history')}</strong>
        <WorkspaceButton disabled={busy} onClick={() => void perform(load)}>
          {t('刷新', 'Refresh')}
        </WorkspaceButton>
      </div>
      {error && <WorkspaceAlert type="error" title={error} role="alert" />}
      {notice && <p role="status">{notice}</p>}
      {(!status?.enabled || status.attention || error) && (
        <div>
          <p>
            {!status
              ? t('正在加载版本…', 'Loading versions…')
              : !status.enabled
                ? t(
                    '尚未启用版本历史。',
                    'Version history has not been enabled.',
                  )
                : t('版本服务需要处理。', 'Version service needs attention.')}
          </p>
          {onSettings && (
            <WorkspaceButton disabled={busy} onClick={onSettings}>
              {t('前往版本设置', 'Open version settings')}
            </WorkspaceButton>
          )}
        </div>
      )}
      {status?.enabled && (
        <>
          {scope.kind === 'directory' &&
            !scope.folderId &&
            !versions.length && (
              <p>
                {t(
                  '目录历史从首次创建目录版本起保持连续。',
                  'Directory history follows its identity from the first directory version.',
                )}
              </p>
            )}
          <h3>{t('尚未创建版本的更改', 'Changes without a version')}</h3>
          <ul className="workspace-git-changes">
            {changes.map((change) => (
              <li key={change.path}>
                {scope.kind === 'workspace' && (
                  <input
                    type="checkbox"
                    aria-label={change.path}
                    checked={selected.includes(change.path)}
                    disabled={locked}
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, change.path]
                          : old.filter((p) => p !== change.path),
                      )
                    }
                  />
                )}
                <span>{change.path}</span>
              </li>
            ))}
          </ul>
          <label>
            {t('版本说明', 'Version description')}
            <WorkspaceInput
              aria-label={t('版本说明', 'Version description')}
              value={message}
              disabled={locked}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <div className="workspace-git-actions">
            <WorkspaceButton
              intent="primary"
              disabled={
                locked ||
                !status.capabilities.create ||
                (scope.kind === 'directory' &&
                  !status.capabilities.directory) ||
                (scope.kind !== 'directory' && !changes.length)
              }
              onClick={() => void create()}
            >
              {scope.kind === 'directory'
                ? t('为此目录创建版本', 'Create directory version')
                : scope.kind === 'file'
                  ? t('为此文件创建版本', 'Create file version')
                  : t('为全部更改创建版本', 'Create version of all changes')}
            </WorkspaceButton>
            {scope.kind === 'workspace' && (
              <WorkspaceButton
                disabled={locked || !selected.length}
                onClick={() => void create(selected)}
              >
                {t('为所选文件创建版本', 'Create version of selected files')}
              </WorkspaceButton>
            )}
          </div>
          <h3>{t('历史版本', 'Versions')}</h3>
          {!versions.length && (
            <WorkspaceEmptyState
              description={t('暂无版本', 'No versions yet')}
            />
          )}
          <div className="workspace-git-log">
            {versions.map((version) => (
              <article key={version.id}>
                <strong>{version.message}</strong>
                <small>
                  {version.author} ·{' '}
                  {new Date(version.at).toLocaleString(
                    locale === 'zh' ? 'zh-CN' : 'en-US',
                  )}
                </small>
                <div className="workspace-git-actions">
                  <WorkspaceButton
                    disabled={busy}
                    onClick={() =>
                      void perform(async (epoch) => {
                        const result = await session.versions({
                          type: 'read',
                          versionId: version.id,
                        });
                        if (epoch === generation.current)
                          setPreview({ version, files: result.files ?? [] });
                      })
                    }
                  >
                    {t('预览', 'Preview')}
                  </WorkspaceButton>
                  <WorkspaceButton
                    disabled={locked || !status.capabilities.restore}
                    onClick={() =>
                      void perform(async (epoch) => {
                        const result = await session.versions({
                          type: 'restore-plan',
                          scope,
                          versionId: version.id,
                        });
                        if (epoch === generation.current) setPlan(result.plan);
                      })
                    }
                  >
                    {t('恢复此版本…', 'Restore this version…')}
                  </WorkspaceButton>
                </div>
              </article>
            ))}
          </div>
          {versions.length >= 30 && (
            <WorkspaceButton
              disabled={busy}
              onClick={() =>
                void perform(async (epoch) => {
                  const result = await session.versions({
                    type: 'list',
                    scope,
                    cursor: versions.at(-1)?.id,
                    limit: 30,
                  });
                  if (epoch === generation.current)
                    setVersions((old) => [
                      ...old,
                      ...(result.versions ?? []).filter(
                        (v) => !old.some((o) => o.id === v.id),
                      ),
                    ]);
                })
              }
            >
              {t('加载更多', 'Load more')}
            </WorkspaceButton>
          )}
          {preview && (
            <>
              <WorkspaceButton onClick={() => setPreview(undefined)}>
                {t('关闭预览', 'Close preview')}
              </WorkspaceButton>
              <ContentVersionPreview
                session={session}
                files={preview.files}
                versionId={preview.version.id}
                fileId={scope.kind === 'file' ? scope.fileId : undefined}
                path={
                  preview.version.path ??
                  (scope.kind === 'file' ? scope.path : undefined)
                }
                directoryPath={
                  scope.kind === 'directory' ? preview.version.path : undefined
                }
                locale={locale}
              />
            </>
          )}
          {scope.kind === 'workspace' && !!purgeEntryIds?.length && (
            <WorkspaceButton
              danger
              disabled={locked}
              onClick={() =>
                void perform(async (epoch) => {
                  const result = await session.versions({
                    type: 'purge-plan',
                    fileIds: [],
                    trashEntryIds: purgeEntryIds,
                  });
                  if (epoch === generation.current) setPlan(result.plan);
                })
              }
            >
              {t('预览永久删除…', 'Preview permanent deletion…')}
            </WorkspaceButton>
          )}
        </>
      )}
      {plan && (
        <section
          className="workspace-git-plan"
          aria-label={
            plan.kind === 'create'
              ? t('创建版本预览', 'Version creation preview')
              : plan.kind === 'purge'
                ? t('永久删除预览', 'Permanent deletion preview')
                : t('恢复预览', 'Restore preview')
          }
        >
          <h3>{t('确认操作范围', 'Review affected content')}</h3>
          {plan.kind === 'purge' && (
            <WorkspaceAlert
              type="warning"
              title={t(
                '此操作会永久删除内容并重写受控历史，无法通过版本历史恢复。外部副本和托管平台缓存可能仍需后续处理。',
                'This permanently deletes content and rewrites controlled history. Version history cannot undo it. External copies and hosting caches may require follow-up cleanup.',
              )}
            />
          )}
          <p>
            {plan.kind === 'restore'
              ? t(
                  '恢复结果尚未创建版本，可检查后手动创建。',
                  'Restored changes remain without a version until you create one.',
                )
              : t(
                  '必要的目录搬迁和附件也包含在以下清单中。',
                  'Required directory moves and attachments are included below.',
                )}
          </p>
          <ul>
            {plan.paths.map((p) => (
              <li key={p.path}>
                {p.action === 'delete'
                  ? t('删除', 'Delete')
                  : t('写入', 'Write')}{' '}
                ·{' '}
                {p.path.endsWith('/.verd-folder.json')
                  ? p.path.slice(0, -18) +
                    t('（目录身份）', ' (directory identity)')
                  : p.path}
              </li>
            ))}
          </ul>
          <WorkspaceButton disabled={busy} onClick={() => setPlan(undefined)}>
            {t('取消', 'Cancel')}
          </WorkspaceButton>
          <WorkspaceButton
            intent="primary"
            danger={plan.kind === 'purge'}
            disabled={locked}
            onClick={() => void perform((epoch) => executePlan(plan, epoch))}
          >
            {plan.kind === 'restore'
              ? t('确认恢复', 'Confirm restore')
              : plan.kind === 'purge'
                ? t('确认永久删除', 'Confirm permanent deletion')
                : t('确认创建版本', 'Confirm version creation')}
          </WorkspaceButton>
        </section>
      )}
    </section>
  );
}
