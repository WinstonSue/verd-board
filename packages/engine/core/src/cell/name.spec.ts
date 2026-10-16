import { describe, expect, it } from 'vitest';
import {
  createCellRuntime,
  createCellStore,
  createFrameCell,
  type NodeCell,
} from '../public-api';
import { nodeContentName } from './name';
const node = (label = ''): NodeCell => ({
  id: 'n',
  kind: 'text',
  cellType: 'node',
  geometry: { x: 0, y: 0, width: 100, height: 60 },
  content: { label },
});
describe('independent node names', () => {
  it('initializes insertion transactionally and restores absence on undo', () => {
    const runtime = createCellRuntime({
      store: createCellStore(createFrameCell('root')),
    });
    runtime.transact({
      id: 'insert',
      operations: [
        { type: 'insert_cell', parentId: 'root', cell: node('Hello\nworld') },
      ],
    });
    expect((runtime.store.cells.n as NodeCell).name).toBe('Hello world');
    runtime.undo();
    expect(runtime.store.cells.n).toBeUndefined();
    runtime.redo();
    expect((runtime.store.cells.n as NodeCell).name).toBe('Hello world');
  });
  it('defers empty-node naming through all keystrokes and preserves explicit empty names', () => {
    const runtime = createCellRuntime({
      store: createCellStore(createFrameCell('root')),
    });
    runtime.transact({
      id: 'insert',
      operations: [{ type: 'insert_cell', parentId: 'root', cell: node() }],
    });
    for (const label of ['H', 'He', 'Hello'])
      runtime.transact({
        id: label,
        operations: [
          {
            type: 'replace_cell',
            deferName: true,
            cell: {
              ...(runtime.store.cells.n as NodeCell),
              content: { label },
            },
          },
        ],
      });
    expect((runtime.store.cells.n as NodeCell).name).toBeUndefined();
    runtime.transact({
      id: 'close',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...(runtime.store.cells.n as NodeCell), name: 'Hello' },
        },
      ],
    });
    runtime.undo();
    expect((runtime.store.cells.n as NodeCell).name).toBeUndefined();
    runtime.redo();
    runtime.transact({
      id: 'empty-name',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...(runtime.store.cells.n as NodeCell), name: '' },
        },
      ],
    });
    runtime.transact({
      id: 'body',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...(runtime.store.cells.n as NodeCell),
            content: { label: 'Changed body' },
          },
        },
      ],
    });
    expect((runtime.store.cells.n as NodeCell).name).toBe('');
  });
  it('freezes a legacy name before body changes, ignoring rich-text formatting', () => {
    const snapshot = { store: createCellStore(createFrameCell('root')) };
    snapshot.store.cells.root = {
      ...snapshot.store.cells.root,
      children: ['n'],
    } as typeof snapshot.store.cells.root;
    snapshot.store.cells.n = {
      ...node('old'),
      content: {
        label: 'old',
        text: { plainText: 'Rich\nbody', marks: { bold: true } },
      },
    };
    expect(nodeContentName(snapshot.store.cells.n as NodeCell)).toBe(
      'Rich body',
    );
    const runtime = createCellRuntime(snapshot);
    runtime.transact({
      id: 'edit',
      operations: [{ type: 'replace_cell', cell: { ...node('new') } }],
    });
    expect((runtime.store.cells.n as NodeCell).name).toBe('Rich body');
    runtime.undo();
    expect((runtime.store.cells.n as NodeCell).name).toBeUndefined();
    expect((runtime.store.cells.n as NodeCell).content?.label).toBe('old');
  });
});
