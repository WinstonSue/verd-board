import { describe, expect, it } from 'vitest';
import {
  applyCellOperations,
  createCellRegistry,
  createCellRuntime,
  createCellStore,
  createFrameCell,
  groupCells,
  type NodeCell,
} from '@sue/board-core';
import { createInlineText } from '@sue/board-common';
import {
  fitContentCandidates,
  fitContentOperations,
  fitNodeContent,
} from './frame-fit-content';
const node = (id: string, label = 'Short'): NodeCell => ({
  id,
  kind: 'geometry',
  cellType: 'node',
  geometry: {
    x: 7,
    y: 13,
    width: 240,
    height: 100,
    outline: 'rectangle',
    rotation: 0.5,
  },
  content: { label, text: createInlineText(label) },
});
const fixture = () =>
  applyCellOperations(
    createCellStore(createFrameCell('root')),
    ['a', 'b', 'empty'].map((id) => ({
      type: 'insert_cell' as const,
      parentId: 'root',
      cell: node(id, id === 'empty' ? '' : 'Short'),
    })),
  );
const measure = (_text: unknown, width: number) => ({
  width: width === Infinity ? 80 : width,
  height: 40,
});
describe('fit selection to content', () => {
  it('shrinks short text and preserves position, rotation and content', () => {
    const cell = node('a');
    const fitted = fitNodeContent(cell, measure);
    expect(fitted).toEqual({ ...cell.geometry, width: 96, height: 48 });
    expect(cell.geometry.width).toBe(240);
    const wrapped = fitNodeContent(cell, (_text, width) => ({
      width: width === Infinity ? 1000 : width,
      height: width === Infinity ? 20 : 200,
    }));
    expect(wrapped.width).toBe(240);
    expect(wrapped.height).toBe(208);
  });
  it('fits shape text insets as well as the native text padding', () => {
    const fitted = fitNodeContent(
      { ...node('a'), geometry: { ...node('a').geometry, outline: 'comment' } },
      measure,
    );
    expect(fitted.height).toBeGreaterThan(48);
  });
  it('expands selected groups, deduplicates members, and skips empty, locked and foreign-frame nodes', () => {
    const registry = createCellRegistry();
    let store = fixture();
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['a', 'b'], 'group'),
    );
    const b = store.cells.b as NodeCell;
    store = applyCellOperations(store, [
      { type: 'replace_cell', cell: { ...b, locked: true } },
      {
        type: 'insert_cell',
        parentId: 'root',
        cell: createFrameCell('nested'),
      },
      { type: 'insert_cell', parentId: 'nested', cell: node('inside') },
    ]);
    expect(
      fitContentCandidates(
        store,
        'root',
        ['group', 'a', 'empty', 'inside', 'nested'],
        registry,
      ).map((cell) => cell.id),
    ).toEqual(['a']);
    expect(fitContentCandidates(store, 'root', [], registry)).toEqual([]);
    const group = store.cells.group;
    store = applyCellOperations(store, [
      { type: 'replace_cell', cell: { ...group, locked: true } },
    ]);
    expect(fitContentCandidates(store, 'root', ['a'], registry)).toEqual([]);
  });
  it('commits a batch with one undo and treats repeated fitting as a no-op', () => {
    const registry = createCellRegistry();
    const runtime = createCellRuntime({ store: fixture() }, registry);
    const operations = fitContentOperations(
      runtime.store,
      'root',
      ['a', 'b', 'empty'],
      registry,
      measure,
    );
    expect(operations).toHaveLength(2);
    runtime.transact({ id: 'fit', operations });
    expect((runtime.store.cells.a as NodeCell).geometry.width).toBe(96);
    expect(
      fitContentOperations(
        runtime.store,
        'root',
        ['a', 'b'],
        registry,
        measure,
      ),
    ).toEqual([]);
    runtime.undo();
    expect((runtime.store.cells.a as NodeCell).geometry.width).toBe(240);
    expect((runtime.store.cells.b as NodeCell).geometry.width).toBe(240);
  });
});
