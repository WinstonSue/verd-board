import { expect, it } from 'vitest';
import { runOperations } from './operations';
import type { AuthoringOperation } from './types';

it('authors independent layer relationships, explicitly unowned modules and block-text cards', () => {
  const operations: AuthoringOperation[] = [
    {
      type: 'file.create',
      kind: 'architecture',
      id: 'arch',
      title: 'Architecture',
      path: 'arch.verd.json',
    },
    {
      type: 'node.upsert',
      fileId: 'arch',
      id: 'b',
      kind: 'architecture-layer',
    },
    {
      type: 'node.upsert',
      fileId: 'arch',
      id: 'm',
      kind: 'architecture-module',
    },
    { type: 'relation.move', fileId: 'arch', id: 'm', parentId: 'arch' },
    {
      type: 'node.upsert',
      fileId: 'arch',
      id: 'note',
      kind: 'card',
      label: 'Title\nDescription',
    },
    {
      type: 'edge.upsert',
      fileId: 'arch',
      id: 'dependency',
      sourceId: 'arch:root',
      targetId: 'b',
    },
    {
      type: 'edge.upsert',
      fileId: 'arch',
      id: 'flow',
      sourceId: 'b',
      targetId: 'arch:root',
      relation: 'flow',
      label: 'Events',
    },
  ];
  const { entries } = runOperations([], operations);
  const file = entries[0].file;
  if (file.format !== 'verd-frame') throw new Error('Missing diagram');
  expect(file.cells.dependency).toMatchObject({
    data: { relation: 'dependency' },
  });
  expect(file.cells.flow).toMatchObject({ data: { relation: 'flow' } });
  expect(file.cells.note).toMatchObject({
    content: { text: { kind: 'block', plainText: 'Title\nDescription' } },
  });
  expect(
    Object.values(file.cells)
      .filter((c) => c.kind === 'architecture-layer')
      .every(
        (c) =>
          !(c as { data: { memberIds: string[] } }).data.memberIds.includes(
            'm',
          ),
      ),
  ).toBe(true);
  const legacy = structuredClone(entries);
  delete (legacy[0].file as typeof file).cells.dependency.data;
  const updated = runOperations(legacy, [
    {
      type: 'edge.upsert',
      fileId: 'arch',
      id: 'dependency',
      sourceId: 'arch:root',
      targetId: 'b',
      label: 'Shared capability',
    },
  ]);
  expect(
    (updated.entries[0].file as typeof file).cells.dependency.data,
  ).toBeUndefined();
});
