import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@sue/verd-board-ui';
import type { FrameCell, NodeCell } from '@sue/board-core';
import { createMemoryWorkspaceHost } from './host/memory-workspace-host';
import { FrameBreadcrumb, WorkspaceApp } from './workspace-app';
import { buildOrganizationIndex } from './frames/frame-files';
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
vi.mock('../../ui/src/file-tree-menu', () => ({
  FileTreeMenu: ({
    items,
    label,
    onClose,
  }: {
    items: import('../../ui/src/file-tree-menu').FileTreeMenuItem[];
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
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
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

const render = async (element: React.ReactElement) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<I18nProvider defaultLanguage="zh">{element}</I18nProvider>);
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
  const handle = (await host.openWorkspace({ path }))!;
  return { host, handle, path };
};

describe('WorkspaceApp', () => {
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

  it('shows a back control only while the source file still exists', async () => {
    const mind = {
      format: 'verd-frame' as const,
      version: 2 as const,
      organization: { kind: 'subgraph' as const, ownerFrameId: 'A' },
      frame: {
        id: 'C',
        kind: 'frame',
        cellType: 'frame',
        name: '需求脑图',
        geometry: { x: 0, y: 0, width: 10, height: 10 },
        children: ['topic'],
        groups: [],
      },
      cells: {
        topic: {
          id: 'topic',
          kind: 'mind-root',
          cellType: 'node',
          geometry: { x: 0, y: 0, width: 10, height: 10 },
        },
      },
    };
    const owner = {
      ...mind,
      organization: { kind: 'standalone' as const },
      frame: { ...mind.frame, id: 'A', name: '产品规划', children: ['r1'] },
      cells: {
        r1: {
          id: 'r1',
          kind: 'frame-reference',
          cellType: 'node',
          geometry: { x: 0, y: 0, width: 10, height: 10 },
          data: { targetFrameId: 'C' },
        },
      },
    };
    const files = new Map([
      ['A', { file: owner, path: 'a.verd.json', dirty: false }],
      ['C', { file: mind, path: 'c.verd.json', dirty: false }],
    ]);
    const organization = buildOrganizationIndex([owner, mind]);
    await render(
      <FrameBreadcrumb
        fileId="C"
        files={files as never}
        organization={organization}
        source={{
          sourceFileId: 'A',
          refId: 'r1',
          occurrenceId: 'ref:A/r1',
        }}
        sourceRev={1}
        locale="zh"
        onOpen={() => {}}
        onReturn={() => {}}
      />,
    );
    expect(container.textContent).toContain('返回');
    expect(container.textContent).toContain('产品规划');
    await render(
      <FrameBreadcrumb
        fileId="C"
        files={files as never}
        organization={organization}
        sourceRev={2}
        locale="zh"
        onOpen={() => {}}
        onReturn={() => {}}
      />,
    );
    expect(container.textContent).not.toContain('返回');
  });

  it('uses the owner file name when the frame itself has no name', async () => {
    const mind = {
      format: 'verd-frame' as const,
      version: 2 as const,
      organization: {
        kind: 'subgraph' as const,
        ownerFrameId: 'd999fdcb-70f9-4c81-abb3-bece3576ced4',
      },
      frame: {
        id: 'C',
        kind: 'frame',
        cellType: 'frame',
        geometry: { x: 0, y: 0, width: 10, height: 10 },
        children: ['topic'],
        groups: [],
      },
      cells: {
        topic: {
          id: 'topic',
          kind: 'mind-root',
          cellType: 'node',
          geometry: { x: 0, y: 0, width: 10, height: 10 },
        },
      },
    };
    const owner = {
      format: 'verd-frame' as const,
      version: 2 as const,
      frame: {
        id: 'd999fdcb-70f9-4c81-abb3-bece3576ced4',
        kind: 'frame',
        cellType: 'frame',
        geometry: { x: 0, y: 0, width: 10, height: 10 },
        children: [],
        groups: [],
      },
      cells: {},
    };
    const files = new Map([
      [
        owner.frame.id,
        { file: owner, path: '未命名画布.verd.json', dirty: false },
      ],
      ['C', { file: mind, path: '未命名画布 6.verd.json', dirty: false }],
    ]);
    await render(
      <FrameBreadcrumb
        fileId="C"
        files={files as never}
        organization={buildOrganizationIndex([owner, mind])}
        sourceRev={1}
        locale="zh"
        onOpen={() => {}}
        onReturn={() => {}}
      />,
    );
    expect(container.textContent).toContain('未命名画布');
    expect(container.textContent).not.toContain(
      'd999fdcb-70f9-4c81-abb3-bece3576ced4',
    );
  });
});

describe('workspace shell navigation', () => {
  it('returns from the library when a tab is activated', async () => {
    const { host, path } = await hostWith('ws-library');
    await render(<WorkspaceApp host={host} workspace={{ path }} />);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.file-tree-nav')!.click();
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
    expect(container.querySelector('.chart-library')).toBeNull();
    expect(
      container.querySelector(
        '.workspace-pane.is-active [data-testid="verd-frame"]',
      ),
    ).toBeTruthy();
  });

  it('keeps optimistic name input, updates the sidebar and returns focus to the workspace menu', async () => {
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

  it('opens the built-in entry only when navigation has never been saved', async () => {
    const { host, handle, path } = await hostWith('builtin-entry');
    await host.commit(handle, {
      transactionId: 'builtin-content',
      writes: [
        {
          path: 'entry.verd.json',
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
      ],
    });
    const originalOpen = host.openWorkspace.bind(host);
    host.openWorkspace = async (request) => ({
      ...(await originalOpen(request))!,
      isDefault: true,
    });
    await render(<WorkspaceApp host={host} workspace={{ path }} />);
    expect(
      container
        .querySelector('[data-testid="verd-frame"]')
        ?.getAttribute('data-frame'),
    ).toBe('board-root');
  });

  it('preserves intentionally closed built-in tabs on restart', async () => {
    const { host, handle, path } = await hostWith('builtin-closed-tabs');
    await host.commit(handle, {
      transactionId: 'builtin-closed-content',
      writes: [
        {
          path: 'entry.verd.json',
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
      ],
      session: { tabs: [], activeTabId: null, expandedDirs: [] },
    });
    const originalOpen = host.openWorkspace.bind(host);
    host.openWorkspace = async (request) => ({
      ...(await originalOpen(request))!,
      isDefault: true,
    });
    await render(<WorkspaceApp host={host} workspace={{ path }} />);
    expect(container.querySelector('[data-testid="verd-frame"]')).toBeNull();
    expect(container.querySelector('.workspace-empty')).toBeTruthy();
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
    expect(container.textContent).toContain('回到内置工作区');
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
