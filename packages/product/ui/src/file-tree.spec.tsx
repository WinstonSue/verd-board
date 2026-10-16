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
    trash: [
      { entryId: 'trash-a', originalPath: 'gone.verd.json', trashedAt: 1 },
    ],
    activeFileId: 'a',
    expandedDirs: ['docs'],
    onOpenFile: vi.fn(),
    onToggleDir: vi.fn(),
    onCreateCanvas: vi.fn(),
    onCreateDocument: vi.fn(),
    onCreateFolder: vi.fn(),
    onTrash: vi.fn(),
    onRestore: vi.fn(),
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
      element.getAttribute('aria-label') === name ||
      element.textContent === name,
  )!;
const click = async (element: HTMLElement) => act(async () => element.click());
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

describe('FileTree', () => {
  it('opens files, marks the current file and indents owned subgraphs', async () => {
    const props = await setup({
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
      button('Child')
        .closest<HTMLElement>('.file-tree-row')
        ?.style.getPropertyValue('--depth'),
    ).toBe('2');
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
    ).toEqual(['重命名/移动', '创建独立副本', '导出(含依赖)', '移入回收区']);
    await click(button('移入回收区'));
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
  it('changes ownership through a dialog and disables the current owner', async () => {
    const props = await setup({
      subgraphs: [
        {
          frameId: 'c',
          name: 'Child',
          path: 'c.verd.json',
          diagram: 'mind',
          placement: 'owned',
          ownerFrameId: 'a',
        },
      ],
      expandedOwners: ['a'],
      owners: [
        { frameId: 'a', name: 'Alpha' },
        { frameId: 'b', name: 'Beta' },
      ],
      onChangeOwner: vi.fn(),
    });
    await click(button('「Child」的操作'));
    await click(button('更改所属画布…'));
    expect(button('确定').disabled).toBe(true);
    const select = container.querySelector(
      'dialog select',
    ) as HTMLSelectElement;
    await act(async () => {
      select.value = 'b';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });
    expect(props.onChangeOwner).toHaveBeenCalledWith('c', 'b');
    expect(container.querySelector('dialog')).toBeNull();
  });
  it('creates in a collapsed directory and expands it', async () => {
    const props = await setup({ expandedDirs: [] });
    await click(button('「docs」的操作'));
    await click(button('在此新建画布'));
    expect(props.onCreateCanvas).toHaveBeenCalledWith('docs');
    expect(props.onToggleDir).toHaveBeenCalledWith('docs');
  });
  it('collapses trash by default and restores an expanded entry', async () => {
    const props = await setup();
    expect(container.querySelector('.file-tree-trash-name')).toBeNull();
    expect(container.querySelector('.file-tree-count')?.textContent).toBe('1');
    await click(container.querySelector('.file-tree-trash-toggle')!);
    await click(button('还原 gone.verd.json'));
    expect(props.onRestore).toHaveBeenCalledWith('trash-a');
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
