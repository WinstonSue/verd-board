import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('keeps owned files at their real paths and also indents shortcuts', async () => {
    const props = await setup({
      canvases: [
        { frameId: 'a', name: 'Alpha', path: 'docs/a.verd.json' },
        {
          frameId: 'c',
          name: 'Child',
          path: 'c.verd.json',
          diagram: 'workflow',
        },
      ],
      subgraphs: [
        {
          frameId: 'c',
          name: 'Child',
          path: 'c.verd.json',
          diagram: 'workflow',
          placement: 'owned',
          ownerFrameId: 'a',
        },
      ],
      expandedOwners: ['a'],
    });
    await click(button('Alpha'));
    expect(props.onOpenFile).toHaveBeenCalledWith('a');
    expect(button('Alpha').getAttribute('aria-current')).toBe('page');
    expect(
      button('Alpha')
        .closest<HTMLElement>('.file-tree-row')
        ?.style.getPropertyValue('--depth'),
    ).toBe('1');
    expect(
      button('Child (快捷入口)')
        .closest<HTMLElement>('.file-tree-row')
        ?.style.getPropertyValue('--depth'),
    ).toBe('2');
    expect(button('Child').getAttribute('title')).toBe('c.verd.json');
    expect(container.querySelectorAll('[data-file-id="c"]')).toHaveLength(2);
    expect(container.querySelector('details, summary')).toBeNull();
    expect(container.textContent).not.toContain('更多');
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
  it('limits shortcut menus to navigation and keeps canonical file menus independent', async () => {
    const props = await setup({
      canvases: [
        { frameId: 'a', name: 'Alpha', path: 'a.verd.json' },
        {
          frameId: 'c',
          name: 'Child',
          path: 'docs/c.verd.json',
          diagram: 'mind',
          dirty: true,
        },
      ],
      subgraphs: [
        {
          frameId: 'c',
          name: 'Child',
          path: 'docs/c.verd.json',
          diagram: 'mind',
          placement: 'owned',
          ownerFrameId: 'a',
        },
      ],
      expandedOwners: ['a'],
      onRevealFile: vi.fn(),
      activeFileId: 'c',
    });
    const source = container.querySelector<HTMLElement>(
      '[data-entry-kind="file"][data-file-id="c"]',
    )!;
    const shortcut = container.querySelector<HTMLElement>(
      '[data-entry-kind="shortcut"]',
    )!;
    expect(source.classList.contains('is-active')).toBe(true);
    expect(shortcut.classList.contains('is-active')).toBe(true);
    expect(source.querySelector('.file-tree-dirty')).toBeTruthy();
    expect(shortcut.querySelector('.file-tree-dirty')).toBeTruthy();
    await click(shortcut.querySelector<HTMLButtonElement>('.file-tree-more')!);
    expect(
      [...document.querySelectorAll('[role="menuitem"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual(['打开', '在文件夹中显示']);
    expect(source.classList.contains('is-menu-open')).toBe(false);
    await click(button('在文件夹中显示'));
    expect(props.onRevealFile).toHaveBeenCalledWith('c');
    expect(props.onOpenFile).not.toHaveBeenCalled();
    await click(button('Child (快捷入口)'));
    expect(props.onOpenFile).toHaveBeenCalledWith('c');
    await click(source.querySelector<HTMLButtonElement>('.file-tree-more')!);
    expect(
      [...document.querySelectorAll('[role="menuitem"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual(['重命名/移动', '创建独立副本', '导出(含依赖)', '移入回收站']);
    expect(shortcut.classList.contains('is-menu-open')).toBe(false);
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
    button('新建画布').focus();
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
    await click(button('新建文件夹'));
    expect(container.querySelector('dialog')).toBeTruthy();
  });
});
