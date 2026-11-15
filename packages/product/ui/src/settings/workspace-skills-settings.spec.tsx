import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { WorkspaceDesignProvider } from '../shared/workspace-design';
import { SettingsCenter } from './settings-center';
import type { WorkspaceSkillsSettingsProps } from './workspace-skills-settings';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ??= function () {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function () {
  this.open = false;
};
let root: Root;
let container: HTMLDivElement;
const common = '.agents/skills/verd-workspace/SKILL.md';
const architecture = '.agents/skills/verd-pattern-architecture/SKILL.md';
const initial = {
  description: 'Workspace requirements',
  body: 'Original',
  source: 'original source',
  version: 'v1',
};
let model: WorkspaceSkillsSettingsProps;
let onSection: ReturnType<typeof vi.fn>;
async function render(section = 'workspace.skills') {
  await act(async () =>
    root.render(
      <I18nProvider defaultLanguage="zh" persistLanguage={false}>
        <WorkspaceDesignProvider>
          <SettingsCenter
            section={section}
            onSection={onSection}
            onBack={() => {}}
            workspace={{
              config: {},
              defaultName: 'Project',
              onConfig: vi.fn(),
              onBack: vi.fn(),
              skills: model,
            }}
          />
        </WorkspaceDesignProvider>
      </I18nProvider>,
    ),
  );
}
async function setup() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onSection = vi.fn();
  model = {
    workspaceKey: 'project-a',
    items: [
      {
        path: common,
        name: 'verd-workspace',
        label: '工作区通用',
        version: 'v1',
      },
      {
        path: architecture,
        name: 'verd-pattern-architecture',
        label: '架构图',
      },
    ],
    load: vi.fn(async (path) =>
      path === common
        ? { ...initial }
        : { ...initial, body: '', source: '', version: null },
    ),
    save: vi.fn(async () => ({ status: 'accepted' })),
    remove: vi.fn(async () => ({ status: 'accepted' })),
    readDefault: vi.fn(async () => 'Default pattern guidance'),
  };
  await render();
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  container.querySelector<T>(`[data-testid="${id}"]`)!;
async function fill(id: string, value: string) {
  await act(async () => {
    const input = element<HTMLInputElement | HTMLTextAreaElement>(id);
    Object.getOwnPropertyDescriptor(
      input.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const click = async (id: string) => act(async () => element(id).click());
async function chooseScope(label: string) {
  const control = element<HTMLSelectElement>('workspace-skill-scope');
  const option = [...control.options].find(
    (node) => node.textContent === label,
  )!;
  await act(async () => {
    control.value = option.value;
    control.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

it('saves description and body as one draft and prevents switching on rejection', async () => {
  await setup();
  model.save = vi.fn(async () => ({
    status: 'rejected',
    message: 'Disk changed',
  }));
  await render();
  await fill('workspace-skill-description', 'Project style');
  await fill('workspace-skill-body', 'Use Chinese.');
  await chooseScope('架构图');
  expect(model.save).toHaveBeenCalledWith(
    expect.objectContaining({
      path: common,
      description: 'Project style',
      body: 'Use Chinese.',
      version: 'v1',
    }),
  );
  expect(element<HTMLSelectElement>('workspace-skill-scope').value).toBe(
    common,
  );
  expect(element<HTMLTextAreaElement>('workspace-skill-body').value).toBe(
    'Use Chinese.',
  );
  await click('settings-nav-personal.editor');
  expect(onSection).not.toHaveBeenCalled();
  model.save = vi.fn(async (values) => {
    model.load = vi.fn(async () => ({ ...values, version: 'v2' }));
    return { status: 'accepted' };
  });
  await render();
  await click('settings-nav-personal.editor');
  expect(onSection).toHaveBeenCalledWith('personal.editor');
});

it('refreshes clean files but preserves drafts when an external edit arrives', async () => {
  await setup();
  await fill('workspace-skill-body', 'My draft');
  model.items[0].version = 'v2';
  model.load = vi.fn(async () => ({
    ...initial,
    body: 'External',
    version: 'v2',
  }));
  await render();
  expect(container.textContent).toContain('文件已被外部修改');
  expect(element<HTMLTextAreaElement>('workspace-skill-body').value).toBe(
    'My draft',
  );
  await click('workspace-skill-reload');
  expect(element<HTMLTextAreaElement>('workspace-skill-body').value).toBe(
    'External',
  );
  model.items[0].version = 'v3';
  model.load = vi.fn(async () => ({
    ...initial,
    body: 'New external',
    version: 'v3',
  }));
  await render();
  expect(element<HTMLTextAreaElement>('workspace-skill-body').value).toBe(
    'New external',
  );
});

it('retains the original unknown transaction and retries it before leaving settings', async () => {
  await setup();
  model.save = vi
    .fn()
    .mockResolvedValueOnce({
      status: 'rejected',
      message: 'Unconfirmed',
      unconfirmed: true,
    })
    .mockResolvedValueOnce({ status: 'accepted' });
  await render();
  await fill('workspace-skill-body', 'New instructions');
  await click('workspace-skill-save');
  expect(
    element<HTMLTextAreaElement>('workspace-skill-body').matches(':disabled'),
  ).toBe(true);
  await click('settings-nav-personal.editor');
  expect(model.save).toHaveBeenCalledTimes(2);
  const calls = vi.mocked(model.save).mock.calls;
  expect(calls[0][0]).toEqual(calls[1][0]);
  expect(onSection).toHaveBeenCalledWith('personal.editor');
});

it('keeps IME text in the draft until composition ends and opens default guidance', async () => {
  await setup();
  await act(async () =>
    element('workspace-skill-body').dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    ),
  );
  await fill('workspace-skill-body', '中文术语');
  await act(async () =>
    element('workspace-skill-body').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(element<HTMLTextAreaElement>('workspace-skill-body').value).toBe(
    '中文术语',
  );
  await click('workspace-skill-save');
  expect(model.save).not.toHaveBeenCalled();
  await act(async () =>
    element('workspace-skill-body').dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    ),
  );
  await click('workspace-skill-save');
  expect(model.save).toHaveBeenCalledOnce();
  await click('workspace-skill-default');
  expect(element('workspace-skill-guide').textContent).toBe(
    'Default pattern guidance',
  );
});

it('offers an independent custom Skill entry and creates a named document with fixed identity', async () => {
  await setup();
  model.customItems = [];
  const documents = new Map<string, typeof initial>();
  model.load = vi.fn(async (path) => documents.get(path)!);
  model.save = vi.fn(async (values) => {
    documents.set(values.path, {
      ...values,
      source: 'Saved source',
      version: 'v2',
    });
    model.customItems = [
      {
        path: values.path,
        name: 'domain-writing',
        label: 'domain-writing',
        version: 'v2',
      },
    ];
    return { status: 'accepted' };
  });
  await render('workspace.custom-skills');
  expect(element('workspace-custom-skill-empty')).toBeTruthy();
  await click('workspace-custom-skill-new');
  await fill('workspace-custom-skill-name', 'domain-writing');
  await fill('workspace-skill-description', 'Domain writing');
  await fill('workspace-skill-body', 'Use domain terms.');
  await click('workspace-skill-save');
  expect(model.save).toHaveBeenCalledWith(
    expect.objectContaining({
      create: true,
      path: '.agents/skills/domain-writing/SKILL.md',
      description: 'Domain writing',
      body: 'Use domain terms.',
      version: null,
    }),
  );
  expect(
    element<HTMLInputElement>('workspace-custom-skill-name').readOnly,
  ).toBe(true);
  expect(element<HTMLSelectElement>('workspace-skill-scope').value).toBe(
    '.agents/skills/domain-writing/SKILL.md',
  );
});

it('keeps a rejected creation draft and blocks leaving until it is saved or explicitly cancelled', async () => {
  await setup();
  model.customItems = [];
  model.save = vi.fn(async () => ({
    status: 'rejected',
    message: 'Name already exists',
  }));
  await render('workspace.custom-skills');
  await click('workspace-custom-skill-new');
  await fill('workspace-custom-skill-name', 'domain-writing');
  await fill('workspace-skill-description', 'Writing');
  await fill('workspace-skill-body', 'Keep my draft');
  await click('settings-nav-workspace.skills');
  expect(onSection).not.toHaveBeenCalled();
  expect(element<HTMLTextAreaElement>('workspace-skill-body').value).toBe(
    'Keep my draft',
  );
  expect(element<HTMLInputElement>('workspace-custom-skill-name').value).toBe(
    'domain-writing',
  );
  await click('workspace-custom-skill-cancel');
  expect(element('workspace-custom-skill-empty')).toBeTruthy();
});

it('shows malformed custom Skill source without enabling destructive form overwrites', async () => {
  await setup();
  const path = '.agents/skills/broken/SKILL.md';
  model.customItems = [
    { path, name: 'broken', label: 'broken', version: 'bad-v1' },
  ];
  model.load = vi.fn(async () => ({
    description: '',
    body: '',
    source: 'Original malformed source',
    version: 'bad-v1',
    diagnostic: 'Invalid YAML',
  }));
  await render('workspace.custom-skills');
  expect(container.textContent).toContain('Invalid YAML');
  expect(container.textContent).toContain('Original malformed source');
  expect(
    element<HTMLTextAreaElement>('workspace-skill-body').matches(':disabled'),
  ).toBe(true);
  expect(element<HTMLButtonElement>('workspace-skill-save').disabled).toBe(
    true,
  );
  expect(model.save).not.toHaveBeenCalled();
});
