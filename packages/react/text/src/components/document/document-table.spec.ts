// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/react';
import { createBlockText } from '@sue/board-common';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { createDocumentExtensions } from '../../constants/editor-config';
import { createDocumentController } from './document-controller';
import {
  planTableMove,
  tableHandleTarget,
  tableScope,
  tableScopeKey,
  tableSelection,
} from './document-table';

HTMLElement.prototype.scrollIntoView ??= () => {};
const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
const paragraph = (text = '', id = 'body') => ({
  type: 'paragraph',
  attrs: { blockId: id },
  content: text ? [{ type: 'text', text }] : [],
});
function make(rows = 3, columns = 3) {
  const editor = new Editor({
    extensions: createDocumentExtensions(),
    content: {
      type: 'doc',
      content: [
        {
          type: 'table',
          attrs: { blockId: 'table' },
          content: Array.from({ length: rows }, (_, row) => ({
            type: 'tableRow',
            content: Array.from({ length: columns }, (_, col) => ({
              type: row === 0 ? 'tableHeader' : 'tableCell',
              attrs: { colwidth: [100 + col * 20] },
              content: [paragraph(`${row}-${col}`, `p-${row}-${col}`)],
            })),
          })),
        },
        paragraph('After'),
      ],
    },
  });
  editors.push(editor);
  const base = createBlockText('');
  const controller = createDocumentController(editor, {
    withSource: (_source, run) => run(),
    getBaseDocument: () => base,
    undo: () => editor.commands.undo(),
    redo: () => editor.commands.redo(),
    canUndo: () => editor.can().undo(),
    canRedo: () => editor.can().redo(),
  });
  const select = (
    kind: 'table' | 'row' | 'column',
    first = 0,
    last = first,
  ) => {
    const selection = tableSelection(editor.state.doc, 0, kind, first, last)!;
    editor.view.dispatch(
      editor.state.tr.setSelection(selection).setMeta(tableScopeKey, kind),
    );
  };
  return { editor, controller, select };
}

