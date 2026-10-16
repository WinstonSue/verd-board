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

  it('keeps optimistic name input, updates the sidebar and returns focus from settings', async () => {
    const { host, path } = await hostWith('ws-name');
    await render(<WorkspaceApp host={host} workspace={{ path }} />);
    const trigger = container.querySelector<HTMLButtonElement>(
      '.workspace-sidebar-footer button',
    )!;
    await act(async () => trigger.click());
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
    expect(
      container.querySelector('.workspace-sidebar-header')?.textContent,
    ).toBe('新的工作区');
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="workspace-settings-back"]',
        )!
        .click();
    });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    expect(
      container.querySelector('[data-testid="workspace-settings-page"]'),
    ).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('navigates between workspace and global settings', async () => {
    const { host, path } = await hostWith('ws-settings');
    await render(<WorkspaceApp host={host} workspace={{ path }} />);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('.workspace-sidebar-footer button')!
        .click(),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="workspace-settings-open-global"]',
        )!
        .click(),
    );
    expect(
      container.querySelector('[data-testid="settings-page"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="settings-back"]')?.textContent,
    ).toContain('返回工作区设置');
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="settings-back"]')!
        .click(),
    );
    expect(
      container.querySelector('[data-testid="workspace-settings-page"]'),
    ).toBeTruthy();
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
