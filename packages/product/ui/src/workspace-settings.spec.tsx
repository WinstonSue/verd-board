import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n';
import {
  WorkspaceSettings,
  type WorkspaceSettingsProps,
} from './workspace-settings';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};
let root: Root;
let container: HTMLDivElement;
const render = async (props: WorkspaceSettingsProps) =>
  act(async () =>
    root.render(
      <React.StrictMode>
        <I18nProvider defaultLanguage="zh" persistLanguage={false}>
          <WorkspaceSettings {...props} />
        </I18nProvider>
      </React.StrictMode>,
    ),
  );
const setup = async (patch: Partial<WorkspaceSettingsProps> = {}) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const props: WorkspaceSettingsProps = {
    config: {},
    defaultName: '项目甲',
    onConfig: vi.fn(),
    onBack: vi.fn(),
    trash: {
      workspaceName: '项目甲',
      entries: [
        {
          entryId: 'trash-a',
          originalPath: 'docs/gone.verd.json',
          trashedAt: 1,
        },
      ],
      onRestore: vi.fn(async () => {}),
      onPurge: vi.fn(async () => {}),
    },
    ...patch,
  };
  await render(props);
  return props;
};
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) =>
      element.getAttribute('aria-label') === label ||
      element.textContent === label,
  )!;
const testId = <T extends HTMLElement = HTMLElement>(id: string) =>
  container.querySelector<T>(`[data-testid="${id}"]`)!;
const click = async (target: HTMLElement) => act(async () => target.click());
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

it('shows a left menu, defaults to settings and keeps an empty workspace trash accessible', async () => {
  const props = await setup({
    trash: {
      workspaceName: '项目甲',
      entries: [],
      onRestore: vi.fn(),
      onPurge: vi.fn(async () => {}),
    },
  });
  expect(
    testId('settings-nav-workspace.project').getAttribute('aria-current'),
  ).toBe('page');
  expect(testId('workspace-settings-name')).toBeTruthy();
  await click(testId('settings-nav-workspace.trash'));
  expect(
    testId('settings-nav-workspace.trash').getAttribute('aria-current'),
  ).toBe('page');
  expect(testId('workspace-trash').textContent).toContain('当前工作区：项目甲');
  expect(testId('workspace-trash').textContent).toContain('回收站为空');
  expect(button('清空回收站').disabled).toBe(true);
  await click(testId('settings-nav-workspace.project'));
  expect(testId('workspace-settings-name')).toBeTruthy();
  await click(testId('workspace-settings-back'));
  expect(props.onBack).toHaveBeenCalledOnce();
});

it('restores entries while preventing duplicate operations or leaving during submission', async () => {
  let finish!: () => void;
  const onRestore = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const props = await setup();
  props.trash!.onRestore = onRestore;
  await render(props);
  await click(testId('settings-nav-workspace.trash'));
  await click(button('还原 gone.verd.json'));
  expect(testId<HTMLButtonElement>('workspace-settings-back').disabled).toBe(
    true,
  );
  expect(
    testId<HTMLButtonElement>('settings-nav-workspace.project').disabled,
  ).toBe(true);
  await click(button('还原 gone.verd.json'));
  expect(onRestore).toHaveBeenCalledTimes(1);
  await act(async () =>
    testId('workspace-settings-page').dispatchEvent(
      new Event('cancel', { bubbles: true, cancelable: true }),
    ),
  );
  expect(props.onBack).not.toHaveBeenCalled();
  await act(async () => finish());
  await render({ ...props, trash: { ...props.trash!, entries: [] } });
  expect(testId('workspace-trash').textContent).toContain('回收站为空');
  expect(testId('settings-nav-workspace.trash')).toBeTruthy();
  expect(testId<HTMLButtonElement>('workspace-settings-back').disabled).toBe(
    false,
  );
});

