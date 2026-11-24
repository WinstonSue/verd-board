import {
  WorkspaceAlert,
  WorkspaceButton,
  WorkspaceInput,
  WorkspaceTag,
} from '../shared/workspace-design';
import { Copy, Search } from 'lucide-react';
import { ConfigProvider, Menu, theme } from '@sue/design-web-react';
import {
  SettingsPage,
  SettingsSection,
  SettingsRow,
  Disclosure,
} from '../shared/components/settings-layout';
import { SettingsDraftProvider } from '../shared/settings-draft';
import { useEffect, useRef, useState } from 'react';
import { useActionSource } from '@sue/board-react-actions';
import { SettingsPageShell } from './settings-page-shell';
import {
  FrameSettingsContent,
  useApplicationSettingsModel,
} from './application-settings';
import {
  WorkspaceGeneralSettings,
  useWorkspaceSettingsDefinition,
  type WorkspaceSettingsProps,
} from './workspace-settings-content';
import { BuiltinWorkspaceSettings } from './builtin-workspace-settings';
import { WorkspaceTrash } from '../workspace/workspace-trash';
import { WorkspaceSkillsSettings } from './workspace-skills-settings';
import { useMindMaxWidth } from '../shared/preferences/mind-preferences';
import { SettingsSelect } from '../shared/settings-select';
import {
  agentNames,
  readDefaultAgent,
  setDefaultAgent,
} from '../shared/preferences/agent-preferences';
import './settings-sections.scss';

export interface SettingsCenterProps {
  section: string;
  onSection(section: string): void;
  onBack(): void;
  onSetDefaultFileApplications?(): Promise<void>;
  workspace?: WorkspaceSettingsProps;
  testId?: string;
  backTestId?: string;
  backLabel?: string;
}

