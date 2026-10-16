import { describe, it, expect } from 'vitest';
import { Alignment, createInlineText } from '@sue/board-common';
import {
  createCellRuntime,
  createFrameCell,
  createCellStore,
  applyCellOperations,
  groupCells,
  type NodeCell,
} from '@sue/board-core';
import {
  formatSelectionText,
  updateSelectionText,
} from './frame-selection-text';

describe('selection text formatting', () => {
  it('preserves mixed styles, links and structure while replacing only requested marks', () => {
    const original = createInlineText('Linked');
    original.content.content![0].content![0].marks = [
      { type: 'link', attrs: { href: 'https://example.com' } },
      { type: 'bold' },
      {
        type: 'textStyle',
        attrs: { color: '#112233', fontFamily: 'serif', fontSize: '14px' },
      },
    ];
    const next = formatSelectionText(original, {
      bold: false,
      fontSize: '24px',
      align: Alignment.left,
    });
    expect(next.content.content![0].content![0].marks).toEqual([
      { type: 'link', attrs: { href: 'https://example.com' } },
      {
        type: 'textStyle',
        attrs: { color: '#112233', fontFamily: 'serif', fontSize: '24px' },
      },
    ]);
    expect(next.content.content![0].attrs).toEqual({ textAlign: 'left' });
    expect(next).toMatchObject({
      id: original.id,
      plainText: 'Linked',
      align: 'left',
    });
    expect(original.content.content![0].content![0].marks).toHaveLength(3);
  });
  it('formats a group and arrow labels atomically, skips locked content and nested frames, and undoes exactly', () => {
    const node = (id: string): NodeCell => ({
      id,
      cellType: 'node',
      kind: 'geometry',
      geometry: { x: 0, y: 0, width: 100, height: 40 },
      content: { label: id, text: createInlineText(id) },
    });
    let store = applyCellOperations(createCellStore(createFrameCell('root')), [
      ...['a', 'b', 'locked'].map((id) => ({
        type: 'insert_cell' as const,
        parentId: 'root',
        cell: { ...node(id), locked: id === 'locked' },
      })),
      {
        type: 'insert_cell',
        parentId: 'root',
        cell: createFrameCell('nested'),
      },
      { type: 'insert_cell', parentId: 'nested', cell: node('inside') },
      {
        type: 'insert_cell',
        parentId: 'root',
        cell: {
          id: 'arrow',
          kind: 'arrow',
          cellType: 'edge',
          source: { cellId: 'a' },
          target: { cellId: 'b' },
          route: { mode: 'auto' },
          labels: [
            { text: 'First', position: 0.2 },
            { text: 'Second', position: 0.8 },
          ],
        },
      },
    ]);
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['a', 'b'], 'group'),
    );
    const runtime = createCellRuntime({ store });
    runtime.transact({
      id: 'format',
      operations: updateSelectionText(
        store,
        ['group', 'arrow', 'locked', 'nested'],
        { bold: true, color: '#abcdef' },
      ),
    });
    expect((runtime.store.cells.a as NodeCell).content?.text).toMatchObject({
      plainText: 'a',
    });
    expect(JSON.stringify(runtime.store.cells.arrow)).toContain('textStyle');
    expect(runtime.store.cells.inside).toEqual(store.cells.inside);
    expect(runtime.store.cells.locked).toEqual(store.cells.locked);
    expect(runtime.history.undos).toHaveLength(1);
    runtime.undo();
    expect(runtime.store).toEqual(store);
  });
});
