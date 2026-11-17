import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@sue/verd-board-ui';
import type { FrameCell, NodeCell } from '@sue/board-core';
import { createMemoryWorkspaceHost } from '@sue/verd-board-workspace';
import { WorkspaceApp } from './workspace-app';
import { createDocumentFile } from '@sue/verd-board-workspace';
import type { WorkspaceSnapshot } from './frames/workspace-storage';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event('close'));
};

// jsdom lacks ResizeObserver, which the <ylib-tabs> element's constructor uses.
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  TestResizeObserver;

// The menu primitive has its own UI/browser tests. App tests exercise host
// lifecycle and page navigation without jsdom's floating-layout observers.
vi.mock('../../ui/src/workspace/file-tree-menu', () => ({
  FileTreeMenu: ({
    items,
    label,
    onClose,
    locale = 'zh',
    preserveItemLabels = false,
  }: {
    preserveItemLabels?: boolean;
    locale?: 'zh' | 'en';
    items: import('../../ui/src/workspace/file-tree-menu').FileTreeMenuItem[];
    label: string;
    onClose(): void;
  }) => (
    <div role="menu" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          data-testid={item.testId}
          disabled={
            item.action ? !item.action.getState().enabled : item.disabled
          }
          onClick={() => {
            onClose();
            if (item.action) void item.action.execute();
            else item.onSelect();
          }}
        >
          {preserveItemLabels
            ? item.label
            : (item.action?.label(locale) ?? item.label)}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@sue/verd-board-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sue/verd-board-ui')>();
  return {
    ...actual,
    VerdFrame: (props: { frameId: string }) => (
      <div data-testid="verd-frame" data-frame={props.frameId} />
    ),
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

const render = async (element: React.ReactElement, strict = false) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    const app = <I18nProvider defaultLanguage="zh">{element}</I18nProvider>;
    root!.render(strict ? <React.StrictMode>{app}</React.StrictMode> : app);
  });
  // Flush pending session async work.
  await act(async () => {});
};

const openWorkspaceMenu = async () => {
  const trigger = container.querySelector<HTMLButtonElement>(
    '[data-testid="workspace-menu-trigger"]',
  )!;
  if (trigger.getAttribute('aria-expanded') !== 'true')
    await act(async () => trigger.click());
};
const workspaceAction = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container?.remove();
});

const hostWith = async (path = 'ws-ui') => {
  const host = createMemoryWorkspaceHost({ now: () => 1_700_000_000_000 });
  // This fixture emulates a Desktop host, including picker and built-in actions.
  host.capabilities = {
    pickWorkspace: true,
    openBuiltinWorkspace: true,
    openPatternWorkspace: true,
  };
  const handle = (await host.openWorkspace({ path }))!;
  return { host, handle, path };
};

