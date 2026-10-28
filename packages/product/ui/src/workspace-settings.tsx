import { useActionSource, type ActionSource } from '@sue/board-react-actions';
import {
  ConfigPanel,
  defineSettings,
  type SettingEditorProps,
} from '@sue/board-react';
import './settings-sections.scss';
import { useState } from 'react';
import { Settings, Trash2 } from 'lucide-react';
import { WorkspaceTrash, type WorkspaceTrashProps } from './workspace-trash';
import { SettingsPageShell } from './settings-page-shell';
import { FrameMindWidthInput } from './frame-mind-width-input';
import { useMindMaxWidth } from './mind-preferences';

export interface WorkspaceSettingsProps {
  actionSource?: ActionSource;
  locale?: 'zh' | 'en';
  config: { name?: string; mindDefaultWidth?: number };
  /** Placeholder and sidebar title while the name is empty. */
  defaultName: string;
  onConfig(patch: { name?: string; mindDefaultWidth?: number }): void;
  trash?: Omit<WorkspaceTrashProps, 'locale' | 'onBusyChange'>;
  onBack(): void;
}

export function WorkspaceSettings({
  actionSource,
  locale = 'zh',
  config,
  defaultName,
  onConfig,
  onBack,
  trash,
}: WorkspaceSettingsProps) {
  useActionSource(actionSource);
  const patchState = actionSource?.getActionState(
    'workspace.settings.patch',
    {},
  );
  // Continuous native inputs may enqueue while an earlier patch saves.
  const controlsDisabled =
    !!patchState && !patchState.enabled && patchState.reason !== 'pending';
  const globalWidth = useMindMaxWidth();
  const zh = locale === 'zh';
  const [section, setSection] = useState<'general' | 'trash'>('general');
  const [busy, setBusy] = useState(false);
  const selected = section === 'trash' && trash ? 'trash' : 'general';
  const generalLabel = zh ? '基本设置' : 'General';
  const trashLabel = zh ? '回收站' : 'Trash';
  return (
    <SettingsPageShell
      title={zh ? '工作区设置' : 'Workspace settings'}
      backLabel={zh ? '返回工作区' : 'Back to workspace'}
      onBack={onBack}
      backDisabled={busy}
      className="workspace-settings settings-sections"
      contentClassName="settings-sections-layout"
      testId="workspace-settings-page"
      backTestId="workspace-settings-back"
    >
      <nav
        className="settings-sections-nav"
        aria-label={zh ? '工作区设置菜单' : 'Workspace settings menu'}
      >
        <button
          type="button"
          data-testid="workspace-settings-nav-general"
          disabled={busy}
          aria-current={selected === 'general' ? 'page' : undefined}
          onClick={() => setSection('general')}
        >
          <Settings size={18} aria-hidden />
          <span>{generalLabel}</span>
        </button>
        {trash && (
          <button
            type="button"
            data-testid="workspace-settings-nav-trash"
            disabled={busy}
            aria-label={trashLabel}
            aria-current={selected === 'trash' ? 'page' : undefined}
            onClick={() => setSection('trash')}
          >
            <Trash2 size={18} aria-hidden />
            <span>{trashLabel}</span>
            <span className="settings-sections-nav-count" aria-hidden>
              {trash.entries.length}
            </span>
          </button>
        )}
      </nav>
      <main className="settings-sections-main">
        <div className="frame-settings-content settings-sections-panel">
          {selected === 'trash' && trash ? (
            <WorkspaceTrash {...trash} locale={locale} onBusyChange={setBusy} />
          ) : (
            <fieldset
              disabled={controlsDisabled}
              style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
              data-action-id={
                actionSource ? 'workspace.settings.patch' : undefined
              }
            >
              <WorkspaceGeneralSettings
                config={config}
                defaultName={defaultName}
                onConfig={onConfig}
                globalWidth={globalWidth}
                zh={zh}
              />
            </fieldset>
          )}
        </div>
      </main>
    </SettingsPageShell>
  );
}