function SettingsCenterContent({
  section,
  onSection,
  onBack,
  onSetDefaultFileApplications,
  workspace,
  testId = 'settings-center',
  backTestId = 'settings-center-back',
  backLabel,
  drafts,
}: SettingsCenterProps & { drafts: Map<string, () => Promise<boolean>> }) {
  const { language, definition: personal } = useApplicationSettingsModel();
  const { token } = theme.useToken();
  const zh = (workspace?.locale ?? language) === 'zh';
  const width = useMindMaxWidth();
  const project = useWorkspaceSettingsDefinition(
    zh,
    width,
    workspace?.config ?? {},
    workspace?.defaultName ?? '',
  );
  useActionSource(workspace?.actionSource);
  const state = workspace?.actionSource?.getActionState(
    'workspace.settings.patch',
    {},
  );
  const disabled =
    workspace?.readonly ||
    (!!state && !state.enabled && state.reason !== 'pending');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [focusTarget, setFocusTarget] = useState<string>();
  const content = useRef<HTMLDivElement>(null);
  const defaultAgentLabel = zh ? '默认 Agent' : 'Default Agent';
  const sections = [
    {
      id: 'personal.general',
      label: zh ? '外观' : 'Appearance',
      group: zh ? '个人偏好' : 'Personal',
    },
    {
      id: 'personal.editor',
      label: zh ? '编辑' : 'Editor',
      group: zh ? '个人偏好' : 'Personal',
    },
    {
      id: 'personal.agent',
      label: 'Agent',
      group: zh ? '个人偏好' : 'Personal',
    },
    ...(workspace
      ? [
          { id: 'workspace.project', label: zh ? '常规' : 'General' },
          ...(workspace.versioning
            ? [
                {
                  id: 'workspace.versions',
                  label: zh ? '版本管理' : 'Version management',
                },
              ]
            : []),
          ...(workspace.skills
            ? [
                { id: 'workspace.skills', label: zh ? '提示词' : 'Prompts' },
                {
                  id: 'workspace.custom-skills',
                  label: zh ? '自定义 Skills' : 'Custom Skills',
                },
              ]
            : []),
          {
            id: 'workspace.data',
            label: zh ? '数据与维护' : 'Data and maintenance',
          },
          ...(workspace.trash
            ? [{ id: 'workspace.trash', label: zh ? '回收站' : 'Trash' }]
            : []),
        ].map((s) => ({
          ...s,
          group: workspace.config.name || workspace.defaultName,
        }))
      : []),
  ];
  const normalized = normalizeSettingsSection(section);
  const selected = sections.some((s) => s.id === normalized)
    ? normalized
    : 'personal.general';
  const [storageError, setStorageError] = useState('');
  const [defaultApplicationError, setDefaultApplicationError] = useState('');
  const [copiedLocation, setCopiedLocation] = useState('');
  const [copyingLocation, setCopyingLocation] = useState(false);
  useEffect(() => {
    if (!copiedLocation) return;
    const timer = setTimeout(() => setCopiedLocation(''), 2000);
    return () => clearTimeout(timer);
  }, [copiedLocation]);
  const copyStorageLocation = async () => {
    if (!workspace?.storageLocation || copyingLocation) return;
    setStorageError('');
    setCopiedLocation('');
    setCopyingLocation(true);
    try {
      await navigator.clipboard.writeText(workspace.storageLocation);
      setCopiedLocation(workspace.storageLocation);
    } catch {
      setStorageError(
        zh
          ? '复制失败，请重试或手动选择地址复制。'
          : 'Could not copy. Try again or select and copy the path manually.',
      );
    } finally {
      setCopyingLocation(false);
    }
  };
  const [mobileContent, setMobileContent] = useState(false);
  const navigate = async (target: string) => {
    for (const save of drafts.values()) if (!(await save())) return;
    onSection(normalizeSettingsSection(target));
    setMobileContent(true);
    return true;
  };
  const close = async () => {
    for (const save of drafts.values()) if (!(await save())) return;
    onBack();
  };
  const fields = [
    {
      key: 'defaultAgent',
      label: defaultAgentLabel,
      description: '',
      section: 'personal.agent',
    },
    ...personal.fields.map((f) => ({
      key: f.key,
      label: String(f.label ?? f.key),
      description: String(f.description ?? ''),
      section: f.group === 'general' ? 'personal.general' : 'personal.editor',
    })),
    ...(workspace
      ? project.fields.map((f) => ({
          key: f.key,
          label: String(f.label ?? f.key),
          description: String(f.description ?? ''),
          section: 'workspace.project',
        }))
      : []),
  ];
  const term = query.trim().toLowerCase();
  const results = [
    ...fields.map((f) => ({
      ...f,
      path: sections.find((s) => s.id === f.section)!.label,
    })),
    ...sections
      .filter((s) => !fields.some((f) => f.section === s.id))
      .map((s) => ({
        key: '',
        label: s.label,
        description: '',
        section: s.id,
        path: s.group,
      })),
  ].filter((f) =>
    `${f.label} ${f.description} ${f.path}`.toLowerCase().includes(term),
  );
  useEffect(() => {
    if (!focusTarget || query) return;
    const field = [
      ...(content.current?.querySelectorAll<HTMLElement>(
        '[data-setting-key]',
      ) ?? []),
    ].find((e) => e.dataset['settingKey'] === focusTarget);
    if (!field && focusTarget !== 'section') return;
    const target =
      field?.querySelector<HTMLElement>(
        'input, select, textarea, button, [role="slider"]',
      ) ?? content.current;
    target?.focus();
    field?.scrollIntoView?.({ block: 'nearest' });
    setFocusTarget(undefined);
  }, [focusTarget, selected, query]);
  const w = workspace;
  return (
    <SettingsPageShell
      title={zh ? '设置' : 'Settings'}
      backLabel={backLabel ?? (zh ? '返回工作区' : 'Back to workspace')}
      onBack={() => void close()}
      backDisabled={busy}
      className={`settings-sections ${mobileContent ? 'settings-show-content' : ''}`}
      contentClassName="settings-sections-layout"
      testId={testId}
      backTestId={backTestId}
    >
      <nav
        className="settings-sections-nav"
        aria-label={zh ? '设置栏目' : 'Settings sections'}
      >
        <div className="settings-search-anchor">
          <div className="settings-search">
            <WorkspaceInput
              type="search"
              prefix={<Search strokeWidth={1.75} size={16} aria-hidden />}
              placeholder={zh ? '搜索设置' : 'Search settings'}
              aria-label={zh ? '搜索设置' : 'Search settings'}
              data-testid="settings-search"
              value={query}
              disabled={busy}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery('');
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  document
                    .querySelector<HTMLButtonElement>('.settings-search-result')
                    ?.focus();
                }
              }}
            />
          </div>
          {term && (
            <div
              className="settings-search-results"
              aria-label={zh ? '设置搜索结果' : 'Settings search results'}
            >
              {results.map((f) => (
                <WorkspaceButton
                  intent="ghost"
                  className="settings-search-result"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      setQuery('');
                    }
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      const items = [
                        ...e.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                          '.settings-search-result',
                        ),
                      ];
                      items[
                        Math.max(
                          0,
                          Math.min(
                            items.length - 1,
                            items.indexOf(e.currentTarget) +
                              (e.key === 'ArrowDown' ? 1 : -1),
                          ),
                        )
                      ]?.focus();
                    }
                  }}
                  type="button"
                  key={`${f.section}:${f.key}`}
                  onClick={async () => {
                    if (await navigate(f.section)) {
                      setFocusTarget(f.key || 'section');
                      setQuery('');
                    }
                  }}
                >
                  <span className="settings-result-content">
                    <span>{f.label}</span>
                    <small>
                      {sections.find((s) => s.id === f.section)?.group} /{' '}
                      {f.path}
                    </small>
                  </span>
                </WorkspaceButton>
              ))}
              {!results.length && (
                <p>{zh ? '没有匹配的设置' : 'No matching settings'}</p>
              )}
            </div>
          )}
        </div>
        <ConfigProvider
          theme={{
            components: {
              Menu: {
                itemHeight: token.controlHeight,
                itemMarginInline: 0,
                itemMarginBlock: 0,
                groupTitleFontSize: token.fontSizeSM,
                padding: token.paddingSM,
              },
            },
          }}
        >
          <Menu
            mode="inline"
            inlineIndent={token.paddingSM}
            aria-label={zh ? '设置栏目' : 'Settings sections'}
            selectedKeys={[selected]}
            disabled={busy}
            styles={{ root: { borderInlineEnd: 0, background: 'transparent' } }}
            items={['personal', ...(workspace ? ['workspace'] : [])].map(
              (scope) => {
                const entries = sections.filter((s) =>
                  s.id.startsWith(`${scope}.`),
                );
                return {
                  type: 'group',
                  key: scope,
                  label: entries[0]!.group,
                  children: entries.map((s) => ({
                    key: s.id,
                    label: s.label,
                    disabled: busy,
                    'data-testid': `settings-nav-${s.id}`,
                    'aria-current':
                      selected === s.id ? ('page' as const) : undefined,
                  })),
                };
              },
            )}
            onClick={({ key }) => {
              if (busy) return;
              setQuery('');
              void navigate(key);
            }}
          />
        </ConfigProvider>
      </nav>
      <main className="settings-sections-main">
        <WorkspaceButton
          type="button"
          intent="ghost"
          className="settings-mobile-back"
          onClick={() => setMobileContent(false)}
        >
          {zh ? '返回设置栏目' : 'All settings'}
        </WorkspaceButton>

        <div
          ref={content}
          tabIndex={-1}
          className="frame-settings-content settings-sections-panel"
        >
          <SettingsPage
            title={sections.find((s) => s.id === selected)!.label}
            description={
              selected.startsWith('personal.')
                ? zh
                  ? '保存在本机，对所有工作区生效。'
                  : 'Stored on this device; applies to all workspaces.'
                : zh
                  ? '当前工作区配置随项目保存。'
                  : 'Configuration is saved with this workspace.'
            }
            status={
              selected.startsWith('workspace.') &&
              w?.persistence && (
                <div
                  role={w.persistence.status === 'error' ? 'alert' : 'status'}
                  data-testid="settings-workspace-save"
                >
                  <WorkspaceTag
                    color={
                      w.persistence.status === 'error' ? 'error' : undefined
                    }
                  >
                    {(
                      {
                        saved: zh ? '已保存' : 'Saved',
                        saving: zh ? '保存中' : 'Saving',
                        idle: zh ? '就绪' : 'Ready',
                        error: zh ? '保存失败' : 'Save failed',
                      } as Record<string, string>
                    )[w.persistence.status] ?? w.persistence.status}
                  </WorkspaceTag>
                  {w.persistence.error && (
                    <WorkspaceAlert type="error" title={w.persistence.error} />
                  )}
                  {w.persistence.status === 'error' && (
                    <WorkspaceButton
                      intent="ghost"
                      size="small"
                      type="button"
                      onClick={w.persistence.onRetry}
                    >
                      {zh ? '重试保存' : 'Retry save'}
                    </WorkspaceButton>
                  )}
                </div>
              )
            }
          />
          {(selected === 'personal.general' ||
            selected === 'personal.editor') && (
            <FrameSettingsContent
              section={selected === 'personal.editor' ? 'editor' : 'general'}
            />
          )}
          {selected === 'personal.agent' && (
            <SettingsSection title="Agent">
              <div
                className="settings-form-row"
                data-setting-key="defaultAgent"
              >
                <span>{defaultAgentLabel}</span>
                <SettingsSelect
                  aria-label={defaultAgentLabel}
                  data-testid="settings-default-agent"
                  value={readDefaultAgent()}
                  options={[{ value: 'codex', label: agentNames.codex }]}
                  onChange={setDefaultAgent}
                />
              </div>
            </SettingsSection>
          )}
          {selected === 'personal.general' && onSetDefaultFileApplications && (
            <SettingsSection title={zh ? '文件打开方式' : 'File associations'}>
              <SettingsRow
                label={
                  zh ? 'Markdown 和 .verd 画布' : 'Markdown and .verd canvases'
                }
              >
                <WorkspaceButton
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setDefaultApplicationError('');
                    try {
                      await onSetDefaultFileApplications();
                    } catch (error) {
                      setDefaultApplicationError(String(error));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {zh ? '设置默认打开方式' : 'Set default application'}
                </WorkspaceButton>
              </SettingsRow>
              <p>
                {zh
                  ? '按操作系统提示确认默认应用。'
                  : 'Confirm the default application in the system prompt.'}
              </p>
              {defaultApplicationError && (
                <WorkspaceAlert type="error" title={defaultApplicationError} />
              )}
            </SettingsSection>
          )}
          {w && selected.startsWith('workspace.') && (
            <>
              {selected === 'workspace.project' && (
                <fieldset
                  disabled={disabled || busy}
                  className="settings-workspace-fields"
                >
                  <WorkspaceGeneralSettings
                    {...w}
                    disabled={!!disabled || busy}
                    globalWidth={width}
                    zh={zh}
                  />
                </fieldset>
              )}
              {(selected === 'workspace.skills' ||
                selected === 'workspace.custom-skills') &&
                w.skills && (
                  <WorkspaceSkillsSettings
                    key={`${w.skills.workspaceKey}:${selected}`}
                    custom={selected === 'workspace.custom-skills'}
                    model={w.skills}
                    zh={zh}
                    disabled={!!disabled}
                    drafts={drafts}
                    onBusy={setBusy}
                  />
                )}
              {selected === 'workspace.versions' &&
                w.versioning?.render({
                  readonly: !!w.readonly,
                  onBusyChange: setBusy,
                })}
              {selected === 'workspace.data' && (
                <>
                  {w.storage && (
                    <SettingsSection title={zh ? '存储位置' : 'Storage'}>
                      <SettingsRow label={zh ? '工作区资料' : 'Workspace data'}>
                        {w.storage !== 'browser' && w.storageLocation ? (
                          <div className="settings-storage-location">
                            {w.onOpenStorage ? (
                              <WorkspaceButton
                                type="button"
                                intent="ghost"
                                className="settings-storage-path"
                                data-testid="workspace-storage-location"
                                title={w.storageLocation}
                                onClick={() => {
                                  setStorageError('');
                                  void w.onOpenStorage!().catch((e) =>
                                    setStorageError(String(e)),
                                  );
                                }}
                              >
                                {w.storageLocation}
                              </WorkspaceButton>
                            ) : (
                              <span
                                className="settings-storage-path"
                                data-testid="workspace-storage-location"
                              >
                                {w.storageLocation}
                              </span>
                            )}
                            <WorkspaceButton
                              type="button"
                              intent="ghost"
                              size="small"
                              icon={<Copy size={14} aria-hidden />}
                              data-testid="workspace-storage-copy"
                              disabled={copyingLocation}
                              onClick={() => void copyStorageLocation()}
                            >
                              {zh ? '复制地址' : 'Copy path'}
                            </WorkspaceButton>
                            <span
                              role="status"
                              className="settings-storage-copy-status"
                            >
                              {copiedLocation === w.storageLocation
                                ? zh
                                  ? '已复制'
                                  : 'Copied'
                                : ''}
                            </span>
                          </div>
                        ) : (
                          <span>
                            {w.storage === 'browser'
                              ? zh
                                ? '当前浏览器 · IndexedDB'
                                : 'This browser · IndexedDB'
                              : zh
                                ? '正在读取位置…'
                                : 'Reading location…'}
                          </span>
                        )}
                      </SettingsRow>
                      {w.directoryContext && (
                        <>
                          <SettingsRow label={zh ? '所属项目' : 'Project'}>
                            <code>{w.directoryContext.projectRoot}</code>
                          </SettingsRow>
                          <SettingsRow
                            label={zh ? '项目内目录' : 'Directory in project'}
                          >
                            <code>
                              {w.directoryContext.workspacePath || '.'}
                            </code>
                          </SettingsRow>
                          {w.directoryContext.repositoryRoot && (
                            <SettingsRow
                              label={zh ? 'Git 仓库' : 'Git repository'}
                            >
                              <code>{w.directoryContext.repositoryRoot}</code>
                            </SettingsRow>
                          )}
                        </>
                      )}
                      {storageError && (
                        <WorkspaceAlert type="error" title={storageError} />
                      )}
                    </SettingsSection>
                  )}
                  {w.onMigrateBrowserData && (
                    <SettingsSection title={zh ? '浏览器数据' : 'Browser data'}>
                      <WorkspaceButton
                        disabled={disabled || busy}
                        onClick={w.onMigrateBrowserData}
                      >
                        {zh ? '迁移浏览器数据' : 'Migrate browser data'}
                      </WorkspaceButton>
                    </SettingsSection>
                  )}
                  {w.agent && (
                    <SettingsSection
                      title={zh ? '外部 AI 助手' : 'External AI assistants'}
                      data-testid="workspace-agent-status"
                    >
                      <p>
                        {zh
                          ? '让可访问本地文件、执行命令的 AI 助手，按青编格式创建和修改文档、图表。'
                          : 'Let an AI assistant with local file and command access create and edit VerdBoard documents and diagrams.'}
                      </p>
                      <WorkspaceTag>
                        {w.agent.enabled === false
                          ? zh
                            ? '尚未启用编写工具'
                            : 'Authoring tools not enabled'
                          : w.agent.ready
                            ? zh
                              ? '编写工具已就绪'
                              : 'Authoring tools ready'
                            : zh
                              ? '编写工具暂不可用'
                              : 'Authoring tools unavailable'}
                      </WorkspaceTag>
                      {w.onInitializeAgent && !w.agent.ready && (
                        <WorkspaceButton
                          disabled={disabled || busy}
                          onClick={() => {
                            setBusy(true);
                            setStorageError('');
                            void w.onInitializeAgent!()
                              .catch((error) => setStorageError(String(error)))
                              .finally(() => setBusy(false));
                          }}
                        >
                          {zh
                            ? '启用或修复编写工具'
                            : 'Enable or repair authoring tools'}
                        </WorkspaceButton>
                      )}
                      <p>
                        {w.agent.enabled === false
                          ? zh
                            ? '启用后仅在当前工作区写入编写入口，不修改所属项目根目录的规范。'
                            : 'Enabling adds authoring instructions to this workspace only, preserving the enclosing project rules.'
                          : w.agent.ready
                            ? zh
                              ? '在 AI 助手中打开上方工作区目录，让它读取 AGENTS.md，再描述要创建或修改的内容。'
                              : 'Open the workspace folder above in your AI assistant, ask it to read AGENTS.md, then describe what you want to create or change.'
                            : zh
                              ? '重新打开工作区后重试；若仍不可用，请查看诊断详情。'
                              : 'Reopen the workspace and try again. If tools are still unavailable, check the diagnostics.'}
                      </p>
                      {w.agent.enabled !== false &&
                        w.agent.diagnostics.length > 0 && (
                          <Disclosure label={zh ? '诊断详情' : 'Diagnostics'}>
                            <div className="vm-diagnostics">
                              {w.agent.diagnostics.map((d, i) => (
                                <p key={i}>
                                  {d.code}: {d.message}
                                </p>
                              ))}
                            </div>
                          </Disclosure>
                        )}
                    </SettingsSection>
                  )}
                  {w.builtin && (
                    <BuiltinWorkspaceSettings
                      source={w.builtin}
                      zh={zh}
                      readonly={(w.builtinReadonly ?? disabled) || busy}
                      onBusy={setBusy}
                    />
                  )}
                </>
              )}
              {selected === 'workspace.trash' && w.trash && (
                <WorkspaceTrash
                  {...w.trash}
                  readonly={w.readonly || w.trash.readonly}
                  locale={zh ? 'zh' : 'en'}
                  onBusyChange={setBusy}
                />
              )}
            </>
          )}
        </div>
      </main>
    </SettingsPageShell>
  );
}