describe('document table structure', () => {
  it('locates hovered cells and the focused cell independently of selection direction', () => {
    const { editor, select } = make();
    const map = TableMap.get(editor.state.doc.firstChild!);
    const cell = 1 + map.map[5];
    expect(tableHandleTarget(editor.state, cell)).toEqual({
      start: 0,
      cell,
      row: 1,
      column: 2,
    });
    editor.commands.setTextSelection(cell + 2);
    expect(tableHandleTarget(editor.state)?.column).toBe(2);
    select('row', 1);
    expect(tableHandleTarget(editor.state)).toMatchObject({
      row: 1,
      column: 2,
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(
        new CellSelection(
          editor.state.doc.resolve(cell),
          editor.state.doc.resolve(1 + map.map[0]),
        ),
      ),
    );
    expect(tableHandleTarget(editor.state)).toMatchObject({
      row: 0,
      column: 0,
    });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(tableHandleTarget(editor.state)).toBeNull();
    expect(tableHandleTarget(editor.state, 0)).toBeNull();
  });

  it('uses logical column indices after merged cells and their starting row and column', () => {
    const { editor, select } = make();
    const map = TableMap.get(editor.state.doc.firstChild!);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        new CellSelection(
          editor.state.doc.resolve(1 + map.map[3]),
          editor.state.doc.resolve(1 + map.map[4]),
        ),
      ),
    );
    editor.commands.mergeCells();
    const merged = TableMap.get(editor.state.doc.firstChild!);
    expect(tableHandleTarget(editor.state)).toMatchObject({
      row: 1,
      column: 0,
    });
    expect(tableHandleTarget(editor.state, 1 + merged.map[5])).toMatchObject({
      row: 1,
      column: 2,
    });
    select('row', 0);
    editor.commands.addRowBefore();
    const shifted = TableMap.get(editor.state.doc.firstChild!);
    expect(tableHandleTarget(editor.state, 1 + shifted.map[6])).toMatchObject({
      row: 2,
      column: 0,
    });
  });

  it.each(['row', 'column'] as const)(
    'moves %ss with original nodes, headers, IDs, widths and one undo step',
    async (axis) => {
      const { editor, controller, select } = make();
      const before = editor.state.doc;
      const oldTable = before.firstChild!;
      select(axis, 0);
      expect(
        (
          await controller.executeAction(`document.move-${axis}`, {
            toIndex: 2,
          })
        ).status,
      ).toBe('completed');
      const next = editor.state.doc.firstChild!;
      expect(TableMap.get(next).problems).toBeNull();
      if (axis === 'row') expect(next.child(2)).toBe(oldTable.child(0));
      else
        for (let row = 0; row < 3; row++)
          expect(next.child(row).child(2)).toBe(oldTable.child(row).child(0));
      expect(tableScope(editor.state)).toMatchObject(
        axis === 'row'
          ? { kind: axis, top: 2, bottom: 3 }
          : { kind: axis, left: 2, right: 3 },
      );
      expect(editor.state.selection).toBeInstanceOf(CellSelection);
      expect(editor.commands.undo()).toBe(true);
      expect(editor.state.doc.eq(before)).toBe(true);
      expect(editor.commands.redo()).toBe(true);
      expect(editor.state.doc.firstChild!.eq(next)).toBe(true);
    },
  );

  it.each(['row', 'column'] as const)(
    'moves a contiguous %s range without changing its order',
    async (axis) => {
      const { editor, controller, select } = make(4, 4);
      select(axis, 1, 2);
      const before = editor.state.doc.firstChild!;
      await controller.executeAction(`document.move-${axis}`, { toIndex: 0 });
      const next = editor.state.doc.firstChild!;
      if (axis === 'row') {
        expect(next.child(0)).toBe(before.child(1));
        expect(next.child(1)).toBe(before.child(2));
      } else {
        expect(next.child(0).child(0)).toBe(before.child(0).child(1));
        expect(next.child(0).child(1)).toBe(before.child(0).child(2));
      }
    },
  );

  it.each([
    ['add-row-before', 'row', 4, 3],
    ['add-row-after', 'row', 4, 3],
    ['add-column-before', 'column', 3, 4],
    ['add-column-after', 'column', 3, 4],
    ['delete-row', 'row', 2, 3],
    ['delete-column', 'column', 3, 2],
  ] as const)(
    '%s changes the selected structure and can be undone',
    async (action, axis, rows, columns) => {
      const { editor, controller, select } = make();
      const before = editor.state.doc;
      select(axis, 1);
      expect(
        (await controller.executeAction(`document.${action}`)).status,
      ).toBe('completed');
      const map = TableMap.get(editor.state.doc.firstChild!);
      expect([map.height, map.width]).toEqual([rows, columns]);
      editor.commands.undo();
      expect(editor.state.doc.eq(before)).toBe(true);
    },
  );

  it.each(['row', 'column'] as const)(
    'deleting the final %s deletes the table',
    async (axis) => {
      const { editor, controller, select } = make(1, 1);
      const before = editor.state.doc;
      select(axis);
      expect(tableScope(editor.state)?.kind).toBe(axis);
      await controller.executeAction(`document.delete-${axis}`);
      expect(editor.state.doc.firstChild!.type.name).toBe('paragraph');
      editor.commands.undo();
      expect(editor.state.doc.eq(before)).toBe(true);
    },
  );

  it('uses captured targets and rejects stale, readonly, boundary and malformed moves', async () => {
    const { editor, controller, select } = make();
    select('row', 1);
    const action = controller
      .actions()
      .find((entry) => entry.id === 'document.move-row')!
      .capture();
    select('column', 2);
    expect(action.getState({ toIndex: 0 }).enabled).toBe(true);
    await action.execute({ toIndex: 0 });
    expect(editor.state.doc.firstChild!.firstChild!.textContent).toBe(
      '1-01-11-2',
    );
    select('row', 0);
    expect(
      controller.getActionState('document.move-row', { toIndex: -1 }).enabled,
    ).toBe(false);
    expect(
      controller.getActionState('document.move-row', { toIndex: 0 }).enabled,
    ).toBe(false);
    expect(
      controller.getActionState('document.move-row', { toIndex: 0.5 }).enabled,
    ).toBe(false);
    const stale = controller
      .actions()
      .find((entry) => entry.id === 'document.move-row')!
      .capture();
    editor.commands.insertContent('Changed');
    const snapshot = editor.state.doc;
    expect((await stale.execute({ toIndex: 1 })).status).toBe('cancelled');
    editor.setEditable(false);
    expect(
      controller.getActionState('document.move-row', { toIndex: 1 }).enabled,
    ).toBe(false);
    await controller.executeAction('document.delete-table');
    expect(editor.state.doc).toBe(snapshot);
  });

  it('rejects moves across merged cells and preserves legal merged ranges', () => {
    const { editor, select } = make(4, 3);
    select('row', 1);
    editor.commands.mergeCells();
    select('column', 0);
    expect(planTableMove(editor.state, 'column', 2)).toBeNull();
    select('row', 1);
    expect(planTableMove(editor.state, 'row', 2)).not.toBeNull();
    const merged = editor.state.doc.firstChild!.child(1).firstChild!;
    expect(merged.attrs['colspan']).toBe(3);
    const plan = planTableMove(editor.state, 'row', 2)!;
    expect(plan.table.child(2).firstChild).toBe(merged);
    expect(TableMap.get(plan.table).problems).toBeNull();
  });

  it('preserves rowspans when moving complete row ranges and rejects partial ranges', () => {
    const { editor, select } = make(4, 4);
    const map = TableMap.get(editor.state.doc.firstChild!);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        new CellSelection(
          editor.state.doc.resolve(1 + map.map[5]),
          editor.state.doc.resolve(1 + map.map[9]),
        ),
      ),
    );
    editor.commands.mergeCells();
    const merged = editor.state.doc.firstChild!.child(1).child(1);
    expect(merged.attrs['rowspan']).toBe(2);
    select('row', 1);
    expect(planTableMove(editor.state, 'row', 0)).toBeNull();
    select('row', 1, 2);
    const plan = planTableMove(editor.state, 'row', 0)!;
    expect(plan.table.child(0).child(1)).toBe(merged);
    expect(TableMap.get(plan.table).problems).toBeNull();
  });

  it('does not show document hints in empty cells but keeps ordinary and nested paragraph hints', () => {
    const { editor } = make(1, 1);
    vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true);
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [{ type: 'tableHeader', content: [paragraph()] }],
            },
          ],
        },
        paragraph(),
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [paragraph()] }],
        },
      ],
    });
    editor.commands.setTextSelection(4);
    expect(
      editor.view.dom.querySelector('th p')?.getAttribute('data-placeholder') ??
        '',
    ).toBe('');
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph') positions.push(pos + 1);
    });
    for (const pos of positions.slice(1)) {
      editor.commands.setTextSelection(pos);
      expect(
        editor.view.dom.querySelector('[data-placeholder="输入 / 插入内容"]'),
      ).not.toBeNull();
    }
  });
});
