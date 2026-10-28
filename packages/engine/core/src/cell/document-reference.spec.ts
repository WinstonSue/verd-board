import { describe, expect, it } from 'vitest';
import { createTestCellRegistry as createFixtureRegistry } from '../../../../../tests/fixtures/plugins/registry';
import { arrangeCells } from './arrangement';
import { deleteCells } from './index';
import { createCellRuntime } from './runtime';
import {
  createCellStore,
  createDocumentFrameCell,
  createDocumentReferenceCell,
  createFrameCell,
  type NodeCell,
} from './types';
import { DocumentReferenceUtil, type BaseCellUtil } from './util';
import { validateCellStore } from './validation';
const testCellRegistry = createFixtureRegistry();

describe('neutral document occurrences', () => {
  for (const scene of [
    undefined,
    'mind-root',
    'workflow-start',
    'architecture-layer',
  ]) {
    it(`is independently editable as a shell in ${scene ?? 'whiteboard'}, never as document content`, () => {
      const root = createFrameCell('root');
      const store = createCellStore(root);
      if (scene) {
        store.cells['anchor'] = {
          id: 'anchor',
          cellType: 'node',
          kind: scene,
          data:
            scene === 'workflow-start'
              ? { memberIds: ['anchor'], graphMode: 'dag', origin: [0, 0] }
              : scene === 'architecture-layer'
                ? { order: '0', memberIds: [] }
                : undefined,
          geometry: { x: 0, y: 0, width: 100, height: 60 },
        } as NodeCell;
        root.children.push('anchor');
      }
      const card = createDocumentReferenceCell('card', 'external-document', {
        x: 600,
        y: 300,
        width: 480,
        height: 400,
      });
      root.children.push(card.id);
      store.cells[card.id] = card;
      expect(validateCellStore(store, testCellRegistry)).toEqual([]);
      const runtime = createCellRuntime({ store }, testCellRegistry);
      const util = testCellRegistry.get(card.kind) as DocumentReferenceUtil;
      expect(util).toBeInstanceOf(DocumentReferenceUtil);
      expect(util.capabilities(runtime.store, card, 'embedded')).toMatchObject({
        move: true,
        resize: true,
        delete: true,
        edit: false,
        rotate: false,
        connect: false,
      });
      if (scene === 'workflow-start' || scene === 'architecture-layer') {
        const ops = arrangeCells(
          store,
          root.id,
          [],
          scene === 'workflow-start' ? 'flow' : 'layers',
          32,
          testCellRegistry,
        );
        expect(
          ops.some(
            (op) => op.type === 'replace_cell' && op.cell.id === card.id,
          ),
        ).toBe(false);
      }
      runtime.transact({
        id: 'delete',
        operations: deleteCells(runtime.store, [card.id], {
          registry: runtime.registry,
        }),
      });
      expect(runtime.store.cells[card.id]).toBeUndefined();
    });
  }
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

it('editable document Frames are allowed only in regular canvases and keep Frame shell capabilities', () => {
  const root = createFrameCell('root');
  const store = createCellStore(root);
  const frame = createDocumentFrameCell('document', 'source', {
    x: 0,
    y: 0,
    width: 480,
    height: 400,
  });
  root.children.push(frame.id);
  store.cells[frame.id] = frame;
  expect(validateCellStore(store, testCellRegistry)).toEqual([]);
  const runtime = createCellRuntime({ store }, testCellRegistry);
  expect(
    (testCellRegistry.get(frame.kind) as BaseCellUtil).capabilities(
      runtime.store,
      frame,
      'embedded',
    ),
  ).toMatchObject({
    edit: true,
    move: true,
    resize: true,
    rotate: false,
    connect: false,
  });
  store.cells.anchor = {
    id: 'anchor',
    kind: 'mind-root',
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 100, height: 40 },
  } as NodeCell;
  root.children.push('anchor');
  expect(
    validateCellStore(store, testCellRegistry).some(
      (issue) => issue.cellId === frame.id && issue.message.includes('scene'),
    ),
  ).toBe(true);
});
