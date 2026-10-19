import { it, expect } from 'vitest';
import {
  applyCellOperations,
  createCellRegistry,
  validateCellStore,
  type NodeCell,
  type UmlSequenceData,
} from '@sue/board-core';
import {
  createUmlSequenceFrameSnapshot,
  createUmlParticipantCell,
  createUmlMessageCell,
  addUmlCell,
  addUmlActivation,
  registerUmlCells,
} from '@sue/board-uml';
import {
  partitionCellStore,
  remapFrameFileIds,
  assembleWorkspaceStore,
  remapImportedFiles,
} from './frame-files';
it('remaps all UML identities in independent file copies and collision imports', () => {
  const registry = createCellRegistry();
  registerUmlCells(registry);
  let store = createUmlSequenceFrameSnapshot('f', 'root').store;
  for (const id of ['a', 'b'])
    store = applyCellOperations(
      store,
      addUmlCell(store, 'f', createUmlParticipantCell(id)),
      registry,
    );
  store = applyCellOperations(
    store,
    addUmlCell(store, 'f', createUmlMessageCell('m', 'a', 'b')),
    registry,
  );
  let n = 0;
  store = applyCellOperations(
    store,
    addUmlActivation(store, 'f', 'b', 0, 1, () => `event${n++}`),
    registry,
  );
  const file = partitionCellStore(store).files[0],
    mapping = new Map(Object.keys(store.cells).map((id) => [id, `copy:${id}`]));
  const copy = remapFrameFileIds(file, mapping),
    assembled = assembleWorkspaceStore([file, copy], registry);
  expect(assembled.diagnostics).toEqual([]);
  expect(validateCellStore(assembled.store, registry)).toEqual([]);
  const root = copy.cells['copy:root'] as NodeCell<UmlSequenceData>;
  expect(root.data!.participantIds).toEqual(['copy:a', 'copy:b']);
  expect(root.data!.events).toContainEqual({ type: 'cell', cellId: 'copy:m' });
  expect(root.data!.events.find((e) => e.type === 'activate')).toMatchObject({
    participantId: 'copy:b',
  });
  expect(
    root.data!.events.find((e) => e.type === 'activate'),
  ).not.toMatchObject({ id: 'event0' });
  const collisions = remapImportedFiles(
    [file],
    (id) => !!store.cells[id],
    () => `import:${n++}`,
  );
  expect(assembleWorkspaceStore(collisions, registry).diagnostics).toEqual([]);
});
