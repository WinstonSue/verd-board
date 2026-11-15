import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  useSettingsDraftFlush,
  WorkspaceAlert,
  WorkspaceButton,
  WorkspaceEmptyState,
  WorkspaceInput,
} from '@sue/verd-board-ui';

import type {
  GitCommit,
  GitOperationPlan,
  GitVersionFile,
  WorkspaceGitRequest,
  WorkspaceGitResult,
  WorkspaceGitStatus,
} from '@sue/verd-board-workspace';
import { isGitRuntimePath } from '@sue/verd-board-workspace';
import type { WorkspaceSession } from '@sue/verd-board-workspace';

import {
  versionSnapshot as gitVersionSnapshot,
  ContentVersionPreview as GitVersionPreview,
} from './version-preview';
export { versionSnapshot as gitVersionSnapshot } from './version-preview';

export interface GitHistoryPanelProps {
  session: WorkspaceSession;
  adminOnly?: boolean;
  registerLeave?(flush: () => Promise<boolean>): void;
  fileId?: string;
  readonly?: boolean;
  locale?: 'zh' | 'en';
  purgeEntryIds?: string[];
  onBusyChange?(busy: boolean): void;
}

export function GitHistoryPanel({
  session,
  adminOnly = false,
  registerLeave,
  fileId,
  readonly = false,
  locale = 'zh',
  purgeEntryIds,
  onBusyChange,
}: GitHistoryPanelProps) {
  const t = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getState,
    session.getState,
  );
  const [scopePath, setScopePath] = useState<string>();
  const [status, setStatus] = useState<WorkspaceGitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [message, setMessage] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [authorName, setAuthorName] = useState('');
  const [authorEmail, setAuthorEmail] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteName, setRemoteName] = useState('origin');
  const [executable, setExecutable] = useState('');
  const [plan, setPlan] = useState<GitOperationPlan | null>(null);
  const [preview, setPreview] = useState<{
    oid: string;
    files: GitVersionFile[];
    path?: string;
  } | null>(null);
  const [purgeIds, setPurgeIds] = useState<string[]>(purgeEntryIds ?? []);
  const [cleanupConfirmed, setCleanupConfirmed] = useState(false);
  const executableDirty = useRef(false);
  const authorDirty = useRef(false);
  const remoteDirty = useRef(false);
  const mounted = useRef(true);
  const applyStatus = (next: WorkspaceGitStatus) => {
    setStatus(next);
    if (!authorDirty.current) {
      setAuthorName(next.author?.name ?? '');
      setAuthorEmail(next.author?.email ?? '');
    }
    if (!remoteDirty.current) {
      setRemoteUrl(next.remote?.url ?? '');
      setRemoteName(next.remote?.name ?? 'origin');
    }
  };
  const load = async () => {
    const result = await session.git({ type: 'status' });
    if (!mounted.current) return;
    applyStatus(result.status);
    if (result.status.initialized && !adminOnly) {
      const log = await session.git({
        type: 'log',
        fileId,
        path: fileId ? undefined : scopePath,
        limit: 30,
      });
      if (mounted.current) setCommits(log.commits ?? []);
    } else setCommits([]);
  };
  const perform = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busyRef.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  };
  useEffect(() => {
    mounted.current = true;
    const identity = ++generation.current;
    setStatus(null);
    setCommits([]);
    setPreview(null);
    setPlan(null);
    authorDirty.current = false;
    remoteDirty.current = false;
    void perform(async () => {
      if (generation.current === identity) await load();
    });
    return () => {
      mounted.current = false;
      generation.current++;
    };
    // Session identity owns the panel's requests and drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, fileId, scopePath]);
  useEffect(() => {
    setPurgeIds(purgeEntryIds ?? []);
  }, [purgeEntryIds]);
  const request = async (
    value: WorkspaceGitRequest,
  ): Promise<WorkspaceGitResult> => {
    const result = await session.git(value);
    if (value.type === 'configure' || value.type === 'init') {
      authorDirty.current = false;
      remoteDirty.current = false;
      executableDirty.current = false;
    }
    if (mounted.current) applyStatus(result.status);
    return result;
  };
  const flushSettings = async () => {
    if (busyRef.current) return false;
    if (
      !authorDirty.current &&
      !remoteDirty.current &&
      executableDirty.current &&
      !executable.trim()
    ) {
      executableDirty.current = false;
      return true;
    }
    if (
      !adminOnly ||
      readonly ||
      (!authorDirty.current && !remoteDirty.current && !executableDirty.current)
    )
      return !busyRef.current;
    if (!status?.initialized && (authorDirty.current || remoteDirty.current)) {
      setError(
        t(
          '请先启用版本历史，或放弃配置修改。',
          'Enable version history first, or discard configuration changes.',
        ),
      );
      return false;
    }
    try {
      await session.git({
        type: 'configure',
        ...(authorDirty.current
          ? { author: { name: authorName.trim(), email: authorEmail.trim() } }
          : {}),
        ...(remoteDirty.current ? { remoteName, remoteUrl } : {}),
        ...(executable.trim() ? { executable: executable.trim() } : {}),
      });
      authorDirty.current = false;
      remoteDirty.current = false;
      executableDirty.current = false;
      return true;
    } catch (cause) {
      setError(String(cause));
      return false;
    }
  };
  useSettingsDraftFlush('version-provider-settings', flushSettings);
  useEffect(() => {
    registerLeave?.(flushSettings);
  });
  const entry = fileId
    ? (snapshot.documents.get(fileId) ?? snapshot.files.get(fileId))
    : undefined;
  const selectedPath = entry?.path ?? scopePath;
  const fileScope = !!(fileId || scopePath);
  const dependencyPaths = new Set<string>();
  for (const path of selectedPaths) {
    const id = snapshot.fileIdByPath?.get(path);
    if (!id) continue;
    for (const reference of snapshot.references?.targetsOf.get(id) ?? []) {
      const target =
        snapshot.documents.get(reference.targetId) ??
        snapshot.files.get(reference.targetId);
      if (target && target.path !== path) dependencyPaths.add(target.path);
    }
  }
  const author =
    authorName.trim() && authorEmail.trim()
      ? { name: authorName.trim(), email: authorEmail.trim() }
      : undefined;
  const locked = readonly || busy;
  const remoteSupported = status?.remoteSupported ?? status?.canSync ?? false;
  const cleanup = status?.cleanup;
  const changeLabels = {
    added: t('新增', 'Added'),
    modified: t('修改', 'Modified'),
    deleted: t('删除', 'Deleted'),
    renamed: t('重命名', 'Renamed'),
    untracked: t('未跟踪', 'Untracked'),
    conflicted: t('冲突', 'Conflicted'),
  };
  const prepareRestore = (oid: string, whole = false) =>
    perform(async () => {
      const result = await request({
        type: 'restore-plan',
        oid,
        ...(whole ? {} : fileId ? { fileId } : { path: scopePath }),
      });
      setPlan(result.plan ?? null);
      if (!result.plan)
        throw new Error(
          t('无法生成恢复预览', 'Could not prepare a restore preview'),
        );
    });
  const commit = (all: boolean, pathOverride?: string | string[]) =>
    perform(async () => {
      if (!status) return;
      const paths = Array.isArray(pathOverride)
        ? pathOverride
        : pathOverride
          ? [pathOverride]
          : selectedPath
            ? [selectedPath]
            : [];
      await request({
        type: 'commit',
        message: message.trim() || t('更新工作区', 'Update workspace'),
        expectedToken: status.token,
        author,
        ...(!all && paths.length ? { paths } : {}),
      });
      setMessage('');
      setSelectedPaths([]);
      setPreview(null);
      await load();
      setNotice(t('版本已提交', 'Version committed'));
    });
  return (
    <section
      className="workspace-git-panel"
      aria-busy={busy}
      data-testid="git-history-panel"
    >
      <div className="workspace-git-heading">
        <strong>
          {adminOnly
            ? t('Git 配置', 'Git configuration')
            : fileScope
              ? t('此文件的 Git 历史', 'Git history for this file')
              : t('工作区 Git 版本', 'Workspace Git versions')}
        </strong>
        <WorkspaceButton disabled={busy} onClick={() => void perform(load)}>
          {t('刷新', 'Refresh')}
        </WorkspaceButton>
      </div>
      {adminOnly && session.versionDiagnostic?.() && (
        <details>
          <summary>
            {t(
              '上次版本操作的技术详情',
              'Technical details of the last version operation',
            )}
          </summary>
          <pre>{session.versionDiagnostic()}</pre>
        </details>
      )}
      {adminOnly && (
        <WorkspaceButton
          disabled={busy}
          onClick={() => {
            authorDirty.current = false;
            remoteDirty.current = false;
            executableDirty.current = false;
            setExecutable('');
            if (status) applyStatus(status);
            setError('');
          }}
        >
          {t('放弃配置修改', 'Discard configuration changes')}
        </WorkspaceButton>
      )}
      {error && (
        <WorkspaceAlert type="error" role="alert" title={error} showIcon />
      )}
      {notice && <p role="status">{notice}</p>}
      {!status && busy && (
        <p role="status">{t('正在读取 Git…', 'Loading Git…')}</p>
      )}
      {status?.error && (
        <WorkspaceAlert type="warning" title={status.error} showIcon />
      )}
      {!!status?.blocked?.length && (
        <WorkspaceAlert
          type="warning"
          title={t('Git 操作需要处理', 'Git needs attention')}
          description={
            <ul>
              {status.blocked.map((value) => (
                <li key={value}>{value}</li>
              ))}
            </ul>
          }
        />
      )}
      {readonly && (
        <p>{t('当前为只读工作区。', 'This workspace is read-only.')}</p>
      )}
      {status && !status.available && (
        <p>
          {t(
            '当前环境无法使用 Git。',
            'Git is unavailable in this environment.',
          )}
        </p>
      )}
      {status &&
        remoteSupported &&
        (!status.initialized || !status.available) && (
          <fieldset disabled={locked} className="workspace-git-form">
            <legend>{t('Git 配置', 'Git configuration')}</legend>
            <label>
              {t('Git 可执行文件', 'Git executable')}
              <WorkspaceInput
                value={executable}
                placeholder={t(
                  '选择已安装的 Git 路径',
                  'Path to your installed Git',
                )}
                onChange={(event) => {
                  executableDirty.current = true;
                  setExecutable(event.target.value);
                }}
              />
            </label>
            <WorkspaceButton
              disabled={!executable.trim()}
              onClick={() =>
                void perform(async () => {
                  await request({
                    type: 'configure',
                    executable: executable.trim(),
                  });
                  await load();
                })
              }
            >
              {t('保存 Git 配置', 'Save Git configuration')}
            </WorkspaceButton>
          </fieldset>
        )}
      {status && (!status.initialized || !fileId || !status.author) && (
        <fieldset disabled={locked} className="workspace-git-form">
          <legend>{t('提交身份', 'Commit author')}</legend>
          <label>
            {t('姓名', 'Name')}
            <WorkspaceInput
              value={authorName}
              autoComplete="name"
              onChange={(event) => {
                authorDirty.current = true;
                setAuthorName(event.target.value);
              }}
            />
          </label>
          <label>
            {t('邮箱', 'Email')}
            <WorkspaceInput
              value={authorEmail}
              type="email"
              autoComplete="email"
              onChange={(event) => {
                authorDirty.current = true;
                setAuthorEmail(event.target.value);
              }}
            />
          </label>
          {status.initialized && (
            <WorkspaceButton
              disabled={!author}
              onClick={() =>
                void perform(async () => {
                  await request({ type: 'configure', author });
                  authorDirty.current = false;
                  setNotice(t('提交身份已保存', 'Commit author saved'));
                })
              }
            >
              {t('保存提交身份', 'Save author')}
            </WorkspaceButton>
          )}
        </fieldset>
      )}
      {status?.available && !status.initialized && (
        <div>
          <p>
            {t(
              remoteSupported
                ? '初始化后，工作区文件夹可直接使用外部 Git 工具管理。'
                : '初始化后，Git 历史保存在当前浏览器工作区，可离线提交、预览和恢复。',
              remoteSupported
                ? 'After initialization, external Git tools can manage this workspace folder.'
                : 'Git history stays in this browser workspace for offline commits, previews and restores.',
            )}
          </p>
          <WorkspaceButton
            intent="primary"
            disabled={locked || !author}
            onClick={() =>
              void perform(async () => {
                await request({ type: 'init', author });
                await load();
              })
            }
          >
            {t('初始化 Git 仓库', 'Initialize Git repository')}
          </WorkspaceButton>
        </div>
      )}
      {status?.initialized && (
        <>
          {!adminOnly && (
            <>
              {!fileId && (
                <label>
                  {t('历史范围', 'History scope')}
                  <select
                    value={scopePath ?? ''}
                    disabled={busy}
                    onChange={(event) =>
                      setScopePath(event.target.value || undefined)
                    }
                  >
                    <option value="">
                      {t('整个工作区', 'Entire workspace')}
                    </option>
                    {scopePath &&
                      !snapshot.entries.some(
                        (entry) => entry.path === scopePath,
                      ) && <option value={scopePath}>{scopePath}</option>}
                    {snapshot.entries
                      .filter(
                        (entry) =>
                          entry.kind === 'file' &&
                          !isGitRuntimePath(entry.path),
                      )
                      .map((entry) => (
                        <option key={entry.path} value={entry.path}>
                          {entry.path}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <p className="workspace-git-branch">
                {t('分支', 'Branch')}:{' '}
                {status.branch ?? t('游离版本', 'Detached HEAD')} ·{' '}
                {status.head?.slice(0, 10) ?? t('尚无提交', 'No commits')}
                {status.remote && (
                  <>
                    {' '}
                    · {status.ahead ?? 0} {t('待推送', 'ahead')} /{' '}
                    {status.behind ?? 0} {t('待拉取', 'behind')}
                  </>
                )}
              </p>
              <section>
                <h3>{t('待提交的更改', 'Uncommitted changes')}</h3>
                {!status.changes.length ? (
                  <p>{t('没有待提交的更改', 'No uncommitted changes')}</p>
                ) : (
                  <ul className="workspace-git-changes">
                    {status.changes.map((change) => (
                      <li key={change.path}>
                        <input
                          type="checkbox"
                          aria-label={t('选择 ', 'Select ') + change.path}
                          disabled={locked}
                          checked={selectedPaths.includes(change.path)}
                          onChange={(event) =>
                            setSelectedPaths((previous) =>
                              event.target.checked
                                ? [...previous, change.path]
                                : previous.filter(
                                    (path) => path !== change.path,
                                  ),
                            )
                          }
                        />
                        <span>
                          {changeLabels[change.status]}
                          {change.staged ? t(' · 已暂存', ' · staged') : ''}
                        </span>
                        <code>{change.path}</code>
                        <div className="workspace-git-actions">
                          {!fileId && (
                            <WorkspaceButton
                              size="small"
                              disabled={busy}
                              onClick={() => setScopePath(change.path)}
                            >
                              {t('查看历史', 'View history')}
                            </WorkspaceButton>
                          )}
                          <WorkspaceButton
                            size="small"
                            disabled={locked}
                            onClick={() => void commit(false, change.path)}
                          >
                            {t('提交此文件', 'Commit this file')}
                          </WorkspaceButton>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <label>
                  {t('提交说明', 'Commit message')}
                  <WorkspaceInput
                    value={message}
                    placeholder={t(
                      '更新工作区（可选）',
                      'Update workspace (optional)',
                    )}
                    disabled={locked}
                    onChange={(event) => setMessage(event.target.value)}
                  />
                </label>
                <div className="workspace-git-actions">
                  <WorkspaceButton
                    disabled={locked || !selectedPaths.length}
                    onClick={() => void commit(false, selectedPaths)}
                  >
                    {t('提交所选文件', 'Commit selected files')}
                    {selectedPaths.length ? ` (${selectedPaths.length})` : ''}
                  </WorkspaceButton>
                  {fileScope && (
                    <WorkspaceButton
                      intent="primary"
                      disabled={locked || !selectedPath}
                      onClick={() => void commit(false)}
                    >
                      {t('提交此文件', 'Commit this file')}
                    </WorkspaceButton>
                  )}
                  <WorkspaceButton
                    intent={fileScope ? 'secondary' : 'primary'}
                    disabled={locked || !status.changes.length}
                    onClick={() => void commit(true)}
                  >
                    {t('提交全部更改', 'Commit all changes')}
                  </WorkspaceButton>
                </div>
                {!!dependencyPaths.size && (
                  <div className="workspace-git-dependencies">
                    <p>
                      {t(
                        '所选文件引用了以下文件，请将尚未提交的依赖一起选择：',
                        'Selected files reference these files. Include dependencies that have not been committed:',
                      )}
                    </p>
                    <ul>
                      {[...dependencyPaths].map((path) => (
                        <li key={path}>
                          <code>{path}</code>
                          {selectedPaths.includes(path)
                            ? t(' · 已选择', ' · selected')
                            : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            </>
          )}
          {!fileId && (
            <details className="workspace-git-remote">
              <summary>{t('远端备份与同步', 'Remote backup and sync')}</summary>
              <p>
                {t(
                  '连接已有远端仓库。认证使用桌面 Git 的凭据管理；同步冲突需处理后重试。',
                  'Connect an existing remote repository. Desktop Git manages credentials; resolve sync conflicts before retrying.',
                )}
              </p>
              <fieldset
                disabled={locked || !remoteSupported}
                className="workspace-git-form"
              >
                <label>
                  {t('远端名称', 'Remote name')}
                  <WorkspaceInput
                    value={remoteName}
                    onChange={(event) => {
                      remoteDirty.current = true;
                      setRemoteName(event.target.value);
                    }}
                  />
                </label>
                <label>
                  {t('仓库地址', 'Repository URL')}
                  <WorkspaceInput
                    value={remoteUrl}
                    placeholder="https://… / git@…"
                    onChange={(event) => {
                      remoteDirty.current = true;
                      setRemoteUrl(event.target.value);
                    }}
                  />
                </label>
                <label>
                  {t('Git 可执行文件（可选）', 'Git executable (optional)')}
                  <WorkspaceInput
                    value={executable}
                    onChange={(event) => {
                      executableDirty.current = true;
                      setExecutable(event.target.value);
                    }}
                  />
                </label>
                <div className="workspace-git-actions">
                  <WorkspaceButton
                    disabled={!remoteName.trim() || !remoteUrl.trim()}
                    onClick={() =>
                      void perform(async () => {
                        await request({
                          type: 'configure',
                          remoteName: remoteName.trim(),
                          remoteUrl: remoteUrl.trim(),
                          ...(executable.trim()
                            ? { executable: executable.trim() }
                            : {}),
                        });
                        remoteDirty.current = false;
                        setNotice(
                          t('远端配置已保存', 'Remote configuration saved'),
                        );
                      })
                    }
                  >
                    {t('保存远端配置', 'Save remote')}
                  </WorkspaceButton>
                  <WorkspaceButton
                    disabled={!status.remote || !status.canSync}
                    onClick={() =>
                      void perform(async () => {
                        await request({
                          type: 'sync',
                          expectedToken: status.token,
                        });
                        await load();
                        setNotice(t('同步完成', 'Sync completed'));
                      })
                    }
                  >
                    {t('同步', 'Sync')}
                  </WorkspaceButton>
                </div>
              </fieldset>
              {!remoteSupported && (
                <p>
                  {t(
                    '远端同步仅在桌面端提供。浏览器可使用本地 Git 历史。',
                    'Remote sync is available on Desktop. Browser Git history remains local.',
                  )}
                </p>
              )}
            </details>
          )}
          {!adminOnly && (
            <>
              <section>
                <h3>{t('提交历史', 'Commit history')}</h3>
                {!commits.length && (
                  <WorkspaceEmptyState
                    description={t('暂无提交', 'No commits yet')}
                  />
                )}
                <div className="workspace-git-log">
                  {commits.map((version) => (
                    <article key={version.oid}>
                      <div>
                        <strong>{version.message}</strong>
                        <small>
                          <code>{version.oid.slice(0, 10)}</code> ·{' '}
                          {version.author} ·{' '}
                          {new Date(version.at).toLocaleString(
                            locale === 'zh' ? 'zh-CN' : 'en-US',
                          )}
                        </small>
                      </div>
                      <div className="workspace-git-actions">
                        <WorkspaceButton
                          disabled={busy}
                          onClick={() =>
                            void perform(async () => {
                              const result = await request({
                                type: 'read',
                                oid: version.oid,
                              });
                              const files = result.files ?? [];
                              gitVersionSnapshot(
                                session.getState(),
                                files,
                                version.oid,
                              );
                              setPreview({
                                oid: version.oid,
                                files,
                                path: version.path ?? scopePath,
                              });
                            })
                          }
                        >
                          {t('预览', 'Preview')}
                        </WorkspaceButton>
                        <WorkspaceButton
                          disabled={locked}
                          onClick={() =>
                            void prepareRestore(version.oid, !fileScope)
                          }
                        >
                          {fileScope
                            ? t('恢复此文件…', 'Restore file…')
                            : t('恢复工作区…', 'Restore workspace…')}
                        </WorkspaceButton>
                        {fileScope && (
                          <WorkspaceButton
                            disabled={locked}
                            onClick={() =>
                              void prepareRestore(version.oid, true)
                            }
                          >
                            {t('恢复工作区…', 'Restore workspace…')}
                          </WorkspaceButton>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
                {commits.length >= 30 && (
                  <WorkspaceButton
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const result = await request({
                          type: 'log',
                          fileId,
                          path: fileId ? undefined : scopePath,
                          limit: 30,
                          cursor: commits.at(-1)?.oid,
                        });
                        setCommits((previous) => [
                          ...previous,
                          ...(result.commits ?? []).filter(
                            (next) =>
                              !previous.some((old) => old.oid === next.oid),
                          ),
                        ]);
                      })
                    }
                  >
                    {t('加载更多', 'Load more')}
                  </WorkspaceButton>
                )}
              </section>
              {preview && (
                <>
                  <WorkspaceButton
                    disabled={busy}
                    onClick={() => setPreview(null)}
                  >
                    {t('关闭预览', 'Close preview')}
                  </WorkspaceButton>
                  <GitVersionPreview
                    key={preview.oid}
                    session={session}
                    files={preview.files}
                    versionId={preview.oid}
                    fileId={fileId}
                    path={preview.path}
                    locale={locale}
                  />
                </>
              )}
              {!fileId && (
                <details
                  className="workspace-git-purge"
                  open={purgeEntryIds?.length ? true : undefined}
                >
                  <summary>
                    {t(
                      '永久删除与历史清理',
                      'Permanent deletion and history cleanup',
                    )}
                  </summary>
                  <p>
                    {t(
                      '选择回收站中的内容，先检查受影响的文件与版本，再确认永久删除。',
                      'Select trashed content and review affected files and versions before deleting permanently.',
                    )}
                  </p>
                  {snapshot.trash.map((item) => (
                    <label
                      className="workspace-git-purge-choice"
                      key={item.entryId}
                    >
                      <input
                        type="checkbox"
                        disabled={locked}
                        checked={purgeIds.includes(item.entryId)}
                        onChange={(event) =>
                          setPurgeIds((previous) =>
                            event.target.checked
                              ? [...previous, item.entryId]
                              : previous.filter((id) => id !== item.entryId),
                          )
                        }
                      />
                      {item.originalPath}
                    </label>
                  ))}
                  <WorkspaceButton
                    danger
                    disabled={locked || !purgeIds.length}
                    onClick={() =>
                      void perform(async () => {
                        const result = await request({
                          type: 'purge-plan',
                          fileIds: [],
                          trashEntryIds: purgeIds,
                        });
                        setPlan(result.plan ?? null);
                        if (!result.plan)
                          throw new Error(
                            t(
                              '无法生成清理预览',
                              'Could not prepare cleanup preview',
                            ),
                          );
                      })
                    }
                  >
                    {t('预览永久删除…', 'Preview permanent deletion…')}
                  </WorkspaceButton>
                </details>
              )}
            </>
          )}
        </>
      )}
      {plan && !adminOnly && (
        <section
          className="workspace-git-plan"
          aria-label={
            plan.kind === 'purge'
              ? t('永久删除预览', 'Permanent deletion preview')
              : t('恢复预览', 'Restore preview')
          }
        >
          <h3>
            {plan.kind === 'purge'
              ? t('确认永久删除', 'Confirm permanent deletion')
              : plan.scope === 'workspace'
                ? t('确认恢复工作区', 'Confirm workspace restore')
                : t('确认恢复文件', 'Confirm file restore')}
          </h3>
          {plan.kind === 'restore' && (
            <p>
              {t(
                '恢复结果会保留为未提交的修改，可检查后手动提交。以下文件将被修改：',
                'Restored content remains uncommitted for you to review and commit manually. These files will change:',
              )}
            </p>
          )}
          <ul>
            {plan.paths.map((item) => (
              <li key={item.path}>
                {item.action === 'delete'
                  ? t('删除', 'Delete')
                  : t('写入', 'Write')}{' '}
                · <code>{item.path}</code>
              </li>
            ))}
          </ul>
          {!!plan.refs?.length && (
            <p>
              {t('受影响的引用', 'Affected refs')}: {plan.refs.join(', ')}
            </p>
          )}
          {plan.warnings.map((warning, index) => (
            <WorkspaceAlert key={index} type="warning" title={warning} />
          ))}
          <div className="workspace-git-actions">
            <WorkspaceButton disabled={busy} onClick={() => setPlan(null)}>
              {t('取消', 'Cancel')}
            </WorkspaceButton>
            <WorkspaceButton
              intent="primary"
              danger={plan.kind === 'purge'}
              disabled={locked}
              onClick={() =>
                void perform(async () => {
                  await request({
                    type: plan.kind === 'purge' ? 'purge' : 'restore',
                    planId: plan.id,
                    expectedToken: plan.token,
                  });
                  setPlan(null);
                  setPreview(null);
                  setPurgeIds([]);
                  await load();
                  setNotice(
                    plan.kind === 'purge'
                      ? t(
                          '清理完成，请检查下方各阶段状态。',
                          'Cleanup completed. Check the phase status below.',
                        )
                      : t(
                          '已恢复，可检查后手动提交',
                          'Restored. Review the changes and commit manually.',
                        ),
                  );
                })
              }
            >
              {plan.kind === 'purge'
                ? t('确认永久删除', 'Confirm permanent deletion')
                : t('确认恢复', 'Confirm restore')}
            </WorkspaceButton>
          </div>
        </section>
      )}
      {cleanup && (
        <WorkspaceAlert
          type={cleanup.pending.length ? 'warning' : 'success'}
          title={t('历史清理状态', 'History cleanup status')}
          description={
            <>
              <p>
                {cleanup.phase === 'local-cleared'
                  ? t('本地已清除', 'Local history cleared')
                  : cleanup.phase === 'remote-updated'
                    ? t('远端引用已更新', 'Remote refs updated')
                    : cleanup.phase === 'acknowledged'
                      ? t(
                          '已确认完成其他副本处理',
                          'Other copy cleanup acknowledged',
                        )
                      : t(
                          '远端平台清理待完成',
                          'Remote platform cleanup pending',
                        )}
              </p>
              <p>{cleanup.message}</p>
              {!!cleanup.pending.length && (
                <ul>
                  {cleanup.pending.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              {cleanup.phase !== 'acknowledged' && !!cleanup.pending.length && (
                <section
                  aria-label={t(
                    '托管平台清理说明',
                    'Hosting platform cleanup instructions',
                  )}
                >
                  <h3>
                    {t(
                      '完成托管平台与其他副本清理',
                      'Complete hosting platform and other copy cleanup',
                    )}
                  </h3>
                  <ul>
                    <li>
                      <a
                        href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t(
                          'GitHub 官方清理说明',
                          'GitHub removal instructions',
                        )}
                      </a>
                      {t(
                        '：PR 引用与缓存需联系 GitHub Support，fork 需协调其所有者处理。Support 不受理普通非敏感数据清理，敏感数据也有受理条件。',
                        ': Contact GitHub Support for pull request refs and caches, and coordinate cleanup with fork owners. Support does not remove non-sensitive data; sensitive-data requests also have eligibility requirements.',
                      )}
                    </li>
                    <li>
                      <a
                        href="https://docs.gitlab.com/user/project/repository/repository_size/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        GitLab Remove blobs
                      </a>
                      {t(
                        '：按说明准备 blob ID 并完成移除，再运行 ',
                        ': Follow the instructions to identify blob IDs and remove them, then run ',
                      )}
                      <a
                        href="https://docs.gitlab.com/administration/housekeeping/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        housekeeping / Prune unreachable objects
                      </a>
                      {t(
                        '。fork 对象池可能仍需 GitLab Support 协助。',
                        '. Fork object pools may still require GitLab Support.',
                      )}
                    </li>
                    <li>
                      {t(
                        '其他托管服务请联系管理员，确认隐藏引用、缓存和服务器对象已处理。其他 clone 与备份也需单独清理；重新克隆清理后的仓库，避免合并或推回旧历史。',
                        'For other hosting services, contact the administrator about hidden refs, caches and server objects. Clean up other clones and backups separately; clone the cleaned repository again and avoid merging or pushing old history back.',
                      )}
                    </li>
                  </ul>
                </section>
              )}
              {cleanup.phase !== 'acknowledged' &&
                remoteSupported &&
                status && (
                  <WorkspaceButton
                    disabled={locked}
                    onClick={() =>
                      void perform(async () => {
                        await request({
                          type: 'cleanup-retry',
                          expectedToken: status.token,
                        });
                        await load();
                      })
                    }
                  >
                    {t('重试远端清理', 'Retry remote cleanup')}
                  </WorkspaceButton>
                )}
              {cleanup.phase === 'platform-pending' && (
                <>
                  <label className="workspace-git-purge-choice">
                    <input
                      type="checkbox"
                      checked={cleanupConfirmed}
                      disabled={locked}
                      onChange={(event) =>
                        setCleanupConfirmed(event.target.checked)
                      }
                    />
                    {t(
                      '已按平台说明完成其他副本处理',
                      'I have handled other copies following the platform instructions',
                    )}
                  </label>
                  <p>
                    {t(
                      '此操作记录你的确认，客户端无法验证远端平台或其他副本已物理销毁数据。',
                      'This records your confirmation. The client cannot verify physical deletion by the remote platform or other copies.',
                    )}
                  </p>
                  <WorkspaceButton
                    disabled={locked || !cleanupConfirmed}
                    onClick={() =>
                      void perform(async () => {
                        if (!status) return;
                        await request({
                          type: 'cleanup-confirm',
                          expectedToken: status.token,
                        });
                        setCleanupConfirmed(false);
                        await load();
                      })
                    }
                  >
                    {t('记录清理确认', 'Acknowledge cleanup')}
                  </WorkspaceButton>
                </>
              )}
            </>
          }
        />
      )}
    </section>
  );
}