export type SettingsSectionId =
  | 'personal.general'
  | 'personal.editor'
  | 'personal.agent'
  | 'workspace.project'
  | 'workspace.skills'
  | 'workspace.custom-skills'
  | 'workspace.versions'
  | 'workspace.data'
  | 'workspace.trash';
export function normalizeSettingsSection(section: string): SettingsSectionId {
  if (section === 'personal.mind' || section === 'personal.interaction')
    return 'personal.editor';
  if (section === 'workspace.defaults') return 'workspace.project';
  if (section === 'workspace.agent') return 'workspace.data';
  return (
    [
      'personal.general',
      'personal.editor',
      'personal.agent',
      'workspace.project',
      'workspace.skills',
      'workspace.custom-skills',
      'workspace.versions',
      'workspace.data',
      'workspace.trash',
    ].includes(section)
      ? section
      : 'personal.general'
  ) as SettingsSectionId;
}
export function SettingsCenter(props: SettingsCenterProps) {
  const drafts = useRef(new Map<string, () => Promise<boolean>>()).current;
  const registerFlush = props.workspace?.onRegisterFlush;
  useEffect(() => {
    registerFlush?.(async () => {
      for (const save of drafts.values()) if (!(await save())) return false;
      return true;
    });
    return () => registerFlush?.(null);
  }, [drafts, registerFlush]);
  return (
    <SettingsDraftProvider drafts={drafts}>
      <SettingsCenterContent {...props} drafts={drafts} />
    </SettingsDraftProvider>
  );
}
