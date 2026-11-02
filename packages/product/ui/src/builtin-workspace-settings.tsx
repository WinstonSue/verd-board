import {
  SettingsSection,
  SettingsKeyValue,
  SettingsActions,
} from './components/settings-layout';
import { useEffect, useState } from 'react';
import { WorkspaceActionConfirmation } from './workspace-action-confirmation';
interface Info {
  kind: 'project' | 'agent-patterns';
  currentReleaseId: string | null;
  releaseId: string;
  hasBackups: boolean;
  update?: {
    currentVersion: string | null;
    bundledVersion: string | null;
    availableVersion?: string;
    candidateId?: string;
    incompatibleVersion?: string;
    checkedAt: number;
    status: string;
    error?: string;
  };
}
export interface BuiltinWorkspaceSettingsProps {
  source: {
    read(): Promise<Info | null>;
    update(releaseId: string, kind: Info['kind']): Promise<void>;
    backups(): Promise<void>;
    check?(): Promise<void>;
  };
  readonly?: boolean;
  zh: boolean;
  onBusy(busy: boolean): void;
}
export function BuiltinWorkspaceSettings({
  source,
  readonly = false,
  zh,
  onBusy,
}: BuiltinWorkspaceSettingsProps) {
  const [info, setInfo] = useState<Info | null>(null);
  const [read] = useState(() => source.read);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    read().then(
      (value) => {
        if (alive) setInfo(value);
      },
      (e) => {
        if (alive) setError(String(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [read]);
  if (!info) return error ? <p role="alert">{error}</p> : null;
  const bundledTarget =
    !info.update?.candidateId || info.update.candidateId === info.releaseId;
  const downgrade =
    bundledTarget &&
    info.update?.currentVersion &&
    info.update.bundledVersion &&
    info.update.currentVersion.localeCompare(
      info.update.bundledVersion,
      undefined,
      { numeric: true },
    ) > 0;
  return (
    <SettingsSection
      data-testid="builtin-workspace-settings"
      title={zh ? '内置内容' : 'Built-in workspace update'}
    >
      <SettingsKeyValue
        items={[
          {
            label: zh ? '当前内容版本' : 'Current content version',
            value:
              info.currentReleaseId?.slice(0, 19) ??
              (zh ? '旧版 / 未知' : 'Legacy / unknown'),
          },
          {
            label: zh ? '应用附带内容版本' : 'Bundled content version',
            value: info.releaseId.slice(0, 19),
          },
          ...(info.update
            ? [
                {
                  label: zh ? '当前资源包版本' : 'Current package version',
                  value:
                    info.update.currentVersion ??
                    (zh ? '旧版 / 未知' : 'Legacy / unknown'),
                },
                {
                  label: zh ? '应用附带资源包版本' : 'Bundled package version',
                  value:
                    info.update.bundledVersion ??
                    (zh ? '开发资源' : 'Development resources'),
                },
                ...(info.update.availableVersion
                  ? [
                      {
                        label: zh ? '可用版本' : 'Available version',
                        value: info.update.availableVersion,
                      },
                    ]
                  : []),
                {
                  label: zh ? '上次检查' : 'Last checked',
                  value: new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(info.update.checkedAt)),
                },
              ]
            : []),
        ]}
      />
      <p>
        {info.currentReleaseId !== info.releaseId
          ? zh
            ? '当前副本尚未采用应用附带版本。安装应用不会自动替换已有内容或会话。'
            : 'This copy has not adopted the bundled version. Installing the app does not replace existing content or sessions.'
          : zh
            ? '当前副本基于应用附带版本，也可再次替换以恢复内置内容。'
            : 'This copy is based on the bundled version. You can replace it again to restore the built-in content.'}
        {zh
          ? '确认替换后会完整备份旧目录，并打开新版导航文档。'
          : 'Confirming replacement backs up the entire old folder and opens the new navigation document.'}
      </p>
      {info.update?.incompatibleVersion && (
        <p>
          {zh
            ? `版本 ${info.update.incompatibleVersion} 需要升级应用。`
            : `Version ${info.update.incompatibleVersion} requires an app update.`}
        </p>
      )}
      {info.update?.error && <p role="alert">{info.update.error}</p>}
      {info.update?.status === 'current' && (
        <p>{zh ? '当前没有可用更新' : 'No updates available'}</p>
      )}
      <SettingsActions>
        {source.check && (
          <button
            className="vm-btn vm-btn--secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError('');
              void source.check!()
                .then(read)
                .then(setInfo)
                .catch((e) => setError(String(e)))
                .finally(() => setBusy(false));
            }}
          >
            {zh ? '检查更新' : 'Check for updates'}
          </button>
        )}
        <button
          className="vm-btn vm-btn--secondary"
          type="button"
          disabled={busy || readonly}
          onClick={() => setConfirm(true)}
        >
          {info.update?.candidateId &&
          info.update.candidateId !== info.releaseId
            ? zh
              ? '更新至最新内容…'
              : 'Update content…'
            : zh
              ? '替换为内置内容…'
              : 'Replace with bundled content…'}
        </button>
        <button
          className="vm-btn vm-btn--ghost"
          type="button"
          disabled={busy || !info.hasBackups}
          onClick={() =>
            void source.backups().catch((e) => setError(String(e)))
          }
        >
          {zh ? '打开备份目录' : 'Open backups'}
        </button>
        {info.update?.candidateId &&
          info.update.candidateId !== info.releaseId && (
            <button
              className="vm-btn vm-btn--danger"
              type="button"
              disabled={busy || readonly}
              onClick={() => {
                setInfo({
                  ...info,
                  update: { ...info.update!, candidateId: info.releaseId },
                });
                setConfirm(true);
              }}
            >
              {zh
                ? '恢复应用附带内容…（可能降级）'
                : 'Restore bundled content… (may downgrade)'}
            </button>
          )}
      </SettingsActions>
      {error && <p role="alert">{error}</p>}
      {confirm && (
        <WorkspaceActionConfirmation
          title={zh ? '全部更新内置工作区' : 'Replace built-in workspace'}
          message={
            zh
              ? `${downgrade ? '此次将降级至应用附带版本。' : ''}将先保存并完整备份当前工作区，再替换全部图文、目录和设置。用户修改及新增文件仅保留在备份中。项目身份保留。`
              : 'Save and back up the entire workspace, then replace all content, folders and settings. Your edits and added files remain in the backup. Project identity is retained.'
          }
          confirm={zh ? '备份并全部更新' : 'Back up and replace all'}
          cancel={zh ? '取消' : 'Cancel'}
          busy={busy}
          error={error}
          onClose={() => setConfirm(false)}
          onConfirm={() => {
            setBusy(true);
            onBusy(true);
            setError('');
            void source
              .update(info.update?.candidateId ?? info.releaseId, info.kind)
              .catch((e) => setError(String(e)))
              .finally(() => {
                setBusy(false);
                onBusy(false);
              });
          }}
        />
      )}
    </SettingsSection>
  );
}
