import { useEffect, useMemo, useRef, useState } from 'react';
import {
  WorkspaceAlert,
  WorkspaceButton,
  WorkspaceInput,
  WorkspaceTextArea,
} from './workspace-design';
import { SettingsSection, SettingsActions } from './components/settings-layout';
import {
  DefaultSkillViewer,
  type DefaultSkillContent,
} from './default-skill-viewer';

interface SkillValues {
  diagnostic?: string;
  description: string;
  body: string;
  source: string;
  version: string | null;
}
interface SkillMutation {
  create?: boolean;
  path: string;
  transactionId: string;
  version: string | null;
}
type SkillResult =
  | { status: 'accepted' }
  | { status: 'rejected'; message: string; unconfirmed?: boolean };
export interface WorkspaceSkillsSettingsProps {
  workspaceKey: string;
  items: { path: string; name: string; label: string; version?: string }[];
  customItems?: WorkspaceSkillsSettingsProps['items'];
  load(path: string): Promise<SkillValues>;
  save(values: SkillValues & SkillMutation): Promise<SkillResult>;
  remove(values: SkillMutation): Promise<SkillResult>;
  readDefault(path: string): Promise<DefaultSkillContent | string>;
}

export function WorkspaceSkillsSettings({
  model,
  zh,
  disabled,
  drafts,
  onBusy,
  custom = false,
}: {
  model: WorkspaceSkillsSettingsProps;
  zh: boolean;
  disabled: boolean;
  drafts: Map<string, () => Promise<boolean>>;
  onBusy(value: boolean): void;
  custom?: boolean;
}) {
  const items = useMemo(
    () => (custom ? (model.customItems ?? []) : model.items),
    [custom, model.customItems, model.items],
  );
  const [path, setPath] = useState(items[0]?.path ?? '');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const item = items.find((entry) => entry.path === path) ?? {
    path,
    name: path.split('/')[2] ?? '',
    label: path.split('/')[2] ?? '',
    version: undefined,
  };
  const [saved, setSaved] = useState<SkillValues | null>(null);
  const [draft, setDraft] = useState({ description: '', body: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [external, setExternal] = useState(false);
  const [guide, setGuide] = useState<DefaultSkillContent | string | null>(null);
  const [guideError, setGuideError] = useState('');
  const [guideLoading, setGuideLoading] = useState(false);
  const composing = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const pending = useRef<Promise<boolean> | null>(null);
  const retry = useRef<{
    operation: 'save' | 'remove';
    values: SkillValues & SkillMutation;
  } | null>(null);
  const latest = useRef({
    model,
    saved,
    draft,
    path,
    disabled,
    creating,
    newName,
  });
  latest.current = { model, saved, draft, path, disabled, creating, newName };
  const dirty = creating
    ? !!(newName || draft.description || draft.body)
    : !!saved &&
      (saved.description !== draft.description || saved.body !== draft.body);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const reload = async () => {
    const token = ++generation.current;
    if (!latest.current.path) {
      setSaved(null);
      setLoading(false);
      setError('');
      return;
    }
    setLoading(true);
    try {
      const value = await latest.current.model.load(latest.current.path);
      if (!alive.current || token !== generation.current) return;
      setSaved(value);
      setDraft({ description: value.description, body: value.body });
      latest.current.saved = value;
      latest.current.draft = {
        description: value.description,
        body: value.body,
      };
      dirtyRef.current = false;
      setExternal(false);
      setError('');
    } catch (cause) {
      if (alive.current && token === generation.current)
        setError(String(cause));
    } finally {
      if (alive.current && token === generation.current) setLoading(false);
    }
  };
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (creating) return;
    setSaved(null);
    latest.current.saved = null;
    dirtyRef.current = false;
    setGuide(null);
    setGuideError('');
    void reloadRef.current();
  }, [path, model.workspaceKey, creating]);
  useEffect(() => {
    if (!path && !creating && items.length) setPath(items[0].path);
  }, [path, creating, items]);
  useEffect(() => {
    if (!latest.current.saved || pending.current) return;
    // A successful save already loaded this version. Host notifications may
    // arrive later; reloading again would interrupt a newly opened scope menu.
    if ((latest.current.saved.version ?? undefined) === item?.version) return;
    if (dirtyRef.current || retry.current) setExternal(true);
    else void reloadRef.current();
  }, [item?.version]);

  const commit = (operation: 'save' | 'remove' = 'save'): Promise<boolean> => {
    if (pending.current)
      return pending.current.then((ok) => (ok ? saveRef.current() : false));
    const current = latest.current;
    if (composing.current) return Promise.resolve(false);
    if (current.disabled || !current.saved)
      return Promise.resolve(!retry.current);
    if (
      current.creating &&
      !(current.newName || current.draft.description || current.draft.body)
    )
      return Promise.resolve(true);
    if (
      operation === 'save' &&
      !current.creating &&
      !retry.current &&
      current.saved.description === current.draft.description &&
      current.saved.body === current.draft.body
    )
      return Promise.resolve(true);
    const request = retry.current ?? {
      operation,
      values: {
        ...current.saved,
        ...current.draft,
        path: current.creating
          ? `.agents/skills/${current.newName.trim()}/SKILL.md`
          : current.path,
        create: current.creating,
        transactionId: crypto.randomUUID(),
      },
    };
    retry.current = request;
    setSaving(true);
    onBusy(true);
    const task = Promise.resolve().then(async () => {
      try {
        const result = await current.model[request.operation](request.values);
        if (result.status === 'rejected') {
          if (!result.unconfirmed) retry.current = null;
          throw new Error(result.message);
        }
        retry.current = null;
        if (custom && request.operation === 'remove') {
          const next =
            latest.current.model.customItems?.find(
              (entry) => entry.path !== request.values.path,
            )?.path ?? '';
          setPath(next);
          latest.current.path = next;
        } else if (request.values.create) {
          setCreating(false);
          latest.current.creating = false;
          setPath(request.values.path);
          latest.current.path = request.values.path;
        }
        if (alive.current) await reloadRef.current();
        return true;
      } catch (cause) {
        if (alive.current)
          setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      } finally {
        pending.current = null;
        if (alive.current) {
          setSaving(false);
          onBusy(false);
        }
      }
    });
    pending.current = task;
    return task;
  };
  const saveRef = useRef(() => commit());
  saveRef.current = () => commit();
  useEffect(() => {
    const key = 'workspace-skill-editor';
    drafts.set(key, () => saveRef.current());
    return () => {
      drafts.delete(key);
    };
  }, [drafts]);
  const locked =
    disabled ||
    loading ||
    saving ||
    !!retry.current ||
    !saved ||
    !!saved.diagnostic;
  const beginCreate = () => {
    void saveRef.current().then((ok) => {
      if (!ok) return;
      generation.current++;
      setCreating(true);
      setNewName('');
      setPath('');
      const empty = { source: '', version: null, description: '', body: '' };
      setSaved(empty);
      setDraft({ description: '', body: '' });
      setLoading(false);
      setError('');
      setExternal(false);
    });
  };
  const viewDefault = () => {
    const token = generation.current;
    setGuideLoading(true);
    setGuideError('');
    void model
      .readDefault(custom ? '' : path)
      .then((value) => {
        if (alive.current && token === generation.current) setGuide(value);
      })
      .catch((cause) => {
        if (alive.current && token === generation.current)
          setGuideError(String(cause));
      })
      .finally(() => {
        if (alive.current) setGuideLoading(false);
      });
  };
  return (
    <div data-testid="workspace-skills-settings">
      <p>
        {custom
          ? zh
            ? '独立维护当前工作区的 Skill，Agent 根据名称和描述按需读取，不绑定默认范式。'
            : 'Maintain independent workspace Skills. Agents select them by name and description.'
          : zh
            ? '在默认范式基础上补充当前工作区的术语、语言、结构与风格要求。'
            : 'Supplement the default patterns with workspace terminology, language, structure and style.'}
      </p>
      <div className="workspace-skill-toolbar">
        {custom && (
          <WorkspaceButton
            type="button"
            disabled={disabled || saving || !!retry.current}
            data-testid="workspace-custom-skill-new"
            onClick={beginCreate}
          >
            {zh ? '新建自定义 Skill' : 'New custom Skill'}
          </WorkspaceButton>
        )}
        <WorkspaceButton
          type="button"
          intent="ghost"
          disabled={guideLoading}
          data-testid="workspace-skill-default"
          onClick={viewDefault}
        >
          {custom
            ? zh
              ? '查看通用编写 Skill'
              : 'View authoring Skill'
            : zh
              ? '查看默认 Skill'
              : 'View default Skill'}
        </WorkspaceButton>
      </div>
      {guideError && <WorkspaceAlert type="error" title={guideError} />}
      {!creating && items.length > 0 && (
        <label className="workspace-skill-field">
          {custom
            ? zh
              ? '自定义 Skill 列表'
              : 'Custom Skills'
            : zh
              ? '提示词范围'
              : 'Skill scope'}
          <select
            className="workspace-skill-scope"
            value={path}
            disabled={saving || loading}
            aria-label={zh ? '提示词范围' : 'Skill scope'}
            data-testid="workspace-skill-scope"
            onChange={(event) => {
              const value = event.target.value;
              void saveRef.current().then((ok) => {
                if (ok) setPath(value);
              });
            }}
          >
            {items.map((choice) => (
              <option key={choice.path} value={choice.path}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {custom && !creating && !path && (
        <p data-testid="workspace-custom-skill-empty">
          {zh
            ? '暂无自定义 Skill，点击“新建自定义 Skill”开始维护。'
            : 'No custom Skills yet. Create one to get started.'}
        </p>
      )}
      {(path || creating) && (
        <SettingsSection
          title={
            creating
              ? zh
                ? '新建自定义 Skill'
                : 'New custom Skill'
              : custom
                ? item.label
                : `${item.label} · ${zh ? '自定义补充要求' : 'Custom supplement'}`
          }
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void commit();
            }}
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              )
                void saveRef.current();
            }}
            onKeyDownCapture={(event) => {
              if (
                event.key === 'Enter' &&
                (event.metaKey || event.ctrlKey) &&
                !composing.current
              ) {
                event.preventDefault();
                void commit();
              }
              if (
                event.key === 'Escape' &&
                !composing.current &&
                saved &&
                !retry.current &&
                !saving
              ) {
                event.preventDefault();
                event.stopPropagation();
                setDraft({ description: saved.description, body: saved.body });
                if (creating) setNewName('');
                setError('');
              }
            }}
          >
            <fieldset disabled={locked} className="settings-workspace-fields">
              <label className="workspace-skill-field">
                {zh ? '名称' : 'Name'}
                <WorkspaceInput
                  value={creating ? newName : item.name}
                  readOnly={!creating}
                  data-testid="workspace-custom-skill-name"
                  placeholder="domain-writing"
                  maxLength={64}
                  onChange={(event) => setNewName(event.target.value)}
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onCompositionEnd={() => {
                    composing.current = false;
                  }}
                />
              </label>
              <label className="workspace-skill-field">
                {zh ? '用途描述' : 'Description'}
                <WorkspaceInput
                  value={draft.description}
                  maxLength={1024}
                  data-testid="workspace-skill-description"
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      description: event.target.value,
                    }))
                  }
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onCompositionEnd={() => {
                    composing.current = false;
                  }}
                />
              </label>
              <label className="workspace-skill-field">
                {zh ? '提示词正文（Markdown）' : 'Instructions (Markdown)'}
                <WorkspaceTextArea
                  value={draft.body}
                  rows={10}
                  data-testid="workspace-skill-body"
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      body: event.target.value,
                    }))
                  }
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onCompositionEnd={() => {
                    composing.current = false;
                  }}
                />
              </label>
            </fieldset>
            {loading && <p role="status">{zh ? '正在读取…' : 'Loading…'}</p>}
            {saved?.diagnostic && (
              <>
                <WorkspaceAlert type="error" title={saved.diagnostic} />
                <details>
                  <summary>{zh ? '查看原文' : 'View original source'}</summary>
                  <pre className="workspace-skill-guide">{saved.source}</pre>
                </details>
              </>
            )}
            {external && (
              <WorkspaceAlert
                type="warning"
                title={
                  zh
                    ? '文件已被外部修改，草稿已保留；请重新加载后编辑。'
                    : 'File changed externally. Your draft is preserved; reload before editing.'
                }
              />
            )}
            {error && <WorkspaceAlert type="error" title={error} />}
            <SettingsActions>
              <WorkspaceButton
                type="submit"
                disabled={
                  disabled ||
                  loading ||
                  saving ||
                  !!saved?.diagnostic ||
                  (!dirty && !retry.current)
                }
                data-testid="workspace-skill-save"
              >
                {saving
                  ? zh
                    ? '保存中…'
                    : 'Saving…'
                  : retry.current
                    ? zh
                      ? '重试原操作'
                      : 'Retry operation'
                    : creating
                      ? zh
                        ? '创建 Skill'
                        : 'Create Skill'
                      : zh
                        ? '保存'
                        : 'Save'}
              </WorkspaceButton>
              <WorkspaceButton
                type="button"
                disabled={
                  disabled ||
                  loading ||
                  saving ||
                  !!retry.current ||
                  !saved?.version
                }
                data-testid="workspace-skill-remove"
                onClick={() => void commit('remove')}
              >
                {custom
                  ? zh
                    ? '删除 Skill'
                    : 'Delete Skill'
                  : zh
                    ? '移除补充'
                    : 'Remove supplement'}
              </WorkspaceButton>
              <WorkspaceButton
                type="button"
                disabled={saving || !!retry.current}
                data-testid="workspace-skill-reload"
                onClick={() => void reload()}
              >
                {dirty
                  ? zh
                    ? '重新加载（放弃草稿）'
                    : 'Reload (discard draft)'
                  : zh
                    ? '重新加载'
                    : 'Reload'}
              </WorkspaceButton>
            </SettingsActions>
            {creating && (
              <WorkspaceButton
                type="button"
                intent="ghost"
                disabled={saving || !!retry.current}
                data-testid="workspace-custom-skill-cancel"
                onClick={() => {
                  setCreating(false);
                  setPath(items[0]?.path ?? '');
                  setError('');
                }}
              >
                {zh
                  ? '取消新建（放弃草稿）'
                  : 'Cancel creation (discard draft)'}
              </WorkspaceButton>
            )}
          </form>
        </SettingsSection>
      )}
      {guide !== null && (
        <DefaultSkillViewer
          value={guide}
          zh={zh}
          onClose={() => setGuide(null)}
        />
      )}
    </div>
  );
}
