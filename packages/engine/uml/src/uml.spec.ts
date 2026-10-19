import { describe, it, expect } from 'vitest';
import {
  edgeLabelLayout,
  applyCellOperations,
  createCellRegistry,
  createCellRuntime,
  validateCellStore,
  copyCellFragment,
  planCellPaste,
  clearFrameCells,
  groupCells,
  umlRoot,
  type NodeCell,
  type UmlSequenceData,
  type UmlFragmentData,
} from '@sue/board-core';
import {
  createUmlClassFrameSnapshot,
  createUmlSequenceFrameSnapshot,
  createUmlClassCell,
  createUmlParticipantCell,
  createUmlMessageCell,
  createUmlFragmentCell,
  createUmlNoteCell,
  createUmlRelationCell,
  addUmlCell,
  addUmlActivation,
  moveUmlEvent,
  registerUmlCells,
  layoutUmlSequence,
} from './public-api';
const registry = () => {
  const r = createCellRegistry();
  registerUmlCells(r);
  return r;
};
const sequence = () => {
  const r = registry();
  let store = createUmlSequenceFrameSnapshot('f', 'root').store;
  for (const id of ['a', 'b'])
    store = applyCellOperations(
      store,
      addUmlCell(store, 'f', createUmlParticipantCell(id)),
      r,
    );
  return { store, r };
};
describe('native UML domains', () => {
  it('keeps empty scene identity, isolates scenes and supports all six relations', () => {
    const r = registry();
    let store = createUmlClassFrameSnapshot('f', 'root').store;
    for (const id of ['a', 'b'])
      store = applyCellOperations(
        store,
        addUmlCell(store, 'f', createUmlClassCell(id)),
        r,
      );
    for (const relation of [
      'association',
      'dependency',
      'generalization',
      'realization',
      'aggregation',
      'composition',
    ] as const)
      store = applyCellOperations(
        store,
        addUmlCell(
          store,
          'f',
          createUmlRelationCell(relation, 'a', 'b', relation),
        ),
        r,
      );
    expect(validateCellStore(store, r)).toEqual([]);
    expect(() =>
      applyCellOperations(
        store,
        [
          {
            type: 'insert_cell',
            parentId: 'f',
            cell: createUmlParticipantCell('p'),
          },
        ],
        r,
      ),
    ).toThrow();
    store = applyCellOperations(store, clearFrameCells(store, 'f'), r);
    expect(Object.keys(store.cells).sort()).toEqual(['f', 'root']);
    expect(() =>
      applyCellOperations(store, [{ type: 'remove_cell', cellId: 'root' }], r),
    ).toThrow('last scene anchor');
  });
  it('derives self calls, nested fragments and paired activations without mutating the snapshot', () => {
    let { store, r } = sequence();
    store = applyCellOperations(
      store,
      addUmlCell(store, 'f', createUmlFragmentCell('alt', 'alt')),
      r,
    );
    const branch = (store.cells.alt as NodeCell<UmlFragmentData>).data!
      .operands[0].id;
    store = applyCellOperations(
      store,
      addUmlCell(store, 'f', createUmlFragmentCell('loop', 'loop'), branch),
      r,
    );
    const inner = (store.cells.loop as NodeCell<UmlFragmentData>).data!
      .operands[0].id;
    store = applyCellOperations(
      store,
      addUmlCell(store, 'f', createUmlMessageCell('m', 'a', 'a'), inner),
      r,
    );
    store = applyCellOperations(
      store,
      addUmlActivation(
        store,
        'f',
        'a',
        0,
        1,
        (() => {
          let i = 0;
          return () => `e${i++}`;
        })(),
      ),
      r,
    );
    const before = JSON.stringify(store),
      layout = layoutUmlSequence(store, 'f');
    expect(layout.edges.get('m')!.route).toMatchObject({
      mode: 'fixed',
      points: expect.any(Array),
    });
    expect(
      (layout.edges.get('m')!.route as { points: unknown[] }).points,
    ).toHaveLength(4);
    expect(layout.activations).toHaveLength(1);
    expect(layout.geometry.has('loop')).toBe(true);
    expect(JSON.stringify(store)).toBe(before);
    expect(() =>
      applyCellOperations(store, moveUmlEvent(store, 'f', 'alt', inner), r),
    ).toThrow();
  });
  it('rejects orphan/duplicate events and invalid activation scopes', () => {
    const { store, r } = sequence();
    const root = store.cells.root as NodeCell<UmlSequenceData>;
    expect(() =>
      applyCellOperations(
        store,
        [
          {
            type: 'insert_cell',
            parentId: 'f',
            cell: createUmlMessageCell('m', 'a', 'b'),
          },
        ],
        r,
      ),
    ).toThrow('Orphan');
    expect(() =>
      applyCellOperations(
        store,
        [
          {
            type: 'replace_cell',
            cell: {
              ...root,
              data: {
                ...root.data!,
                events: [{ type: 'deactivate', id: 'bad', participantId: 'a' }],
              },
            },
          },
        ],
        r,
      ),
    ).toThrow('Unpaired');
  });
  it('cascades fragment subtrees and participant references with one reversible transaction', () => {
    let { store, r } = sequence();
    store = applyCellOperations(
      store,
      addUmlCell(store, 'f', createUmlFragmentCell('loop', 'loop')),
      r,
    );
    const branch = (store.cells.loop as NodeCell<UmlFragmentData>).data!
      .operands[0].id;
    store = applyCellOperations(
      store,
      addUmlCell(store, 'f', createUmlMessageCell('m', 'a', 'b'), branch),
      r,
    );
    store = applyCellOperations(
      store,
      addUmlCell(store, 'f', createUmlNoteCell('n', ['a', 'b']), branch),
      r,
    );
    const runtime = createCellRuntime({ store }, r);
    runtime.transact({
      id: 'delete',
      operations: [{ type: 'remove_cell', cellId: 'loop' }],
    });
    expect(runtime.store.cells.m).toBeUndefined();
    expect(runtime.store.cells.n).toBeUndefined();
    expect(runtime.store.cells.a).toBeDefined();
    runtime.undo();
    expect(runtime.store).toEqual(store);
    runtime.transact({
      id: 'participant',
      operations: [{ type: 'remove_cell', cellId: 'a' }],
    });
    expect(runtime.store.cells.m).toBeUndefined();
    expect(validateCellStore(runtime.store, r)).toEqual([]);
  });
  it('copies messages without duplicating same-diagram participants, and remaps across diagrams', () => {
    let { store, r } = sequence();
    store = applyCellOperations(
      store,
      addUmlCell(store, 'f', createUmlMessageCell('m', 'a', 'b')),
      r,
    );
    const fragment = copyCellFragment(store, ['m']);
    let i = 0;
    for (let n = 0; n < 2; n++)
      store = applyCellOperations(
        store,
        planCellPaste({
          store,
          frameId: 'f',
          selectionIds: [],
          fragment,
          allocateId: () => `copy${i++}`,
          registry: r,
        }).operations,
        r,
      );
    expect(
      (umlRoot(store, 'f')!.data as UmlSequenceData).participantIds,
    ).toEqual(['a', 'b']);
    expect((umlRoot(store, 'f')!.data as UmlSequenceData).events).toHaveLength(
      3,
    );
    let target = createUmlSequenceFrameSnapshot('target', 'target-root').store;
    target = applyCellOperations(
      target,
      planCellPaste({
        store: target,
        frameId: 'target',
        selectionIds: [],
        fragment,
        allocateId: () => `cross${i++}`,
        registry: r,
      }).operations,
      r,
    );
    expect(validateCellStore(target, r)).toEqual([]);
    expect(Object.keys(target.cells)).not.toContain('a');
    expect(
      (umlRoot(target, 'target')!.data as UmlSequenceData).participantIds,
    ).toHaveLength(2);
  });
});

