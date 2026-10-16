import { describe, expect, it } from 'vitest';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { createElement, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import {
  createCellRegistry,
  createCellRuntime,
  createFrameCell,
  isFrameCell,
  type CellOperation,
  type FrameCell,
  type NodeCell,
  type MindNodeData,
  type MindRootData,
} from '@sue/board-core';
import {
  addMindChild,
  createMindChildCell,
  createMindFrameSnapshot,
  registerMindCells,
} from '@sue/board-mind';
import { createBlockText } from '@sue/board-common';
import { I18nProvider } from './i18n';
import { FrameMindProperties } from './frame-mind-properties';

const runtime = () => {
  const registry = createCellRegistry();
  registerMindCells(registry);
  const r = createCellRuntime(
    createMindFrameSnapshot('frame', 'root'),
    registry,
  );
  r.transact({
    id: 'child',
    operations: addMindChild(
      r.store,
      'root',
      createMindChildCell('n1'),
      'e-n1',
    ),
  });
  return r;
};

const render = (
  r: ReturnType<typeof runtime>,
  cellId: string,
  overrides: Partial<ComponentProps<typeof FrameMindProperties>> = {},
) => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const applied: { cell?: FrameCell } = {};
  const props = (): ComponentProps<typeof FrameMindProperties> => ({
    cell: r.store.cells[cellId] as NodeCell,
    store: r.store,
    dispatch: (operations: CellOperation[]) =>
      void r.transact({ id: 'ui', operations }),
    frame: isFrameCell(r.store.cells.frame)
      ? (r.store.cells.frame as FrameCell)
      : undefined,
    replace: (cell) =>
      void r.transact({
        id: 'replace',
        operations: [{ type: 'replace_cell', cell }],
      }),
    getCell: () => {
      const latest = r.store.cells[cellId];
      return 'geometry' in latest ? (latest as NodeCell) : undefined;
    },
    ...overrides,
  });
  const flush = () => {
    act(() =>
      root.render(
        createElement(
          I18nProvider,
          { language: 'zh' },
          createElement(FrameMindProperties, props()),
        ),
      ),
    );
  };
  flush();
  return { container, root, flush, applied };
};

const click = (element: Element | null) =>
  element &&
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('FrameMindProperties', () => {
  it('formats the whole note through one transaction per change', () => {
    const r = runtime();
    const child = r.store.cells.n1 as NodeCell<MindNodeData>;
    const note = createBlockText('note text');
    r.transact({
      id: 'note',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...child, data: { ...child.data, note } },
        },
      ],
    });
    const history = r.store.cells.frame as FrameCell;
    void history;
    const { container, flush } = render(r, 'n1');
    const bold = container.querySelector('[aria-label="Format bold"]');
    expect(bold).not.toBeNull();
    click(bold);
    flush();
    const after = r.store.cells.n1 as NodeCell<MindNodeData>;
    const text = after.data?.note as ReturnType<typeof createBlockText>;
    expect(
      text.content.content?.[0].content?.[0].marks?.some(
        (mark) => mark.type === 'bold',
      ),
    ).toBe(true);
    expect(text.content.content?.[0].content?.[0].text).toBe('note text');
  });

  it('disables leaf controls and shows the hint for an empty note', () => {
    const r = runtime();
    const child = r.store.cells.n1 as NodeCell<MindNodeData>;
    r.transact({
      id: 'note',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...child,
            data: { ...child.data, note: createBlockText('') },
          },
        },
      ],
    });
    const { container } = render(r, 'n1');
    expect(
      (
        container.querySelector(
          '[aria-label="Format bold"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(container.textContent).toContain('输入笔记内容后可调整文字样式');
    // Alignment stays usable on an empty note.
    expect(
      (
        container.querySelector(
          '[aria-label="Text alignment"]',
        ) as HTMLSelectElement
      ).disabled,
    ).toBe(false);
  });

  it('applies tree layout across the whole tree from a topic selection', () => {
    const r = runtime();
    const { container, flush } = render(r, 'n1');
    const downward = container.querySelector(
      '[aria-label="Mind layout downward"]',
    );
    click(downward);
    flush();
    const root = r.store.cells.root as NodeCell<MindRootData>;
    expect(root.data?.layout).toBe('downward');
  });

  it('offers a unify button when local overrides exist', () => {
    const r = runtime();
    const child = r.store.cells.n1 as NodeCell<MindNodeData>;
    r.transact({
      id: 'override',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...child, data: { ...child.data, layout: 'upward' } },
        },
      ],
    });
    const { container, flush } = render(r, 'n1');
    expect(container.textContent).toContain('统一整树布局');
    click(
      [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('统一整树布局'),
      ) ?? null,
    );
    flush();
    expect(
      (r.store.cells.n1 as NodeCell<MindNodeData>).data?.layout,
    ).toBeUndefined();
  });

  it('exposes the file-level scheme picker alongside topic settings', () => {
    const r = runtime();
    const { container } = render(r, 'n1');
    const select = container.querySelector(
      '[aria-label="Mind color scheme"]',
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('inherit');
  });

  it('hides note formatting when the topic has no note', () => {
    const r = runtime();
    const { container } = render(r, 'n1');
    expect(container.textContent).not.toContain('笔记文本');
    expect(container.textContent).toContain('添加笔记');
  });
});
