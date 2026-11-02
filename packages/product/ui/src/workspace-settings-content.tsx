import { SettingsSection } from './components/settings-layout';
import { validMindMaxWidth } from '@sue/board-mind';
import { SettingsDraftInput } from './settings-draft';
import { ArrowUp, ArrowDown, X, Plus } from 'lucide-react';
import { type ActionSource } from '@sue/board-react-actions';
import {
  ConfigPanel,
  defineSettings,
  type SettingEditorProps,
} from '@sue/board-react';
import './settings-sections.scss';
import { useState } from 'react';
import { type BuiltinWorkspaceSettingsProps } from './builtin-workspace-settings';

interface ProjectInfo {
  description: string;
  entryDocumentIds: string[];
}
export interface WorkspaceSettingsConfig {
  name?: string;
  mindDefaultWidth?: number;
  project?: ProjectInfo;
}

import { type WorkspaceTrashProps } from './workspace-trash';

import { FrameMindWidthInput } from './frame-mind-width-input';

export interface WorkspaceSettingsProps {
  initialSection?: 'general' | 'trash';
  fileChoices?: { id: string; title: string; path: string }[];
  builtin?: BuiltinWorkspaceSettingsProps['source'];
  actionSource?: ActionSource;
  locale?: 'zh' | 'en';
  config: WorkspaceSettingsConfig;
  agent?: { ready: boolean; diagnostics: { code: string; message: string }[] };
  /** Placeholder and sidebar title while the name is empty. */
  defaultName: string;
  onConfig(
    patch: WorkspaceSettingsPatch,
  ):
    | import('@sue/schema-settings-react').CommitResult
    | Promise<import('@sue/schema-settings-react').CommitResult>;
  readonly?: boolean;
  storage?: 'desktop' | 'browser';
  persistence?: { status: string; error?: string; onRetry(): void };
  trash?: Omit<WorkspaceTrashProps, 'locale' | 'onBusyChange'>;
  onBack(): void;
}

export type WorkspaceSettingsPatch = Omit<
  WorkspaceSettingsConfig,
  'project'
> & { project?: Partial<ProjectInfo> };