describe('WorkspaceApp', () => {
  it('clears sidebar multi-selection on ordinary activation and tab switches while preserving range selection', async () => {
    const { host, handle, path } = await hostWith('sidebar-selection');
    await host.commit(handle, {
      transactionId: 'seed-selection',
      mkdirs: ['A', 'B'],
      writes: ['alpha', 'beta'].map((id) => ({
        path: `${id}.verd.json`,
        expectedVersion: null,
        content: JSON.stringify({
          format: 'verd-frame',
          version: 2,
          frame: {
            id,
            kind: 'frame',
            cellType: 'frame',
            name: id,
            geometry: { x: 0, y: 0, width: 9, height: 9 },
            children: [],
            groups: [],
          },
          cells: {},
        }),
      })),
      session: {
        tabs: [{ fileId: 'alpha' }, { fileId: 'beta' }],
        activeTabId: 'alpha',
        activeView: 'file',
        expandedDirs: [],
      },
    });
    await render(<WorkspaceApp host={host} workspace={{ path }} />);
    const row = (entryPath: string) =>
      container.querySelector<HTMLElement>(`[data-entry-path="${entryPath}"]`)!;
    const clickMain = async (entryPath: string, init: MouseEventInit = {}) =>
      act(async () => {
        row(entryPath)
          .querySelector('button')!
          .dispatchEvent(
            new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              ...init,
            }),
          );
      });
    const selected = () =>
      [
        ...container.querySelectorAll<HTMLElement>(
          '.file-tree-row.is-selected',
        ),
      ].map((item) => item.dataset['entryPath']);
    await clickMain('A', { ctrlKey: true });
    await clickMain('B', { metaKey: true });
    expect(selected()).toEqual(['A', 'B']);
    expect(
      container
        .querySelector('[data-testid="verd-frame"]')
        ?.getAttribute('data-frame'),
    ).toBe('alpha');
    await clickMain('alpha.verd.json');
    expect(selected()).toEqual([]);
    await clickMain('B', { shiftKey: true });
    expect(selected()).toEqual(['B', 'alpha.verd.json']);
    await act(async () => {
      row('A').querySelector<HTMLButtonElement>('.file-tree-more')!.click();
    });
    expect(selected()).toEqual(['B', 'alpha.verd.json']);
    await act(async () => {
      container
        .querySelector('ylib-tabs')!
        .dispatchEvent(
          new CustomEvent('tab-activate', { detail: { tabId: 'beta' } }),
        );
    });
    await act(
      async () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => setTimeout(resolve, 0)),
        ),
    );
    expect(
      container.querySelector('[data-testid="verd-frame"][data-frame="beta"]'),
    ).not.toBeNull();
    expect(selected()).toEqual([]);
  });

  it('removes trashed folder files from every tab group while preserving other tabs', async () => {
    const { host, path, handle } = await hostWith('folder-groups');
    let shutdown = async () => {};
    host.onShutdown = (flush) => {
      shutdown = flush;
      return () => {};
    };
    const frame = (id: string) =>
      JSON.stringify({
        format: 'verd-frame',
        version: 2,
        frame: {
          id,
          kind: 'frame',
          cellType: 'frame',
          name: id,
          geometry: { x: 0, y: 0, width: 9, height: 9 },
          children: [],
          groups: [],
        },
        cells: {},
      });
    await host.commit(handle, {
      transactionId: 'seed-groups',
      writes: [
        {
          path: 'folder/inside.verd.json',
          content: frame('inside'),
          expectedVersion: null,
        },
        {
          path: 'outside.verd.json',
          content: frame('outside'),
          expectedVersion: null,
        },
      ],
      session: {
        tabs: [{ fileId: 'inside' }, { fileId: 'outside' }],
        activeTabId: 'outside',
        expandedDirs: ['folder'],
        activeGroupId: 'one',
        groups: [
          {
            id: 'one',
            name: 'One',
            tabs: [{ fileId: 'inside' }, { fileId: 'outside' }],
            activeTabId: 'outside',
          },
          {
            id: 'two',
            name: 'Two',
            tabs: [{ fileId: 'inside' }],
            activeTabId: 'inside',
          },
        ],
      },
    });
    await render(<WorkspaceApp host={host} workspace={{ path }} />);
    await act(async () => {
      await host.commit(handle, {
        transactionId: 'trash-folder',
        trash: [{ path: 'folder' }],
      });
    });
    await act(async () => shutdown());
    const saved = (await host.readSnapshot(handle)).session!;
    expect(saved.groups?.[0].tabs).toEqual([{ fileId: 'outside' }]);
    expect(saved.groups?.[1].tabs).toEqual([]);
    expect(saved.groups?.[1].activeTabId).toBeNull();
  });

  it('seeds a default board on first launch and shows it as a tab', async () => {
    const { host } = await hostWith();
    await render(<WorkspaceApp host={host} workspace={{ path: 'ws-ui' }} />);
    expect(container.querySelector('[data-testid="verd-frame"]')).toBeTruthy();
    const tree = container.querySelector('.file-tree');
    expect(tree?.textContent).toContain('未命名画布');
  });

  it('shows the empty state when the last tab closes', async () => {
    const { host, handle } = await hostWith();
    // Pre-seed a file + no tabs so the app mounts with an empty main area.
    await host.commit(handle, {
      transactionId: 'seed',
      writes: [
        {
          path: 'board.verd.json',
          content: JSON.stringify({
            format: 'verd-frame',
            version: 2,
            frame: {
              id: 'f1',
              kind: 'frame',
              cellType: 'frame',
              geometry: { x: 0, y: 0, width: 9, height: 9 },
              children: [],
              groups: [],
            },
            cells: {},
          }),
          expectedVersion: null,
        },
      ],
    });
    await render(<WorkspaceApp host={host} workspace={{ path: 'ws-ui' }} />);
    expect(container.querySelector('.workspace-empty')).toBeTruthy();
    expect(container.querySelector('[data-testid="verd-frame"]')).toBeNull();
    // The file still appears in the tree.
    expect(container.querySelector('.file-tree')?.textContent).toContain(
      'board',
    );
  });

  it('opens a file from the tree into a tab', async () => {
    const { host, handle } = await hostWith();
    await host.commit(handle, {
      transactionId: 'seed',
      writes: [
        {
          path: 'a.verd.json',
          content: JSON.stringify({
            format: 'verd-frame',
            version: 2,
            frame: {
              id: 'a',
              kind: 'frame',
              cellType: 'frame',
              name: 'Board A',
              geometry: { x: 0, y: 0, width: 9, height: 9 },
              children: [],
              groups: [],
            },
            cells: {},
          }),
          expectedVersion: null,
        },
      ],
    });
    await render(<WorkspaceApp host={host} workspace={{ path: 'ws-ui' }} />);
    const name = [...container.querySelectorAll('.file-tree-name')].find(
      (node) => node.textContent?.includes('Board A'),
    ) as HTMLElement;
    await act(async () => {
      name.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(
      async () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => setTimeout(resolve, 0)),
        ),
    );
    expect(container.querySelector('[data-testid="verd-frame"]')).toBeTruthy();
  });

  it('imports legacy storage into files on first launch instead of seeding', async () => {
    // Distinct workspace path: first-launch initialization is keyed per
    // workspace, and the seeding test already claimed 'ws-ui'.
    const { host, path } = await hostWith('ws-legacy');
    const rootFrame: FrameCell = {
      id: 'board-root',
      kind: 'frame',
      cellType: 'frame',
      name: '旧画板',
      geometry: { x: 0, y: 0, width: 9, height: 9 },
      children: ['legacy-mind', 'legacy-node'],
      groups: [],
    };
    const legacy: WorkspaceSnapshot = {
      store: {
        rootId: 'board-root',
        cells: {
          'board-root': rootFrame,
          'legacy-mind': {
            ...rootFrame,
            id: 'legacy-mind',
            name: '旧导图',
            children: [],
          } as FrameCell,
          'legacy-node': {
            id: 'legacy-node',
            kind: 'geometry',
            cellType: 'node',
            geometry: { x: 0, y: 0, width: 4, height: 4 },
          } as NodeCell,
        },
      },
      detachedFrameIds: [],
    };
    const importLegacy = vi.fn(async () => legacy);
    await render(
      <WorkspaceApp
        host={host}
        workspace={{ path }}
        importLegacy={importLegacy}
      />,
    );
    expect(importLegacy).toHaveBeenCalledTimes(1);
    // Nested frames externalize into independent files sharing a reference.
    const tree = container.querySelector('.file-tree')?.textContent ?? '';
    expect(tree).toContain('旧画板');
    expect(tree).toContain('旧导图');
    // First imported file opens as the active tab.
    expect(
      container
        .querySelector('[data-testid="verd-frame"]')
        ?.getAttribute('data-frame'),
    ).toBe('board-root');
  });

  it('does not consult legacy storage when the workspace already has files', async () => {
    const { host, handle } = await hostWith();
    await host.commit(handle, {
      transactionId: 'seed',
      writes: [
        {
          path: 'kept.verd.json',
          content: JSON.stringify({
            format: 'verd-frame',
            version: 2,
            frame: {
              id: 'kept',
              kind: 'frame',
              cellType: 'frame',
              name: '已有画布',
              geometry: { x: 0, y: 0, width: 9, height: 9 },
              children: [],
              groups: [],
            },
            cells: {},
          }),
          expectedVersion: null,
        },
      ],
    });
    const importLegacy = vi.fn(async () => null);
    await render(
      <WorkspaceApp
        host={host}
        workspace={{ path: 'ws-ui' }}
        importLegacy={importLegacy}
      />,
    );
    expect(importLegacy).not.toHaveBeenCalled();
    expect(container.querySelector('.file-tree')?.textContent).toContain(
      '已有画布',
    );
  });

  it('shows independent file identity and groups every direct canvas and document embed', async () => {
    const { host, handle, path } = await hostWith('reference-navigation');
    let shutdown = async () => {};
    host.onShutdown = (flush) => {
      shutdown = flush;
      return () => {};
    };
    const frame = (id: string, cells: Record<string, unknown> = {}) => ({
      format: 'verd-frame',
      version: 2,
      frame: {
        id,
        kind: 'frame',
        cellType: 'frame',
        geometry: { x: 0, y: 0, width: 100, height: 100 },
        children: Object.keys(cells),
        groups: [],
      },
      cells,
    });
    const reference = (id: string) => ({
      id,
      kind: 'frame-reference',
      cellType: 'node',
      geometry: { x: 0, y: 0, width: 100, height: 100 },
      data: { targetFrameId: 'target' },
    });
    const target = frame('target');
    const source = frame('source', {
      r1: reference('r1'),
      r2: reference('r2'),
    });
    const document = createDocumentFile('doc', '包索引');
    document.text.content = {
      type: 'doc',
      content: [
        { type: 'frameReference', attrs: { targetFrameId: 'target' } },
        { type: 'frameReference', attrs: { targetFrameId: 'target' } },
      ],
    };
    await host.commit(handle, {
      transactionId: 'seed-references',
      writes: [
        {
          path: '未命名画布.verd.json',
          content: JSON.stringify(target),
          expectedVersion: null,
        },
        {
          path: '项目导览.verd.json',
          content: JSON.stringify(source),
          expectedVersion: null,
        },
        {
          path: '包索引.verd-doc.json',
          content: JSON.stringify(document),
          expectedVersion: null,
        },
      ],
      session: {
        tabs: [{ fileId: 'target' }],
        activeTabId: 'target',
        expandedDirs: [],
      },
    });
    await render(<WorkspaceApp host={host} workspace={{ path }} />);
    expect(
      container.querySelector('.workspace-file-navigation-title')?.textContent,
    ).toBe('未命名画布');
    expect(container.querySelector('.workspace-breadcrumb')).toBeNull();
    expect(
      container.querySelector('[data-testid="navigation-return"]'),
    ).toBeNull();
    const references = () =>
      container.querySelector<HTMLButtonElement>(
        '[data-testid="reference-locations-trigger"]',
      )!;
    expect(references().textContent).toBe('被引用 4 处');
    await act(async () => references().click());
    expect(container.querySelectorAll('[role="menuitem"]')).toHaveLength(4);
    expect(container.querySelector('[role="menu"]')?.textContent).toContain(
      '第 2 处',
    );
    await act(async () => {
      await shutdown();
      const sourceBytes = await host.readFile(handle, '项目导览.verd.json');
      const removed = await host.commit(handle, {
        transactionId: 'remove-source',
        trash: [
          { path: '项目导览.verd.json', expectedVersion: sourceBytes.version },
        ],
      });
      expect(removed.outcome).toBe('applied');
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
    expect(references().textContent).toBe('被引用 2 处');
    expect(container.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
  });
});

describe('workspace shell navigation', () => {
  it('returns from the library when a tab is activated', async () => {
    const { host, path } = await hostWith('ws-library');
    await render(<WorkspaceApp host={host} workspace={{ path }} />);
    await act(async () => {
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          '.management-navigation nav button',
        ),
      ]
        .find((b) => b.textContent?.includes('所有内容'))!
        .click();
    });
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>('.content-tabs button')]
        .find((b) => b.textContent === '图表')!
        .click();
    });
    expect(container.querySelector('.chart-library')).toBeTruthy();
    const frameId = container
      .querySelector('[data-testid="verd-frame"]')!
      .getAttribute('data-frame')!;
    await act(async () => {
      container
        .querySelector('ylib-tabs')!
        .dispatchEvent(
          new CustomEvent('tab-activate', { detail: { tabId: frameId } }),
        );
    });
    await act(
      async () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => setTimeout(resolve, 0)),
        ),
    );
    expect(container.querySelector('.chart-library')).toBeNull();
    expect(
      container.querySelector(
        '.workspace-pane.is-active [data-testid="verd-frame"]',
      ),
    ).toBeTruthy();
  });

  it('keeps the name draft, updates the saved sidebar name and returns focus to the workspace menu', async () => {
    const { host, path } = await hostWith('ws-name');
    await render(<WorkspaceApp host={host} workspace={{ path }} />);
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="workspace-menu-trigger"]',
    )!;
    await openWorkspaceMenu();
    await act(async () => workspaceAction('workspace-open-settings').click());
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="workspace-settings-name"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, '新的工作区');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
    );
    expect(input.value).toBe('新的工作区');
    expect(container.querySelector('.workspace-menu-name')?.textContent).toBe(
      '新的工作区',
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="workspace-settings-back"]',
        )!
        .click(),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    expect(
      container.querySelector('[data-testid="workspace-settings-page"]'),
    ).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps the committed workspace name while a rename is pending and after it is rejected', async () => {
    const { host, path, handle } = await hostWith('ws-name-rejected');
    const config = (await host.readSnapshot(handle)).config;
    const seeded = await host.commit(handle, {
      transactionId: 'saved-name',
      config: {
        value: { ...config.value, name: 'Saved name' },
        expectedVersion: config.version,
      },
    });
    expect(seeded.outcome).toBe('applied');
    const commit = host.commit.bind(host);
    let rejectRename!: () => void;
    const gate = new Promise<void>((resolve) => (rejectRename = resolve));
    const started = vi.fn();
    host.commit = async (target, request) => {
      if (request.config?.value['name'] === 'Rejected name') {
        started();
        await gate;
        return {
          transactionId: request.transactionId,
          outcome: 'rejected',
          reason: 'invalid',
        };
      }
      return commit(target, request);
    };
    await render(<WorkspaceApp host={host} workspace={{ path }} />);
    await openWorkspaceMenu();
    await act(async () => workspaceAction('workspace-open-settings').click());
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="workspace-settings-name"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, 'Rejected name');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const title = () =>
      container.querySelector('.workspace-menu-name')?.textContent;
    expect(title()).toBe('Saved name');
    await act(async () =>
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
    );
    expect(started).toHaveBeenCalledOnce();
    expect(title()).toBe('Saved name');
    await act(async () => rejectRename());
    expect(title()).toBe('Saved name');
    expect((await host.readSnapshot(handle)).config.value['name']).toBe(
      'Saved name',
    );
  });

  it('shows preferences directly in My and keeps workspace settings independent', async () => {
    const { host, path } = await hostWith('ws-settings');
    await render(<WorkspaceApp host={host} workspace={{ path }} />);
    await openWorkspaceMenu();
    await act(async () => workspaceAction('workspace-open-settings').click());
    expect(
      container.querySelector('[data-testid="workspace-settings-open-global"]'),
    ).toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="workspace-settings-back"]',
        )!
        .click(),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="workspace-my"]')!
        .click(),
    );
    expect(container.querySelector('[data-testid="my-page"]')).toBeTruthy();
    expect(
      container.querySelector('[data-testid="settings-language"]'),
    ).toBeTruthy();
    expect(container.querySelector('[data-testid="settings-page"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="my-open-settings"]'),
    ).toBeNull();
    expect(
      container.querySelectorAll('.workspace-sidebar-footer button'),
    ).toHaveLength(1);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="my-back"]')!
        .click(),
    );
    expect(container.querySelector('dialog')).toBeNull();
  });

  it('keeps the active workspace when picking is cancelled and activates a successfully selected folder', async () => {
    const { host, path } = await hostWith('switch-original');
    const originalOpen = host.openWorkspace.bind(host);
    const activate = vi.fn(async () => {});
    let cancel = true;
    host.activateWorkspace = activate;
    host.openWorkspace = vi.fn(async (request) => {
      if (request?.pick) {
        if (cancel) return null;
        return {
          ...(await originalOpen({ path: 'switch-selected' }))!,
          isDefault: false,
        };
      }
      return originalOpen(request);
    });
    await render(
      <WorkspaceApp host={host} workspace={{ path }} allowWorkspaceSwitching />,
    );
    const initialFrame = container
      .querySelector('[data-testid="verd-frame"]')
      ?.getAttribute('data-frame');
    const pick = () => workspaceAction('workspace-open-folder');
    await openWorkspaceMenu();
    await act(async () => {
      pick().click();
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
    expect(
      container
        .querySelector('[data-testid="verd-frame"]')
        ?.getAttribute('data-frame'),
    ).toBe(initialFrame);
    expect(activate).toHaveBeenCalledTimes(1);
    await act(
      async () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect(document.activeElement).toBe(
      container.querySelector('[data-testid="workspace-menu-trigger"]'),
    );
    cancel = false;
    await openWorkspaceMenu();
    await act(async () => {
      pick().click();
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
    expect(
      container
        .querySelector('[data-testid="verd-frame"]')
        ?.getAttribute('data-frame'),
    ).not.toBe(initialFrame);
    expect(activate).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.workspace-error')).toBeNull();
  });

  it('blocks a folder switch when saving the current workspace fails', async () => {
    const { host, path } = await hostWith('switch-failure');
    const open = vi.spyOn(host, 'openWorkspace');
    await render(
      <WorkspaceApp host={host} workspace={{ path }} allowWorkspaceSwitching />,
    );
    vi.spyOn(host, 'commit').mockResolvedValue({
      transactionId: 'failed',
      outcome: 'rejected',
      reason: 'io-error',
    });
    await openWorkspaceMenu();
    await act(async () => {
      workspaceAction('workspace-open-folder').click();
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
    expect(open).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('.workspace-banners')?.textContent,
    ).toContain('当前工作区未能保存');
    expect(container.querySelector('[data-testid="verd-frame"]')).toBeTruthy();
  });

  it.each([
    {
      name: 'opens document navigation for a legacy built-in workspace without reading entries',
      readingEntries: undefined,
      savedSession: undefined,
      expected: 'project-doc:README',
    },
    {
      name: 'opens the first available configured reading entry and reveals its directory',
      readingEntries: ['missing-entry', 'welcome', 'project-doc:README'],
      savedSession: undefined,
      expected: 'welcome',
    },
    {
      name: 'restores a saved canvas tab instead of replacing it with the entry document',
      readingEntries: ['project-doc:README'],
      savedSession: {
        tabs: [{ fileId: 'board-root' }],
        activeTabId: 'board-root',
        expandedDirs: [],
      },
      expected: 'board-root',
    },
    {
      name: 'preserves intentionally closed built-in tabs on restart',
      readingEntries: ['project-doc:README'],
      savedSession: { tabs: [], activeTabId: null, expandedDirs: [] },
      expected: null,
    },
    {
      name: 'restores a saved management view instead of opening the reading entry',
      readingEntries: ['project-doc:README'],
      savedSession: {
        activeView: 'home' as const,
        tabs: [{ fileId: 'project-doc:README' }],
        activeTabId: 'project-doc:README',
        expandedDirs: [],
      },
      expected: 'project-doc:README',
    },
  ])('$name', async ({ readingEntries, savedSession, expected }) => {
    const { host, handle, path } = await hostWith(
      'builtin-entry-' + (expected ?? 'empty').replaceAll(':', '-'),
    );
    let shutdown = async () => {};
    host.onShutdown = (flush) => {
      shutdown = flush;
      return () => {};
    };
    const config = (await host.readSnapshot(handle)).config;
    await host.commit(handle, {
      transactionId: 'builtin-content',
      writes: [
        {
          path: '项目导览.verd.json',
          expectedVersion: null,
          content: JSON.stringify({
            format: 'verd-frame',
            version: 2,
            frame: {
              id: 'board-root',
              kind: 'frame',
              cellType: 'frame',
              geometry: { x: 0, y: 0, width: 960, height: 640 },
              children: [],
              groups: [],
            },
            cells: {},
          }),
        },
        {
          path: '文档导航.verd-doc.json',
          expectedVersion: null,
          content: JSON.stringify(
            createDocumentFile('project-doc:README', '文档导航'),
          ),
        },
        {
          path: 'reading/intro/welcome.verd-doc.json',
          expectedVersion: null,
          content: JSON.stringify(createDocumentFile('welcome', '阅读起点')),
        },
      ],
      config: readingEntries
        ? {
            expectedVersion: config.version,
            value: {
              ...config.value,
              project: { entryDocumentIds: readingEntries },
            },
          }
        : undefined,
      session: savedSession,
    });
    const originalOpen = host.openWorkspace.bind(host);
    host.openWorkspace = async (request) => ({
      ...(await originalOpen(request))!,
      isDefault: true,
    });
    await render(<WorkspaceApp host={host} workspace={{ path }} />);
    expect(
      container
        .querySelector('.workspace-content')
        ?.getAttribute('data-management-view'),
    ).toBe(savedSession?.activeView ?? 'file');
    if (expected === 'board-root') {
      expect(
        container
          .querySelector('[data-testid="verd-frame"]')
          ?.getAttribute('data-frame'),
      ).toBe('board-root');
    } else if (expected) {
      expect(
        container
          .querySelector('.workspace-pane.is-active .document-page__content')
          ?.getAttribute('aria-label'),
      ).toBe(expected === 'welcome' ? '阅读起点' : '文档导航');
      expect(container.querySelector('[data-testid="verd-frame"]')).toBeNull();
    } else {
      expect(container.querySelector('.workspace-pane.is-active')).toBeNull();
      expect(container.querySelector('.workspace-empty')).toBeTruthy();
    }
    await act(async () => {
      await shutdown();
    });
    const navigation = (await host.readSnapshot(handle)).session!;
    expect(navigation.activeTabId).toBe(expected);
    if (!savedSession)
      expect(navigation.expandedDirs).toEqual(
        expected === 'welcome' ? ['reading', 'reading/intro'] : [],
      );
  });

  it('preserves an intentionally empty workspace that already has a saved session', async () => {
    const { host, handle, path } = await hostWith('empty-saved-session');
    await host.commit(handle, {
      transactionId: 'empty-session',
      session: { tabs: [], activeTabId: null, expandedDirs: [] },
    });
    await render(<WorkspaceApp host={host} workspace={{ path }} />);
    expect(container.querySelector('[data-testid="verd-frame"]')).toBeNull();
    expect(container.querySelector('.workspace-empty')).toBeTruthy();
  });

  it('makes the shell inert and flushes navigation queued while the next folder loads', async () => {
    const { host, handle, path } = await hostWith('switch-queued-navigation');
    const selected = (await host.openWorkspace({ path: 'queued-next' }))!;
    const open = host.openWorkspace.bind(host);
    const read = host.readSnapshot.bind(host);
    let finishLoading!: () => void;
    const loading = new Promise<void>((resolve) => {
      finishLoading = resolve;
    });
    host.openWorkspace = (request) =>
      request?.pick
        ? Promise.resolve({ ...selected, isDefault: false })
        : open(request);
    host.readSnapshot = async (target) => {
      if (target.key === selected.key) await loading;
      return read(target);
    };
    const commits = vi.spyOn(host, 'commit');
    await render(
      <WorkspaceApp host={host} workspace={{ path }} allowWorkspaceSwitching />,
    );
    const initialId = container
      .querySelector('[data-testid="verd-frame"]')!
      .getAttribute('data-frame')!;
    await openWorkspaceMenu();
    await act(async () => {
      workspaceAction('workspace-open-folder').click();
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
    expect(
      container.querySelector('.workspace-shell')?.hasAttribute('inert'),
    ).toBe(true);
    expect(
      container.querySelector('.workspace-shell')?.getAttribute('aria-busy'),
    ).toBe('true');
    // Programmatic events bypass inert, just like already queued metadata.
    await act(async () =>
      container
        .querySelector('ylib-tabs')!
        .dispatchEvent(
          new CustomEvent('tab-close', { detail: { tabId: initialId } }),
        ),
    );
    await act(async () => {
      finishLoading();
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
    expect(
      commits.mock.calls.some(
        ([target, request]) =>
          target.key === handle.key && request.session?.tabs.length === 0,
      ),
    ).toBe(true);
    expect(
      container.querySelector('.workspace-shell')?.hasAttribute('inert'),
    ).toBe(false);
    expect(
      container
        .querySelector('[data-testid="verd-frame"]')
        ?.getAttribute('data-frame'),
    ).not.toBe(initialId);
  });

  it('offers directory recovery after an unavailable startup selection', async () => {
    const { host } = await hostWith('missing-initial');
    host.openWorkspace = vi.fn(async () => {
      throw new Error('Workspace folder is unavailable');
    });
    await render(<WorkspaceApp host={host} allowWorkspaceSwitching />);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'unavailable',
    );
    expect(container.textContent).toContain('打开工作区文件夹');
    expect(container.textContent).toContain('打开系统介绍');
  });

  it('does not import device legacy records into explicitly selected folders', async () => {
    const { host, path } = await hostWith('explicit-empty');
    const originalOpen = host.openWorkspace.bind(host);
    host.openWorkspace = async (request) => ({
      ...(await originalOpen(request))!,
      isDefault: false,
    });
    const legacy = vi.fn(async () => null);
    await render(
      <WorkspaceApp host={host} workspace={{ path }} importLegacy={legacy} />,
    );
    expect(legacy).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="verd-frame"]')).toBeTruthy();
  });

  it('reports invalid imports in a banner and keeps the workspace usable', async () => {
    const { host, path } = await hostWith('ws-import');
    await render(<WorkspaceApp host={host} workspace={{ path }} />);
    const input = container.querySelector<HTMLInputElement>(
      'input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]',
    )!;
    Object.defineProperty(input, 'files', {
      value: [{ name: 'bad.json', text: async () => '{' }],
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('.workspace-error')).toBeNull();
    expect(
      container.querySelector('.workspace-banners [role="alert"]')?.textContent,
    ).toContain('导入失败');
    expect(container.querySelector('.file-tree')).toBeTruthy();
  });
});

let historyHostCounter = 0;
const historyHost = async () => {
  const { host, handle, path } = await hostWith(
    `history-current-${historyHostCounter++}`,
  );
  const open = host.openWorkspace.bind(host);
  const other = (await open({ path: `${path}-other` }))!;
  const entries = [
    { id: 'current', name: 'Current', lastOpenedAt: 2 },
    { id: 'other', name: 'Other', lastOpenedAt: 1 },
  ];
  host.listWorkspaceHistory = vi.fn(async () => entries);
  host.activateWorkspace = vi.fn(async () => {});
  host.openWorkspace = vi.fn(async (request) => {
    if (request?.historyId === 'other') return { ...other, historyId: 'other' };
    const opened = await open(request);
    return opened
      ? {
          ...opened,
          historyId: opened.key === handle.key ? 'current' : undefined,
        }
      : null;
  });
  return { host, path, other, entries };
};

it('reopens history through the workspace lifecycle and disables the active stable identity', async () => {
  const { host, path, other } = await historyHost();
  await render(
    <WorkspaceApp host={host} workspace={{ path }} allowWorkspaceSwitching />,
  );
  const initial = container
    .querySelector('[data-testid="verd-frame"]')
    ?.getAttribute('data-frame');
  await openWorkspaceMenu();
  expect(workspaceAction('workspace-history-current').disabled).toBe(true);
  await act(async () => {
    workspaceAction('workspace-history-other').click();
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
  expect(host.openWorkspace).toHaveBeenLastCalledWith({
    historyId: 'other',
    create: false,
  });
  expect(host.activateWorkspace).toHaveBeenLastCalledWith({
    ...other,
    historyId: 'other',
  });
  expect(
    container
      .querySelector('[data-testid="verd-frame"]')
      ?.getAttribute('data-frame'),
  ).not.toBe(initial);
  await openWorkspaceMenu();
  expect(workspaceAction('workspace-history-other').disabled).toBe(true);
  expect(workspaceAction('workspace-history-current').disabled).toBe(false);
});

it('blocks history switching before opening or recording a candidate when the current save fails', async () => {
  const { host, path } = await historyHost();
  await render(
    <WorkspaceApp host={host} workspace={{ path }} allowWorkspaceSwitching />,
  );
  vi.spyOn(host, 'commit').mockResolvedValue({
    transactionId: 'failed',
    outcome: 'rejected',
    reason: 'io-error',
  });
  await openWorkspaceMenu();
  await act(async () => {
    workspaceAction('workspace-history-other').click();
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
  expect(host.openWorkspace).toHaveBeenCalledTimes(1);
  expect(host.activateWorkspace).toHaveBeenCalledTimes(1);
  expect(container.querySelector('.workspace-banners')?.textContent).toContain(
    '当前工作区未能保存',
  );
  expect(container.querySelector('[data-testid="verd-frame"]')).toBeTruthy();
});

it('keeps the current session and history after a recorded directory cannot load', async () => {
  const { host, path, other } = await historyHost();
  const close = vi.spyOn(host, 'closeWorkspace');
  const read = host.readSnapshot.bind(host);
  host.readSnapshot = async (target) => {
    if (target.key === other.key)
      throw new Error('Workspace folder is unavailable');
    return read(target);
  };
  await render(
    <WorkspaceApp host={host} workspace={{ path }} allowWorkspaceSwitching />,
  );
  const initial = container
    .querySelector('[data-testid="verd-frame"]')
    ?.getAttribute('data-frame');
  await openWorkspaceMenu();
  await act(async () => {
    workspaceAction('workspace-history-other').click();
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
  expect(host.activateWorkspace).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledWith({ ...other, historyId: 'other' });
  expect(
    container
      .querySelector('[data-testid="verd-frame"]')
      ?.getAttribute('data-frame'),
  ).toBe(initial);
  expect(container.querySelector('.workspace-banners')?.textContent).toContain(
    'unavailable',
  );
  await openWorkspaceMenu();
  expect(workspaceAction('workspace-history-other')).toBeTruthy();
});

it('offers recorded workspaces after startup fails and can recover through the same action', async () => {
  const { host, other } = await historyHost();
  const open = host.openWorkspace.bind(host);
  host.openWorkspace = vi.fn(async (request) => {
    if (!request?.historyId) throw new Error('Workspace folder is unavailable');
    return open(request);
  });
  await render(<WorkspaceApp host={host} allowWorkspaceSwitching />);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    '已打开的工作区',
  );
  await act(async () => {
    workspaceAction('workspace-history-other').click();
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
  expect(container.querySelector('.workspace-error')).toBeNull();
  expect(container.querySelector('[data-testid="verd-frame"]')).toBeTruthy();
  expect(host.activateWorkspace).toHaveBeenLastCalledWith({
    ...other,
    historyId: 'other',
  });
});

it('keeps shared startup handles open across StrictMode effect replay while loading history', async () => {
  const { host, path } = await historyHost();
  const close = vi.spyOn(host, 'closeWorkspace');
  await render(
    <WorkspaceApp host={host} workspace={{ path }} allowWorkspaceSwitching />,
    true,
  );
  expect(container.querySelector('[data-testid="verd-frame"]')).toBeTruthy();
  expect(host.activateWorkspace).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  await openWorkspaceMenu();
  expect(workspaceAction('workspace-history-current').disabled).toBe(true);
});

it('hides unsupported host entries while preserving the legacy host capability contract', async () => {
  const { host, path } = await hostWith('capabilities');
  host.capabilities = {
    pickWorkspace: false,
    openBuiltinWorkspace: false,
    openPatternWorkspace: false,
  };
  await render(
    <WorkspaceApp host={host} workspace={{ path }} allowWorkspaceSwitching />,
  );
  await openWorkspaceMenu();
  expect(workspaceAction('workspace-open-folder')).toBeNull();
  expect(workspaceAction('workspace-open-builtin')).toBeNull();
  expect(workspaceAction('workspace-open-patterns')).toBeNull();
});
