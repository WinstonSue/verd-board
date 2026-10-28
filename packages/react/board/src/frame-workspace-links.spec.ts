import { expect, it } from 'vitest';
import {
  copyCellFragment,
  createFrameCell,
  planCellPaste,
  type CellStore,
  type NodeCell,
} from '@sue/board-core';
import { createInlineText, parseWorkspaceLink } from '@sue/board-common';
import { createTestFramePluginSet } from '../../../../tests/fixtures/plugins/ui';

it('uses explicit owning files when clipboard stores assemble several workspace files', () => {
  const registry = createTestFramePluginSet().registry;
  const text = createInlineText('target');
  text.content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'target',
            marks: [{ type: 'link', attrs: { href: '#cell%3Atarget' } }],
          },
        ],
      },
    ],
  };
  const node = (id: string): NodeCell => ({
    id,
    kind: 'geometry',
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 100, height: 40 },
  });
  const store: CellStore = {
    rootId: 'assembly',
    cells: {
      assembly: createFrameCell('assembly'),
      b: { ...createFrameCell('b'), children: ['carrier', 'target'] },
      c: { ...createFrameCell('c'), children: ['nested'] },
      nested: createFrameCell('nested'),
      target: node('target'),
      carrier: { ...node('carrier'), content: { text } },
    },
  };
  const linkOf = (ids: string[]) => {
    const fragment = copyCellFragment(store, ids, registry, { fileId: 'b' });
    const plan = planCellPaste({
      store,
      fileId: 'c',
      frameId: 'nested',
      selectionIds: [],
      fragment,
      allocateId: (id) => `copy-${id}`,
      registry,
    });
    const inserted = plan.operations.find(
      (op) => op.type === 'insert_cell' && op.cell.id === 'copy-carrier',
    );
    expect(inserted?.type).toBe('insert_cell');
    return parseWorkspaceLink(
      (inserted as Extract<typeof inserted, { type: 'insert_cell' }>).cell
        .cellType === 'node'
        ? (((inserted as { cell: NodeCell }).cell.content!.text as typeof text)
            .content.content![0].content![0].marks![0].attrs!.href as string)
        : '',
    );
  };
  expect(linkOf(['carrier'])).toEqual({
    kind: 'cell',
    fileId: 'b',
    cellId: 'target',
  });
  expect(linkOf(['carrier', 'target'])).toEqual({
    kind: 'cell',
    fileId: 'c',
    cellId: 'copy-target',
  });
});