type WorkspaceValues = {
  name: string;
  description: string;
  entryDocumentIds: string;
  mindDefaultWidth: number | undefined;
};
interface WorkspaceControls {
  name: { placeholder: string };
  projectText: { label: string; testId: string };
  width: {
    placeholder: string;
    label: string;
    inherited: boolean;
    resetLabel: string;
  };
}
const workspaceComponents = {
  projectText: ({
    value,
    props,
    onCommit,
  }: SettingEditorProps<unknown, WorkspaceControls['projectText']>) => (
    <textarea
      aria-label={props.label}
      data-testid={props.testId}
      rows={3}
      value={value as string}
      onChange={(event) => onCommit(event.target.value)}
    />
  ),
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
export function useWorkspaceSettingsDefinition(
  zh: boolean,
  globalWidth: number,
  config: WorkspaceSettingsConfig,
  defaultName: string,
) {
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
        key: 'description',
        editor: 'projectText',
        group: 'general',
        label: zh ? '项目简介' : 'Project description',
        description: zh
          ? '介绍项目内容，也用于 AI 项目上下文'
          : 'Included in AI project context; empty until provided',
        props: {
          label: zh ? '项目简介' : 'Project description',
          testId: 'workspace-settings-description',
        },
        commit: 'change',
      },
      {
        key: 'entryDocumentIds',
        editor: 'projectText',
        group: 'general',
        label: zh ? '入口文档' : 'Entry documents',
        description: zh
          ? '按顺序选择阅读入口；没有已保存会话时打开首个可用入口'
          : 'Choose ordered reading entries; the first available entry opens without a saved session',
        props: {
          label: zh ? '入口文档' : 'Entry documents',
          testId: 'workspace-settings-entries',
        },
        commit: 'change',
      },
      {
        key: 'mindDefaultWidth',
        editor: 'width',
        group: 'mind',
        label: zh ? '默认最大宽度' : 'Default maximum width',
        description: zh
          ? '只作用于没有单独设置宽度的主题，优先于个人默认值'
          : 'Applies to topics without an explicit width and overrides the global default',
        commit: 'change',
        props: {
          placeholder: zh
            ? `跟随个人默认值（${globalWidth}）`
            : `Use global (${globalWidth})`,
          label: zh ? '默认最大宽度' : 'Default maximum width',
          inherited: config.mindDefaultWidth === undefined,
          resetLabel: zh ? '跟随个人默认值' : 'Use personal default',
        },
      },
    ],
  });
  return definition;
}
export function WorkspaceGeneralSettings({
  config,
  fileChoices,
  defaultName,
  onConfig,
  globalWidth,
  zh,
  section,
}: Pick<
  WorkspaceSettingsProps,
  'config' | 'defaultName' | 'onConfig' | 'fileChoices'
> & {
  globalWidth: number;
  zh: boolean;
  section?: string;
}) {
  const definition = useWorkspaceSettingsDefinition(
    zh,
    globalWidth,
    config,
    defaultName,
  );
  return (
    <ConfigPanel
      definition={{
        ...definition,
        groups: definition.groups?.filter(
          (group) => !section || group.id === section,
        ),
        fields: definition.fields.filter(
          (f) => !section || f.group === section,
        ),
      }}
      values={{
        name: config.name ?? '',
        description: config.project?.description ?? '',
        entryDocumentIds: config.project?.entryDocumentIds.join('\n') ?? '',
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
      onCommit={async ({ changes }) => {
        for (const change of changes) {
          if (
            change.key === 'description' ||
            change.key === 'entryDocumentIds'
          ) {
            const result = await onConfig({
              project: {
                [change.key]:
                  change.key === 'entryDocumentIds'
                    ? String(change.kind === 'set' ? change.value : '')
                        .split('\n')
                        .map((id) => id.trim())
                        .filter(Boolean)
                    : String(change.kind === 'set' ? change.value : ''),
              },
            });
            if (result?.status === 'rejected') return result;
            continue;
          }
          const result = await onConfig(
            change.kind === 'reset'
              ? { mindDefaultWidth: undefined }
              : { [change.key]: change.value },
          );
          if (result?.status === 'rejected') return result;
        }
        return { status: 'accepted' };
      }}
      renderField={({ key, label, description, editor }) => (
        <div data-setting-key={key}>
          {key === 'mindDefaultWidth' ? (
            <div className="settings-form-row">
              <span>{label}</span>
              <select
                aria-label={zh ? '宽度来源' : 'Width source'}
                value={
                  config.mindDefaultWidth === undefined ? 'inherit' : 'custom'
                }
                onChange={(e) =>
                  void onConfig({
                    mindDefaultWidth:
                      e.target.value === 'inherit' ? undefined : globalWidth,
                  })
                }
              >
                <option value="inherit">
                  {zh
                    ? `跟随个人默认值（${globalWidth}）`
                    : 'Use personal default'}
                </option>
                <option value="custom">{zh ? '自定义' : 'Custom'}</option>
              </select>
              {config.mindDefaultWidth !== undefined && (
                <SettingsDraftInput
                  numeric
                  value={config.mindDefaultWidth}
                  label={String(label)}
                  testId="workspace-settings-mind-width"
                  onSave={(value) => {
                    if (!value || !validMindMaxWidth(Number(value)))
                      throw new Error(
                        zh ? '请输入有效宽度' : 'Enter a valid width',
                      );
                    return onConfig({ mindDefaultWidth: Number(value) });
                  }}
                />
              )}
            </div>
          ) : key === 'name' || key === 'description' ? (
            <label
              className={`settings-form-row ${key === 'description' ? 'settings-full-row' : ''}`}
            >
              <span>{label}</span>
              <SettingsDraftInput
                value={
                  key === 'name'
                    ? (config.name ?? '')
                    : (config.project?.description ?? '')
                }
                label={String(label)}
                testId={
                  key === 'name'
                    ? 'workspace-settings-name'
                    : 'workspace-settings-description'
                }
                multiline={key === 'description'}
                onSave={(value) =>
                  onConfig(
                    key === 'name'
                      ? { name: value }
                      : { project: { description: value } },
                  )
                }
              />
            </label>
          ) : key === 'entryDocumentIds' ? (
            <EntryDocuments
              choices={fileChoices ?? []}
              ids={config.project?.entryDocumentIds ?? []}
              zh={zh}
              onChange={(entryDocumentIds) =>
                onConfig({ project: { entryDocumentIds } })
              }
            />
          ) : key === 'name' ? (
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
        </div>
      )}
      renderGroup={({ label, children }) => (
        <SettingsSection title={label}>{children}</SettingsSection>
      )}
    />
  );
}

function EntryDocuments({
  choices,
  ids,
  zh,
  onChange,
}: {
  choices: NonNullable<WorkspaceSettingsProps['fileChoices']>;
  ids: string[];
  zh: boolean;
  onChange(
    ids: string[],
  ):
    | import('@sue/schema-settings-react').CommitResult
    | Promise<import('@sue/schema-settings-react').CommitResult>;
}) {
  const [query, setQuery] = useState('');
  const [picker, setPicker] = useState(false);
  const [drag, setDrag] = useState<string>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const commit = async (next: string[]) => {
    setPending(true);
    try {
      const result = await onChange(next);
      setError(
        result?.status === 'rejected'
          ? (result.message ?? (zh ? '保存失败' : 'Save failed'))
          : '',
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <fieldset
      disabled={pending}
      className="settings-workspace-fields"
      data-testid="workspace-entry-documents"
    >
      <div className="settings-entry-heading">
        <span>{zh ? '阅读入口' : 'Reading entries'}</span>
        <button type="button" onClick={() => setPicker(true)}>
          <Plus size={16} />
          {zh ? '添加入口…' : 'Add entry…'}
        </button>
      </div>
      {!ids.length && (
        <p>
          {zh
            ? '添加常用文档或画布作为阅读入口。'
            : 'Add documents or canvases as reading entries.'}
        </p>
      )}
      <ol>
        {ids.map((id, index) => {
          const file = choices.find((f) => f.id === id);
          const move = (offset: number) => {
            const next = [...ids];
            [next[index], next[index + offset]] = [
              next[index + offset]!,
              next[index]!,
            ];
            void commit(next);
          };
          return (
            <li
              key={id}
              draggable
              onDragStart={() => setDrag(id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (drag && drag !== id) {
                  const next = ids.filter((x) => x !== drag);
                  next.splice(next.indexOf(id), 0, drag);
                  void commit(next);
                }
                setDrag(undefined);
              }}
            >
              <span>
                {file?.title ?? (zh ? '文件不存在' : 'Missing file')}{' '}
                <small>{file?.path ?? id}</small>
              </span>
              <button
                type="button"
                aria-label={`${zh ? '上移' : 'Move up'} ${file?.title ?? id}`}
                disabled={index === 0}
                onClick={() => move(-1)}
              >
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                aria-label={`${zh ? '下移' : 'Move down'} ${file?.title ?? id}`}
                disabled={index === ids.length - 1}
                onClick={() => move(1)}
              >
                <ArrowDown size={14} />
              </button>
              <button
                type="button"
                aria-label={`${zh ? '移除' : 'Remove'} ${file?.title ?? id}`}
                onClick={() => void commit(ids.filter((_, i) => i !== index))}
              >
                <X size={14} />
              </button>
            </li>
          );
        })}
      </ol>
      {picker && (
        // Escape dismisses only the nested file picker, preserving the settings dialog.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          className="settings-entry-picker"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setPicker(false);
            }
          }}
          role="dialog"
          aria-label={zh ? '添加阅读入口' : 'Add reading entries'}
        >
          <header>
            <input
              ref={(element) => element?.focus()}
              type="search"
              aria-label={zh ? '搜索文件' : 'Find files'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="button" onClick={() => setPicker(false)}>
              <X size={16} />
            </button>
          </header>
          <div className="settings-entry-choices">
            {choices
              .filter(
                (f) =>
                  !ids.includes(f.id) &&
                  `${f.title} ${f.path}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
              )
              .slice(0, 50)
              .map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => void commit([...ids, f.id])}
                >
                  {zh ? '添加' : 'Add'} {f.title} <small>{f.path}</small>
                </button>
              ))}
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