it('retains a failed purge confirmation and cancellation does not leave workspace settings', async () => {
  let reject!: (error: Error) => void;
  const onPurge = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  const props = await setup();
  props.trash!.onPurge = onPurge;
  await render(props);
  await click(testId('settings-nav-workspace.trash'));
  await click(button('清空回收站'));
  expect(testId('workspace-action-confirmation').textContent).toContain(
    '永久删除后无法恢复',
  );
  await click(button('确定'));
  expect(button('处理中…').disabled).toBe(true);
  expect(button('取消').disabled).toBe(true);
  await click(button('处理中…'));
  expect(onPurge).toHaveBeenCalledOnce();
  await act(async () => reject(new Error('Storage unavailable')));
  expect(
    testId('workspace-action-confirmation').querySelector('[role="alert"]')
      ?.textContent,
  ).toBe('Storage unavailable');
  await act(async () =>
    testId('workspace-action-confirmation').dispatchEvent(
      new Event('cancel', { bubbles: true, cancelable: true }),
    ),
  );
  expect(
    container.querySelector('[data-testid="workspace-action-confirmation"]'),
  ).toBeNull();
  expect(testId('workspace-settings-page')).toBeTruthy();
  expect(props.onBack).not.toHaveBeenCalled();
});

it('clears only entries captured when confirmation opened', async () => {
  const props = await setup();
  await click(testId('settings-nav-workspace.trash'));
  await click(button('清空回收站'));
  await render({
    ...props,
    trash: {
      ...props.trash!,
      entries: [
        ...props.trash!.entries,
        { entryId: 'trash-later', originalPath: 'later', trashedAt: 2 },
      ],
    },
  });
  await click(button('确定'));
  expect(props.trash!.onPurge).toHaveBeenCalledWith(['trash-a']);
});

it('confirms single-item deletion and hides all writes for readonly trash', async () => {
  const props = await setup();
  await click(testId('settings-nav-workspace.trash'));
  await click(button('永久删除 gone.verd.json'));
  await click(button('确定'));
  expect(props.trash!.onPurge).toHaveBeenCalledWith(['trash-a']);
  await render({ ...props, trash: { ...props.trash!, readonly: true } });
  expect(testId('workspace-trash').textContent).toContain('gone.verd.json');
  expect(testId('workspace-trash').querySelectorAll('button')).toHaveLength(0);
});

it('offers explicit retry for an unconfirmed operation and blocks other trash actions', async () => {
  const onRetry = vi.fn(async () => {});
  const props = await setup();
  await render({
    ...props,
    trash: { ...props.trash!, unconfirmed: true, onRetry },
  });
  await click(testId('settings-nav-workspace.trash'));
  expect(button('还原 gone.verd.json').disabled).toBe(true);
  expect(button('永久删除 gone.verd.json').disabled).toBe(true);
  await click(button('重试'));
  expect(onRetry).toHaveBeenCalledOnce();
});

it('keeps standalone settings usable without inventing workspace trash data', async () => {
  await setup({ trash: undefined });
  expect(testId('workspace-settings-name')).toBeTruthy();
  expect(
    container.querySelector('[data-testid="settings-nav-workspace.trash"]'),
  ).toBeNull();
});

