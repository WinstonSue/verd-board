import { describe, expect, it } from 'vitest';
import { createTestCellRegistry as createFixtureRegistry } from '../../../../../tests/fixtures/core/registry';
import { deleteCells } from './index';
import { createCellRuntime } from './runtime';
import {
  createCellStore,
  createDocumentReferenceCell,
  createFrameCell,
} from './types';
import { DocumentReferenceUtil } from './util';
import { validateCellStore } from './validation';
const testCellRegistry = createFixtureRegistry();
describe('neutral document occurrences', () => {
  it('edits and deletes a neutral document shell without resolving its external content', () => {
    const frame = createFrameCell('root');
    const store = createCellStore(frame);
    const card = createDocumentReferenceCell('card', 'external-document', {
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
    frame.children.push(card.id);
    store.cells[card.id] = card;
    const runtime = createCellRuntime({ store }, testCellRegistry);
    expect(
      (testCellRegistry.get(card.kind) as DocumentReferenceUtil).capabilities(
        store,
        card,
        'embedded',
      ),
    ).toMatchObject({
      move: true,
      resize: true,
      delete: true,
      edit: false,
      rotate: false,
      connect: false,
    });
    runtime.transact({
      id: 'delete',
      operations: deleteCells(store, [card.id], { registry: testCellRegistry }),
    });
    expect(runtime.store.cells.card).toBeUndefined();
    runtime.undo();
    expect(runtime.store).toEqual(store);
  });

  it('rejects malformed targets, rotation and connected cards while allowing missing source files', () => {
    const root = createFrameCell('root');
    const store = createCellStore(root);
    const card = createDocumentReferenceCell('card', '', {
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      rotation: 1,
    });
    root.children.push(card.id);
    store.cells[card.id] = card;
    expect(
      validateCellStore(store, testCellRegistry).map((issue) => issue.message),
    ).toEqual(
      expect.arrayContaining([
        'Document reference requires a target',
        'Document references cannot rotate',
      ]),
    );
  });
});
