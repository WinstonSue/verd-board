import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActionRegistry } from '@sue/board-common';
import { FileTree, type FileTreeProps } from './file-tree';

// jsdom has no layout; pointer placement and focus return are covered in Playwright.
vi.mock('@floating-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@floating-ui/react')>();
  return { ...actual, autoUpdate: () => () => {} };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event('close'));
};
let root: Root;
let container: HTMLDivElement;
const setup = async (patch: Partial<FileTreeProps> = {}) => {
  const props: FileTreeProps = {
    entries: [{ path: 'docs', kind: 'directory' }],
    canvases: [
      { frameId: 'a', name: 'Alpha', path: 'docs/a.verd.json' },
      { frameId: 'b', name: 'Beta', path: 'b.verd.json' },
    ],
    activeFileId: 'a',
    expandedDirs: ['docs'],
    onOpenFile: vi.fn(),
    onToggleDir: vi.fn(),
    onCreateCanvas: vi.fn(),
    onCreateDocument: vi.fn(),
    onCreateFolder: vi.fn(),
    onTrash: vi.fn(),
    onMove: vi.fn(),
    onDuplicate: vi.fn(),
    onExport: vi.fn(),
    onOpenLibrary: vi.fn(),
    ...patch,
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <React.StrictMode>
        <FileTree {...props} />
      </React.StrictMode>,
    ),
  );
  return props;
};
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) =>
      (element.getAttribute('aria-label') ?? element.textContent) === name,
  )!;
const click = async (element: HTMLElement) => act(async () => element.click());
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

