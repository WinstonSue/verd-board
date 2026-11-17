import { expect, it } from 'vitest';
import {
  createFrameCell,
  createCellStore,
  validateCellStore,
  indexCells,
} from '@sue/board-core';
import { createArchitectureFrameSnapshot } from '../../../architecture/src/cell-commands';
import { createWorkflowFrameSnapshot } from '../../../workflow/src/cell-commands';
import { createMindFrameSnapshot } from '../../../mind/src/cell-commands';
import {
  createUmlClassFrameSnapshot,
  createUmlSequenceFrameSnapshot,
} from '../../../uml/src/model';
import { createTestCellRegistry } from '../../../../../tests/fixtures/plugins/registry';
import { createCardCell } from '../cell-commands';

it.each([
  ['board', () => ({ store: createCellStore(createFrameCell('frame')) })],
  ['mind', () => createMindFrameSnapshot('frame', 'anchor')],
  ['workflow', () => createWorkflowFrameSnapshot('frame', 'anchor')],
  ['architecture', () => createArchitectureFrameSnapshot('frame', 'anchor')],
  ['uml-class', () => createUmlClassFrameSnapshot('frame', 'anchor')],
  ['uml-sequence', () => createUmlSequenceFrameSnapshot('frame', 'anchor')],
] as const)(
  'supports an independent block-text card in %s',
  (_name, create) => {
    const snapshot = create();
    const frame = snapshot.store.cells.frame as ReturnType<
      typeof createFrameCell
    >;
    const card = createCardCell('card', [[20, 40]], 'Title\nDescription');
    frame.children.push(card.id);
    snapshot.store.cells[card.id] = card;
    const registry = createTestCellRegistry();
    expect(validateCellStore(snapshot.store, registry)).toEqual([]);
    expect(card.content?.text).toMatchObject({
      kind: 'block',
      plainText: 'Title\nDescription',
    });
    expect(card.geometry).toMatchObject({ width: 320, height: 120 });
    expect(
      indexCells(snapshot.store, registry).domainOwnerOf.has(card.id),
    ).toBe(false);
    expect(
      registry.get('card')!.capabilities!(snapshot.store, card, 'embedded'),
    ).toMatchObject({ move: true, edit: true, connect: false, rotate: false });
  },
);