it('aligns activation boundaries with call/return and keeps message labels clear of notes', () => {
  const r = registry();
  let store = createUmlSequenceFrameSnapshot('f', 'root').store;
  for (const id of ['a', 'b'])
    store = applyCellOperations(
      store,
      addUmlCell(store, 'f', createUmlParticipantCell(id)),
      r,
    );
  store = applyCellOperations(
    store,
    addUmlCell(store, 'f', createUmlMessageCell('call', 'a', 'b')),
    r,
  );
  store = applyCellOperations(
    store,
    addUmlCell(store, 'f', createUmlMessageCell('return', 'b', 'a', 'return')),
    r,
  );
  let i = 0;
  store = applyCellOperations(
    store,
    addUmlActivation(store, 'f', 'b', 1, 2, () => `activation:${i++}`),
    r,
  );
  const layout = layoutUmlSequence(store, 'f');
  expect(layout.activations[0].y).toBe(layout.rows.get('call'));
  expect(layout.activations[0].y + layout.activations[0].height).toBe(
    layout.rows.get('return'),
  );
  store = applyCellOperations(
    store,
    addUmlCell(store, 'f', createUmlNoteCell('note', ['a'])),
    r,
  );
  store = applyCellOperations(
    store,
    addUmlCell(store, 'f', createUmlMessageCell('after-note', 'a', 'b')),
    r,
  );
  const after = layoutUmlSequence(store, 'f'),
    note = after.geometry.get('note')!,
    edge = after.edges.get('after-note')!;
  const points = 'points' in edge.route ? edge.route.points! : [];
  expect(edgeLabelLayout(edge, 0, points).bounds.y).toBeGreaterThan(
    note.y + note.height,
  );
});
