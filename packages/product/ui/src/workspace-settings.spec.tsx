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
    testId('workspace-settings-nav-general').getAttribute('aria-current'),
  ).toBe('page');
  expect(testId('workspace-settings-name')).toBeTruthy();
  await click(testId('workspace-settings-nav-trash'));
  expect(
    testId('workspace-settings-nav-trash').getAttribute('aria-current'),
  ).toBe('page');
  expect(testId('workspace-trash').textContent).toContain('当前工作区：项目甲');
  expect(testId('workspace-trash').textContent).toContain('回收站为空');
  expect(button('清空回收站').disabled).toBe(true);
  await click(testId('workspace-settings-nav-general'));
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
  await click(testId('workspace-settings-nav-trash'));
  await click(button('还原 gone.verd.json'));
  expect(testId<HTMLButtonElement>('workspace-settings-back').disabled).toBe(
    true,
  );
  expect(
    testId<HTMLButtonElement>('workspace-settings-nav-general').disabled,
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
  expect(testId('workspace-settings-nav-trash')).toBeTruthy();
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
  await click(testId('workspace-settings-nav-trash'));
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
  await click(testId('workspace-settings-nav-trash'));
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
  await click(testId('workspace-settings-nav-trash'));
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
  await click(testId('workspace-settings-nav-trash'));
  expect(button('还原 gone.verd.json').disabled).toBe(true);
  expect(button('永久删除 gone.verd.json').disabled).toBe(true);
  await click(button('重试'));
  expect(onRetry).toHaveBeenCalledOnce();
});

it('keeps standalone settings usable without inventing workspace trash data', async () => {
  await setup({ trash: undefined });
  expect(testId('workspace-settings-name')).toBeTruthy();
  expect(
    container.querySelector('[data-testid="workspace-settings-nav-trash"]'),
  ).toBeNull();
});
