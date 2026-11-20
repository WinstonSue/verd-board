import { expect, it } from 'vitest';
import { createTestCellRegistry } from '../../fixtures/plugins/registry';
import {
  createCellStore,
  createFrameCell,
  type NodeCell,
} from '../../../packages/engine/core/src/cell/types';
import { validateCellStore } from '../../../packages/engine/core/src/cell/validation';
import { arrangeCells } from '../../../packages/engine/core/src/cell/arrangement';

it.each(['mind-root', 'workflow-start', 'architecture-layer'])(
  'supports plain text annotations outside %s membership and layout',
  (kind) => {
    const registry = createTestCellRegistry(),
      frame = createFrameCell('root'),
      store = createCellStore(frame);
    store.cells.anchor = {
      id: 'anchor',
      kind,
      cellType: 'node',
      geometry: { x: 0, y: 0, width: 100, height: 60 },
      data:
        kind === 'workflow-start'
          ? { memberIds: ['anchor'], graphMode: 'dag', origin: [0, 0] }
          : kind === 'architecture-layer'
            ? { order: '0', memberIds: [] }
            : undefined,
    } as NodeCell;
    const note: NodeCell = {
      id: 'note',
      kind: 'geometry',
      cellType: 'node',
      geometry: { x: 600, y: 400, width: 900, height: 160, outline: 'text' },
      content: { label: 'Read documentation' },
    };
    store.cells.note = note;
    frame.children.push('anchor', 'note');
    expect(validateCellStore(store, registry)).toEqual([]);
    if (kind !== 'mind-root')
      expect(
        arrangeCells(
          store,
          frame.id,
          [],
          kind === 'workflow-start' ? 'flow' : 'layers',
          32,
          registry,
        ).some((op) => op.type === 'replace_cell' && op.cell.id === 'note'),
      ).toBe(false);
    note.geometry.outline = 'rectangle';
    expect(
      validateCellStore(store, registry).some(
        (issue) =>
          issue.cellId === 'note' && issue.message.includes('frame scene'),
      ),
    ).toBe(true);
  },
);
