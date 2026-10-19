import { describe, expect, it } from 'vitest';
import {
  createCellRuntime,
  createCellStore,
  createFrameCell,
  type NodeCell,
} from '@sue/board-core';
import { openFrameOperations } from './frame-open';

describe('openFrameOperations', () => {
  it('replaces content and theme in one undoable transaction and keeps the frame id', () => {
    const board = createFrameCell('board');
    board.view = { theme: { boardBackground: '#ffffff' } };
    const child: NodeCell = {
      id: 'kept',
      kind: 'geometry',
      cellType: 'node',
      geometry: { x: 0, y: 0, width: 10, height: 10 },
    };
    board.children = ['kept'];
    const current = createCellStore(board);
    current.cells.kept = child;
    const file = createFrameCell('file');
    file.view = { theme: { boardBackground: '#dddddd' } };
    const imported: NodeCell = {
      id: 'imported',
      kind: 'geometry',
      cellType: 'node',
      geometry: { x: 8, y: 8, width: 20, height: 20 },
    };
    file.children = ['imported'];
    const runtime = createCellRuntime({
      store: current,
    });
    runtime.transact({
      id: 'open',
      restoreView: true,
      operations: openFrameOperations(
        runtime.store,
        'board',
        { store: { rootId: 'file', cells: { file, imported } } },
        (previous) => `next-${previous}`,
      ),
    });
    expect(runtime.store.rootId).toBe('board');
    expect(runtime.store.cells.board).toMatchObject({
      id: 'board',
      children: ['next-imported'],
      view: { theme: { boardBackground: '#dddddd' } },
    });
    expect(runtime.store.cells.kept).toBeUndefined();
    expect(runtime.store.cells['next-imported']).toMatchObject({
      kind: 'geometry',
    });
    runtime.undo();
    expect(runtime.store.cells.board).toMatchObject({
      children: ['kept'],
      view: { theme: { boardBackground: '#ffffff' } },
    });
    expect(runtime.store.cells.kept).toBeTruthy();
    runtime.redo();
    expect(runtime.store.cells.board).toMatchObject({
      children: ['next-imported'],
      view: { theme: { boardBackground: '#dddddd' } },
    });
  });
  it('replaces a locked object instead of leaving part of the old frame', () => {
    const board = createFrameCell('board');
    const locked: NodeCell = {
      id: 'locked',
      kind: 'geometry',
      cellType: 'node',
      locked: true,
      geometry: { x: 0, y: 0, width: 10, height: 10 },
    };
    board.children = ['locked'];
    const current = createCellStore(board);
    current.cells.locked = locked;
    const file = createFrameCell('file');
    file.view = { theme: { boardBackground: '#000000' } };
    const imported: NodeCell = {
      id: 'imported',
      kind: 'geometry',
      cellType: 'node',
      geometry: { x: 4, y: 4, width: 12, height: 12 },
    };
    file.children = ['imported'];
    const operations = openFrameOperations(
      current,
      'board',
      { store: { rootId: 'file', cells: { file, imported } } },
      (previous) => `next-${previous}`,
    );
    const runtime = createCellRuntime({ store: current });
    runtime.transact({ id: 'open-locked', restoreView: true, operations });
    expect(runtime.store.cells.locked).toBeUndefined();
    expect(runtime.store.cells.board).toMatchObject({
      children: ['next-imported'],
      view: { theme: { boardBackground: '#000000' } },
    });
  });
  it('rejects an invalid file before producing operations', () => {
    const board = createFrameCell('board');
    expect(() =>
      openFrameOperations(
        createCellStore(board),
        'board',
        { store: { rootId: 'missing', cells: {} } } as never,
        (previous) => previous,
      ),
    ).toThrow(/Invalid file/);
  });
});

it('opens a UML sequence by replacing its content while preserving its hidden root and undo history', async () => {
  const core = await import('@sue/board-core'),
    uml = await import('@sue/board-uml');
  const registry = core.createCellRegistry();
  uml.registerUmlCells(registry);
  let store = uml.createUmlSequenceFrameSnapshot('f', 'root').store;
  store = core.applyCellOperations(
    store,
    uml.addUmlCell(store, 'f', uml.createUmlParticipantCell('old')),
    registry,
  );
  let incoming = uml.createUmlSequenceFrameSnapshot(
    'incoming',
    'incoming-root',
  ).store;
  incoming = core.applyCellOperations(
    incoming,
    uml.addUmlCell(incoming, 'incoming', uml.createUmlParticipantCell('new')),
    registry,
  );
  const runtime = core.createCellRuntime({ store }, registry);
  let n = 0;
  runtime.transact({
    id: 'open-uml',
    operations: openFrameOperations(
      store,
      'f',
      { store: incoming },
      () => `copied:${n++}`,
      registry,
    ),
  });
  expect(runtime.store.cells.old).toBeUndefined();
  expect(runtime.store.cells.root).toBeDefined();
  expect(
    Object.values(runtime.store.cells).filter(
      (c) => c.kind === 'uml-sequence-root',
    ),
  ).toHaveLength(1);
  expect(core.validateCellStore(runtime.store, registry)).toEqual([]);
  runtime.undo();
  expect(runtime.store).toEqual(store);
});
