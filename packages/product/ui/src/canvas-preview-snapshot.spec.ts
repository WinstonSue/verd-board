import { describe, expect, it } from 'vitest';
import {
  createDocumentReferenceCell,
  createFrameCell,
  createFrameReferenceCell,
  validateCellStore,
  type CellStore,
  type NodeCell,
} from '@sue/board-core';
import { canvasPreviewSnapshot } from './canvas-preview-snapshot';

const geometry = { x: 0, y: 0, width: 100, height: 100 };
const node = (id: string): NodeCell => ({
  id,
  cellType: 'node',
  kind: 'geometry',
  geometry,
});
const fixture = (): CellStore => {
  const workspace = createFrameCell('workspace');
  const board = createFrameCell('board');
  const target = createFrameCell('target');
  workspace.children = ['board', 'target'];
  board.children = ['shape', 'reference', 'shared', 'document'];
  board.groups = ['group'];
  target.children = ['back'];
  const cells: CellStore['cells'] = {
    workspace,
    board,
    target,
    shape: node('shape'),
    group: {
      id: 'group',
      cellType: 'group',
      kind: 'group',
      members: ['shape', 'reference'],
    },
    reference: createFrameReferenceCell('reference', 'target', geometry),
    shared: createFrameReferenceCell('shared', 'target', geometry),
    back: createFrameReferenceCell('back', 'board', geometry),
    document: createDocumentReferenceCell('document', 'doc', geometry),
  };
  for (let i = 0; i < 1000; i++) {
    const frame = createFrameCell(`unrelated-${i}`);
    workspace.children.push(frame.id);
    cells[frame.id] = frame;
  }
  return { rootId: workspace.id, cells };
};

describe('canvasPreviewSnapshot', () => {
  it('keeps cyclic and shared canvas dependencies plus document shells, without unrelated files', () => {
    const source = fixture();
    const result = canvasPreviewSnapshot(source, 'board');
    expect(validateCellStore(source)).toEqual([]);
    expect(validateCellStore(result.store)).toEqual([]);
    expect(Object.keys(result.store.cells).sort()).toEqual([
      'back',
      'board',
      'document',
      'group',
      'reference',
      'shape',
      'shared',
      'target',
    ]);
    expect(result.store.cells.document).toBe(source.cells.document);
    expect(result.store.cells.shape).toBe(source.cells.shape);
    expect(canvasPreviewSnapshot(source, 'board')).toBe(result);
  });

  it('reuses the snapshot across unrelated workspace updates and refreshes changed dependencies', () => {
    const source = fixture();
    const previous = canvasPreviewSnapshot(source, 'board');
    const unrelated = {
      ...source,
      cells: { ...source.cells, 'unrelated-0': createFrameCell('unrelated-0') },
    };
    expect(canvasPreviewSnapshot(unrelated, 'board', previous)).toBe(previous);
    const changed = {
      ...unrelated,
      cells: {
        ...unrelated.cells,
        shape: { ...node('shape'), name: 'Updated' },
      },
    };
    const result = canvasPreviewSnapshot(changed, 'board', previous);
    expect(result).not.toBe(previous);
    expect(result.store.cells.shape).toBe(changed.cells.shape);
  });

  it('adopts a previously missing referenced canvas when it becomes available', () => {
    const source = fixture();
    delete source.cells.target;
    delete source.cells.back;
    const previous = canvasPreviewSnapshot(source, 'board');
    expect(validateCellStore(previous.store)).toEqual([]);
    const target = createFrameCell('target');
    const next = { ...source, cells: { ...source.cells, target } };
    const result = canvasPreviewSnapshot(next, 'board', previous);
    expect(result).not.toBe(previous);
    expect(result.store.cells.target).toBe(target);
  });

  it('preserves ownership when a nested canvas references an ancestor', () => {
    const outer = createFrameCell('outer');
    const inner = createFrameCell('inner');
    outer.children = [inner.id];
    inner.children = ['back'];
    const source = {
      rootId: outer.id,
      cells: {
        outer,
        inner,
        back: createFrameReferenceCell('back', outer.id, geometry),
      },
    };
    const result = canvasPreviewSnapshot(source, inner.id);
    expect(result.store.rootId).toBe(outer.id);
    expect(validateCellStore(result.store)).toEqual([]);
    expect(result.store.cells.inner).toBe(inner);
  });
});