describe('FileTree', () => {
  it('opens unavailable files by real path without inventing file identities', async () => {
    const onOpenFailedFile = vi.fn();
    await setup({
      failedFiles: [
        { path: 'docs/broken.verd.json' },
        { path: 'unfinished.verd-doc.json' },
      ],
      activeFailedPath: 'docs/broken.verd.json',
      onOpenFailedFile,
    });
    const row = container.querySelector<HTMLElement>(
      '[data-failed-path="docs/broken.verd.json"]',
    )!;
    expect(row.classList.contains('is-active')).toBe(true);
    expect(row.hasAttribute('data-file-id')).toBe(false);
    await click(row.querySelector('button')!);
    expect(onOpenFailedFile).toHaveBeenCalledWith('docs/broken.verd.json');
    expect(container.querySelector('[data-file-id="b"]')).not.toBeNull();
  });

  it('sources menu labels/state/execution from actions and keeps the original right-click target', async () => {
    let workspace = 'one';
    const existing = new Set(['a', 'b']);
    const seen: string[] = [];
    const registry = createActionRegistry({
      getContext: () => ({ workspace }),
      refresh: (captured) =>
        captured.workspace === workspace ? { workspace } : null,
    });
    registry.register({
      id: 'workspace.file.trash',
      label: { zh: '动作删除', en: 'Action trash' },
      category: 'workspace',
      effect: 'content',
      validateArgs: (args): args is { fileId: string } =>
        !!args && typeof args === 'object' && 'fileId' in args,
      getState: (_c, args) => ({ enabled: existing.has(args.fileId) }),
      execute: (_c, args) => {
        seen.push(args.fileId);
        return { status: 'completed' };
      },
    });
    registry.seal();
    const props = await setup({ actionSource: registry });
    await click(button('「Alpha」的操作'));
    await act(async () =>
      root.render(
        <React.StrictMode>
          <FileTree {...props} activeFileId="b" />
        </React.StrictMode>,
      ),
    );
    expect(button('Beta').getAttribute('aria-current')).toBe('page');
    await click(button('动作删除'));
    expect(seen).toEqual(['a']);
    expect(props.onTrash).not.toHaveBeenCalled();
    await click(button('「Alpha」的操作'));
    existing.delete('a');
    await act(async () => registry.invalidate());
    expect(button('动作删除').disabled).toBe(true);
    await click(button('动作删除'));
    expect(seen).toEqual(['a']);
    workspace = 'two';
    await act(async () => registry.invalidate());
    expect(button('动作删除').disabled).toBe(true);
    await act(async () => registry.dispose());
  });

  it('confirms folder trash and allows cancellation', async () => {
    const onTrashDirectory = vi.fn(async () => {});
    await setup({ onTrashDirectory });
    await click(button('「docs」的操作'));
    await click(button('移入回收站'));
    expect(document.querySelector('dialog')?.textContent).toContain(
      '文件夹及全部内容',
    );
    await click(button('取消'));
    expect(onTrashDirectory).not.toHaveBeenCalled();
    await click(button('「docs」的操作'));
    await click(button('移入回收站'));
    await click(button('确定'));
    expect(onTrashDirectory).toHaveBeenCalledWith('docs');
    expect(document.querySelector('dialog')).toBeNull();
  });
  it('opens ordered actions and closes the menu after selecting trash', async () => {
    const props = await setup();
    await click(button('「Alpha」的操作'));
    const menu = document.querySelector('[role="menu"]')!;
    expect(
      [...menu.querySelectorAll('[role="menuitem"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual(['重命名/移动', '创建独立副本', '导出(含依赖)', '移入回收站']);
    await click(button('移入回收站'));
    expect(props.onTrash).toHaveBeenCalledWith('a');
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
  it('opens the same menu with a prevented contextmenu event', async () => {
    await setup();
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 30,
      clientY: 40,
    });
    await act(async () => {
      button('Alpha').closest('.file-tree-row')!.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector('[role="menu"]')).toBeTruthy();
  });
  it('restricts readonly controls to export', async () => {
    await setup({ readonly: true });
    expect(container.querySelector('.file-tree-header button')).toBeNull();
    expect(
      container.querySelector('.file-tree-dir .file-tree-more'),
    ).toBeNull();
    await click(button('「Alpha」的操作'));
    expect(
      [...document.querySelectorAll('[role="menuitem"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual(['导出(含依赖)']);
  });
  it('shows unorganized files at real paths even when their former owner is missing', async () => {
    await setup({
      canvases: [
        {
          frameId: 'c',
          name: 'Child',
          path: 'docs/c.verd.json',
          diagram: 'mind',
        },
      ],
      subgraphs: [
        {
          frameId: 'c',
          name: 'Child',
          path: 'docs/c.verd.json',
          diagram: 'mind',
          placement: 'unorganized',
        },
      ],
    });
    expect(button('Child').getAttribute('title')).toBe('docs/c.verd.json');
    expect(container.querySelector('[data-entry-kind="shortcut"]')).toBeNull();
  });
  it('focuses the canonical row after its full directory path is expanded and can reveal it again', async () => {
    const request = { fileId: 'c', nonce: 1 };
    const props = await setup({
      canvases: [
        { frameId: 'c', name: 'Child', path: 'docs/deep/c.verd.json' },
      ],
      expandedDirs: [],
      revealFile: request,
    });
    expect(container.querySelector('[data-file-id="c"]')).toBeNull();
    await act(async () =>
      root.render(<FileTree {...props} expandedDirs={['docs', 'docs/deep']} />),
    );
    await act(
      async () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect(document.activeElement).toBe(button('Child'));
    button('新建').focus();
    await act(async () =>
      root.render(
        <FileTree
          {...props}
          expandedDirs={['docs', 'docs/deep']}
          revealFile={{ fileId: 'c', nonce: 2 }}
        />,
      ),
    );
    await act(
      async () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect(document.activeElement).toBe(button('Child'));
    expect(props.onOpenFile).not.toHaveBeenCalled();
  });
  it('creates in a collapsed directory and expands it', async () => {
    const props = await setup({ expandedDirs: [] });
    await click(button('「docs」的操作'));
    await click(button('在此新建画布'));
    expect(props.onCreateCanvas).toHaveBeenCalledWith('docs');
    expect(props.onToggleDir).toHaveBeenCalledWith('docs');
  });
  it('highlights the library navigation and localizes menus', async () => {
    await setup({ libraryActive: true, locale: 'en' });
    expect(button('Chart library').getAttribute('aria-current')).toBe('page');
    expect(button('Chart library').classList.contains('is-active')).toBe(true);
    await click(button('Actions for Alpha'));
    expect(button('Rename/move')).toBeTruthy();
  });
  it('keeps an empty naming dialog open and can reopen it after cancellation', async () => {
    await setup();
    await click(button('新建'));
    await click(button('新建文件夹'));
    expect(button('确定').disabled).toBe(true);
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });
    expect(container.querySelector('dialog')).toBeTruthy();
    await click(button('取消'));
    await click(button('新建'));
    await click(button('新建文件夹'));
    expect(container.querySelector('dialog')).toBeTruthy();
  });
});

it('dismisses on an outside captured pointer without swallowing it, and copies the original file', async () => {
  const onCopyLink = vi.fn();
  await setup({ onCopyLink });
  await click(button('「Alpha」的操作'));
  await click(button('复制链接'));
  expect(onCopyLink).toHaveBeenCalledExactlyOnceWith('a');
  await click(button('「Alpha」的操作'));
  const outside = document.createElement('button');
  const received = vi.fn((event: Event) => event.stopPropagation());
  outside.addEventListener('pointerdown', received, true);
  document.body.append(outside);
  try {
    await act(async () => {
      outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(received).toHaveBeenCalledOnce();
  } finally {
    outside.remove();
  }
});

it('exposes selected paths and creation through a floating menu', async () => {
  await setup({ selectedPaths: ['b.verd.json'] });
  expect(
    container
      .querySelector('[data-entry-path="b.verd.json"]')
      ?.getAttribute('aria-selected'),
  ).toBe('true');
  expect(container.querySelector('.file-tree-header details')).toBeNull();
  await click(button('新建'));
  expect(document.querySelector('[role="menu"]')).toBeTruthy();
  expect(button('新建文件夹')).toBeTruthy();
});

it('shows ordinary originals beside native files and preserves genuinely empty directories', async () => {
  const onOpenResource = vi.fn(),
    onOrganize = vi.fn(),
    onTrashResource = vi.fn();
  await setup({
    entries: [
      { path: 'docs', kind: 'directory' },
      { path: 'empty', kind: 'directory' },
      ...['notes.md', 'image.png', 'paper.pdf', 'data.json'].map((name) => ({
        path: 'docs/' + name,
        kind: 'file' as const,
        canvas: false,
      })),
    ],
    onOpenResource,
    onOrganize,
    onTrashResource,
  });
  expect(
    container.querySelectorAll('[data-entry-kind="resource"]'),
  ).toHaveLength(4);
  expect(container.querySelectorAll('[data-file-id="a"]')).toHaveLength(1);
  expect(button('empty')).toBeTruthy();
  await click(button('notes.md'));
  expect(onOpenResource).toHaveBeenCalledWith('docs/notes.md');
  expect(button('notes.md').closest('[data-file-id]')).toBeNull();
  await click(button('「notes.md」的操作'));
  await click(button('重命名'));
  expect(onOrganize).toHaveBeenCalledWith('docs/notes.md', 'rename');
  await click(button('「notes.md」的操作'));
  await click(button('移入回收站'));
  expect(onTrashResource).toHaveBeenCalledWith('docs/notes.md');
});

it('renders a root containing only an ordinary file instead of an empty workspace', async () => {
  await setup({ entries: [{ path: 'readme.md', kind: 'file' }], canvases: [] });
  expect(button('readme.md')).toBeTruthy();
  expect(container.querySelector('.file-tree-empty')).toBeNull();
});