it('edits project description and reading entries while exposing AI readiness', async () => {
  const props = await setup({
    config: { project: { description: 'Initial', entryDocumentIds: ['home'] } },
    fileChoices: [
      { id: 'home', title: 'home', path: 'home.verd-doc.json' },
      { id: 'overview', title: 'overview', path: 'overview.verd-doc.json' },
    ],
    agent: {
      ready: false,
      diagnostics: [
        { code: 'agent.shared-unready', message: 'Missing shared tools' },
      ],
    },
  });
  await click(testId('settings-nav-workspace.data'));
  expect(testId('workspace-agent-status').textContent).toContain('暂不可用');
  await click(testId('settings-nav-workspace.project'));
  expect(
    testId<HTMLTextAreaElement>('workspace-settings-description').value,
  ).toBe('Initial');
  const input = async (id: string, value: string) =>
    act(async () => {
      const area = testId<HTMLTextAreaElement>(id);
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(area, value);
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await input('workspace-settings-description', 'Project context');
  await act(async () =>
    testId('workspace-settings-description').dispatchEvent(
      new FocusEvent('focusout', { bubbles: true }),
    ),
  );
  expect(props.onConfig).toHaveBeenCalledWith({
    project: { description: 'Project context' },
  });
  await click(button('添加入口…'));
  await click(
    container.querySelector<HTMLButtonElement>(
      '.settings-entry-choices button',
    )!,
  );
  expect(props.onConfig).toHaveBeenCalledWith({
    project: { entryDocumentIds: ['home', 'overview'] },
  });
});

it('searches shared metadata and focuses the selected field in the same dialog', async () => {
  await setup();
  const dialog = testId('workspace-settings-page');
  await act(async () => {
    const input = testId<HTMLInputElement>('settings-search');
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, '项目简介');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(
    container.querySelector<HTMLButtonElement>('.settings-search-result')!,
  );
  expect(testId('workspace-settings-page')).toBe(dialog);
  expect(document.activeElement).toBe(testId('workspace-settings-description'));
  await click(testId('settings-nav-personal.general'));
  expect(testId('settings-language')).toBeTruthy();
  expect(container.querySelectorAll('dialog')).toHaveLength(1);
});

it('keeps personal preferences editable in readonly workspaces and exposes save retry', async () => {
  const retry = vi.fn();
  await setup({
    readonly: true,
    persistence: { status: 'error', error: 'Disk unavailable', onRetry: retry },
  });
  expect(
    testId<HTMLInputElement>('workspace-settings-name').matches(':disabled'),
  ).toBe(true);
  expect(testId('settings-workspace-save').textContent).toContain(
    'Disk unavailable',
  );
  await click(button('重试保存'));
  expect(retry).toHaveBeenCalledOnce();
  await click(testId('settings-nav-personal.general'));
  expect(
    testId<HTMLInputElement>('settings-language').matches(':disabled'),
  ).toBe(false);
  expect(
    container.querySelector('[data-testid="settings-workspace-save"]'),
  ).toBeNull();
});

it('orders selected entry documents, preserves missing IDs and commits only changed project fields', async () => {
  const props = await setup({
    fileChoices: [
      { id: 'home', title: 'Home', path: 'home.verd-doc.json' },
      { id: 'next', title: 'Next', path: 'next.verd-doc.json' },
    ],
    config: {
      project: { description: 'Keep', entryDocumentIds: ['missing', 'home'] },
    },
  });
  expect(testId('workspace-entry-documents').textContent).toContain(
    '文件不存在',
  );
  await click(button('上移 Home'));
  expect(props.onConfig).toHaveBeenLastCalledWith({
    project: { entryDocumentIds: ['home', 'missing'] },
  });
  await click(button('移除 missing'));
  expect(props.onConfig).toHaveBeenLastCalledWith({
    project: { entryDocumentIds: ['home'] },
  });
});

it('shows inherited workspace defaults and supports reset without changing personal preferences', async () => {
  const props = await setup({ config: { mindDefaultWidth: 320 } });
  await click(testId('settings-nav-workspace.project'));
  await act(async () => {
    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label=宽度来源]',
    )!;
    select.value = 'inherit';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(props.onConfig).toHaveBeenCalledWith({ mindDefaultWidth: undefined });
});

it('surfaces asynchronous configuration rejection inside the settings dialog', async () => {
  await setup({
    onConfig: async () => ({ status: 'rejected', message: 'Write failed' }),
  });
  await act(async () => {
    const input = testId<HTMLInputElement>('workspace-settings-name');
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, 'Draft');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    testId('workspace-settings-name').dispatchEvent(
      new FocusEvent('focusout', { bubbles: true }),
    ),
  );
  expect(testId('workspace-settings-page').textContent).toContain(
    'Write failed',
  );
});

it('uses a page heading, flat sections and localized built-in version metadata', async () => {
  await setup({
    locale: 'en',
    defaultName: 'Project',
    storage: 'desktop',
    builtin: {
      read: async () => ({
        kind: 'project',
        currentReleaseId: 'content-current',
        releaseId: 'content-bundled',
        hasBackups: false,
        update: {
          currentVersion: null,
          bundledVersion: null,
          availableVersion: '3.0.0',
          checkedAt: Date.UTC(2026, 10, 1, 8),
          status: 'current',
        },
      }),
      update: vi.fn(),
      backups: vi.fn(),
      check: vi.fn(),
    },
  });
  await click(testId('settings-nav-workspace.data'));
  expect(container.querySelector('.vm-settings-page__title')?.textContent).toBe(
    'Data and maintenance',
  );
  expect(
    container.querySelector('.settings-sections-panel section section'),
  ).toBeNull();
  expect(testId('builtin-workspace-settings').querySelector('dl')).toBeTruthy();
  expect(testId('builtin-workspace-settings').textContent).toContain(
    new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(Date.UTC(2026, 10, 1, 8))),
  );
  expect(testId('builtin-workspace-settings').textContent).not.toMatch(
    /[\u4e00-\u9fff]/,
  );
});
