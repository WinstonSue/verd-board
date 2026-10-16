import { describe, expect, it } from 'vitest';
import {
  createCellStore,
  createFrameCell,
  type Cell,
  type FrameCell,
} from './types';
import { applyCellOperations } from './index';
import { createCellRuntime } from './runtime';
import { clearFrameCells } from './commands';

describe('clear mounted frame', () => {
  it.each(['mind-root', 'workflow-start', 'architecture-layer', 'geometry'])(
    'retains required %s anchors and restores the exact document in one undo',
    (kind) => {
      const root = createFrameCell('root');
      root.view = { theme: { boardBackground: '#eef2ff' } };
      const make = (id: string): Cell => ({
        id,
        kind,
        cellType: 'node',
        geometry: { x: 0, y: 0, width: 100, height: 40 },
        data:
          kind === 'workflow-start'
            ? { memberIds: [id], origin: [0, 0], graphMode: 'dag' }
            : kind === 'architecture-layer'
              ? { memberIds: [], order: id }
              : {},
      });
      const store = applyCellOperations(createCellStore(root), [
        { type: 'insert_cell', parentId: 'root', cell: make('a') },
        { type: 'insert_cell', parentId: 'root', cell: make('b') },
      ]);
      const runtime = createCellRuntime({ store });
      runtime.transact({
        id: 'clear',
        operations: clearFrameCells(store, 'root'),
      });
      expect((runtime.store.cells.root as FrameCell).children).toEqual(
        kind === 'workflow-start'
          ? ['a', 'b']
          : kind === 'geometry'
            ? []
            : ['a'],
      );
      expect((runtime.store.cells.root as FrameCell).view).toEqual(root.view);
      runtime.undo();
      expect(runtime.store).toEqual(store);
      runtime.redo();
      expect(runtime.store.cells.root).toMatchObject({ view: root.view });
    },
  );
  it('clears descendants and groups inside one frame without touching its sibling', () => {
    const store = applyCellOperations(
      createCellStore(createFrameCell('root')),
      [
        {
          type: 'insert_cell',
          parentId: 'root',
          cell: createFrameCell('inside'),
        },
        {
          type: 'insert_cell',
          parentId: 'inside',
          cell: createFrameCell('descendant'),
        },
        {
          type: 'insert_cell',
          parentId: 'root',
          cell: createFrameCell('sibling'),
        },
      ],
    );
    const runtime = createCellRuntime({ store });
    runtime.transact({
      id: 'clear',
      operations: clearFrameCells(store, 'inside'),
    });
    expect(runtime.store.cells.descendant).toBeUndefined();
    expect(runtime.store.cells.sibling).toEqual(store.cells.sibling);
    runtime.undo();
    expect(runtime.store).toEqual(store);
  });
});
