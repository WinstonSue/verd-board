import {
  SettingsSection,
  SettingsKeyValue,
  SettingsActions,
} from '../shared/components/settings-layout';
import { useEffect, useState } from 'react';
import { VmDialog } from '../shared/components/vm-dialog';
import {
  WorkspaceAlert,
  WorkspaceButton,
  WorkspaceCheckbox,
} from '../shared/workspace-design';
interface Info {
  kind: 'project' | 'agent-patterns';
  currentReleaseId: string | null;
  releaseId: string;
  currentVersion: string | null;
  version: string;
  hasBackups: boolean;
}
export interface BuiltinWorkspaceSettingsProps {
  source: {
    read(): Promise<Info | null>;
    update(releaseId: string, backup: boolean): Promise<void>;
    backups(): Promise<void>;
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
  const { read } = source;
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [backup, setBackup] = useState(false);
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
  if (!info)
    return error ? <WorkspaceAlert type="error" title={error} /> : null;
  const changed =
    info.currentReleaseId !== info.releaseId ||
    info.currentVersion !== info.version;
  const name =
    info.kind === 'project'
      ? zh
        ? '系统介绍'
        : 'System introduction'
      : zh
        ? '文档编写推荐库'
        : 'Document authoring recommendations';
  return (
    <SettingsSection data-testid="builtin-workspace-settings" title={name}>
      <SettingsKeyValue
        items={[
          {
            label: zh ? '当前内容版本' : 'Current content version',
            value:
              info.currentVersion ?? (zh ? '旧版 / 未知' : 'Legacy / unknown'),
          },
          {
            label: zh ? '系统内置版本' : 'Bundled version',
            value: info.version,
          },
        ]}
      />
      <p>
        {zh
          ? '内容随系统内置。更新会替换全部图文、目录和设置；可选择将当前副本备份到指定目录。'
          : 'Content ships with the app. Updating replaces all content, folders and settings. You can back up the current copy to a folder of your choice.'}
      </p>
      {!changed && (
        <p>{zh ? '已采用系统内置版本' : 'Using the bundled version'}</p>
      )}
      <SettingsActions>
        <WorkspaceButton
          type="button"
          disabled={busy || readonly}
          onClick={() => {
            setBackup(false);
            setError('');
            setConfirm(true);
          }}
        >
          {changed
            ? zh
              ? '更新为系统内置内容…'
              : 'Update to bundled content…'
            : zh
              ? '恢复系统内置内容…'
              : 'Restore bundled content…'}
        </WorkspaceButton>
        {info.hasBackups && (
          <WorkspaceButton
            intent="ghost"
            type="button"
            disabled={busy}
            onClick={() =>
              void source.backups().catch((e) => setError(String(e)))
            }
          >
            {zh ? '打开备份目录' : 'Open backups'}
          </WorkspaceButton>
        )}
      </SettingsActions>
      {error && !confirm && <WorkspaceAlert type="error" title={error} />}
      {confirm && (
        <VmDialog
          title={zh ? `更新${name}` : `Update ${name}`}
          closeLabel={zh ? '关闭' : 'Close'}
          busy={busy}
          onClose={() => setConfirm(false)}
          className="workspace-action-confirmation"
          data-testid="workspace-action-confirmation"
          footer={
            <>
              <WorkspaceButton
                type="button"
                disabled={busy}
                onClick={() => setConfirm(false)}
              >
                {zh ? '取消' : 'Cancel'}
              </WorkspaceButton>
              <WorkspaceButton
                type="button"
                danger
                busy={busy}
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  onBusy(true);
                  setError('');
                  void source
                    .update(info.releaseId, backup)
                    .catch((e) => setError(String(e)))
                    .finally(() => {
                      setBusy(false);
                      onBusy(false);
                    });
                }}
              >
                {backup
                  ? zh
                    ? '选择目录并备份更新'
                    : 'Choose folder, back up and update'
                  : zh
                    ? '不备份，全部更新'
                    : 'Update without backup'}
              </WorkspaceButton>
            </>
          }
        >
          <p>
            {zh
              ? '将先保存当前工作区，再替换为系统内置内容。未备份的修改和新增文件将被移除，项目身份保留。'
              : 'Save the current workspace, then replace it with bundled content. Edits and added files will be removed unless backed up. Project identity is retained.'}
          </p>
          <WorkspaceCheckbox
            checked={backup}
            disabled={busy}
            onChange={(e) => setBackup(e.target.checked)}
          >
            {zh ? '备份当前工作区' : 'Back up current workspace'}
          </WorkspaceCheckbox>
          {backup && (
            <p>
              {zh
                ? '确认后选择备份父目录，备份将作为普通工作区加入列表。取消目录选择不会更新。'
                : 'Choose a parent folder after confirming. The backup will be added to the workspace list. Cancelling the folder picker leaves content unchanged.'}
            </p>
          )}
          {error && <WorkspaceAlert type="error" title={error} />}
        </VmDialog>
      )}
    </SettingsSection>
  );
}