type WorkspaceValues = { name: string; mindDefaultWidth: number | undefined };
interface WorkspaceControls {
  name: { placeholder: string };
  width: {
    placeholder: string;
    label: string;
    inherited: boolean;
    resetLabel: string;
  };
}
const workspaceComponents = {
  name: ({
    value,
    props,
    onCommit,
  }: SettingEditorProps<unknown, WorkspaceControls['name']>) => (
    <input
      data-testid="workspace-settings-name"
      maxLength={80}
      placeholder={props.placeholder}
      value={value as string}
      onChange={(event) => onCommit(event.target.value)}
    />
  ),
  width: ({
    value,
    props,
    onCommit,
    onReset,
  }: SettingEditorProps<unknown, WorkspaceControls['width']>) => (
    <div className="frame-settings-actions">
      <FrameMindWidthInput
        value={value as number | undefined}
        testId="workspace-settings-mind-width"
        label={props.label}
        placeholder={props.placeholder}
        onChange={onCommit}
        onClear={onReset}
      />
      <button
        type="button"
        data-testid="workspace-settings-mind-width-reset"
        disabled={props.inherited}
        onClick={onReset}
      >
        {props.resetLabel}
      </button>
    </div>
  ),
};
function WorkspaceGeneralSettings({
  config,
  defaultName,
  onConfig,
  globalWidth,
  zh,
}: Pick<WorkspaceSettingsProps, 'config' | 'defaultName' | 'onConfig'> & {
  globalWidth: number;
  zh: boolean;
}) {
  const definition = defineSettings<WorkspaceValues, void, WorkspaceControls>({
    groups: [
      { id: 'general', label: zh ? '基本信息' : 'General' },
      { id: 'mind', label: zh ? '思维导图' : 'Mind maps' },
    ],
    fields: [
      {
        key: 'name',
        editor: 'name',
        group: 'general',
        label: zh ? '名称' : 'Name',
        description: zh ? '显示在侧栏顶部' : 'Shown at the top of the sidebar',
        props: { placeholder: defaultName },
        commit: 'change',
      },
      {
        key: 'mindDefaultWidth',
        editor: 'width',
        group: 'mind',
        label: zh ? '默认最大宽度' : 'Default maximum width',
        description: zh
          ? '只作用于没有单独设置宽度的主题，优先于全局默认值'
          : 'Applies to topics without an explicit width and overrides the global default',
        commit: 'change',
        props: {
          placeholder: zh
            ? `跟随全局（${globalWidth}）`
            : `Use global (${globalWidth})`,
          label: zh ? '默认最大宽度' : 'Default maximum width',
          inherited: config.mindDefaultWidth === undefined,
          resetLabel: zh ? '跟随全局' : 'Use global',
        },
      },
    ],
  });
  return (
    <ConfigPanel
      definition={definition}
      values={{
        name: config.name ?? '',
        mindDefaultWidth: config.mindDefaultWidth,
      }}
      identity={`workspace-settings:${defaultName}`}
      fieldStates={{
        mindDefaultWidth: {
          inherited: config.mindDefaultWidth === undefined,
          source: 'application',
        },
      }}
      components={workspaceComponents}
      onCommit={({ changes }) => {
        for (const change of changes)
          onConfig(
            change.kind === 'reset'
              ? { mindDefaultWidth: undefined }
              : { [change.key]: change.value },
          );
      }}
      renderField={({ key, label, description, editor }) => (
        <>
          {key === 'name' ? (
            <label className="frame-settings-row">
              <span>{label}</span>
              {editor}
            </label>
          ) : (
            <div className="frame-settings-row">
              <span>{label}</span>
              {editor}
            </div>
          )}
          <p className="frame-settings-hint">{description}</p>
        </>
      )}
      renderGroup={({ label, children }) => (
        <section>
          <h2>{label}</h2>
          {children}
        </section>
      )}
    />
  );
}
