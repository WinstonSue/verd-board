import {
  createBlockText,
  createWorkspaceLink,
  parseWorkspaceLink,
  type BoardTextDocument,
} from '@sue/board-common';
import {
  applyCellOperations,
  copyCellFragment,
  createCellStore,
  createFrameCell,
  pasteCellFragment,
  planCellPaste,
  type Cell,
  type NodeCell,
} from '@sue/board-core';
import {
  createGeometryCell,
  createTableCell,
  type TableCellData,
} from '@sue/board-draw';
import { createMindRootCell } from '@sue/board-mind';
import {
  addUmlCell,
  createUmlClassCell,
  createUmlClassFrameSnapshot,
} from '@sue/board-uml';
import { describe, expect, it } from 'vitest';
import { createFrameFile } from '@sue/verd-board-workspace';
import { createWorkspaceCellRegistry } from '@sue/verd-board-workspace';
import { createDocumentFile } from '@sue/verd-board-workspace';
import { remapWorkspaceFiles } from '@sue/verd-board-workspace';

const link = (fileId: string, cellId: string) =>
  createWorkspaceLink({ kind: 'cell', fileId, cellId });
const text = (href: string): BoardTextDocument => {
  const value = createBlockText('target');
  value.content.content![0].content![0].marks = [
    { type: 'link', attrs: { href } },
  ];
  return value;
};
const href = (value: unknown) =>
  (value as BoardTextDocument).content.content![0].content![0].marks![0].attrs![
    'href'
  ] as string;
const attachText = <T extends NodeCell>(
  cell: T,
  value: BoardTextDocument,
): T => ({ ...cell, content: { ...cell.content, text: value } });

describe('workspace link identity remapping', () => {
  it('maps every explicit rich-text slot once, including frame titles, table entries, notes and edge labels', () => {
    const file = createFrameFile(createFrameCell('source'));
    file.frame.content = { text: text(link('old-hint', 'target')) };
    const target = createGeometryCell('target', 'rectangle', [[0, 0]]);
    const table = createTableCell('table', [[0, 0]]);
    (table.data as TableCellData).cells[0].text = text(
      link('source', 'target'),
    );
    const note = createMindRootCell('note');
    note.data = {
      ...(note.data as object),
      note: text(link('source', 'target')),
    };
    const edge: Cell = {
      id: 'edge',
      kind: 'arrow',
      cellType: 'edge',
      source: { cellId: 'target' },
      target: { point: [100, 100] },
      route: { mode: 'auto' },
      labels: [{ text: 'target', richText: text(link('source', 'target')) }],
    };
    for (const cell of [target, table, note, edge]) {
      file.cells[cell.id] = cell;
      file.frame.children.push(cell.id);
    }
    const doc = createDocumentFile('doc');
    doc.text = text(link('stale-file-hint', 'target'));
    doc.text.content.content!.push({
      type: 'codeBlock',
      content: [
        {
          type: 'text',
          text: 'literal',
          marks: [{ type: 'link', attrs: { href: link('source', 'target') } }],
        },
      ],
    });
    let seq = 0;
    const { files, idMap } = remapWorkspaceFiles(
      [file, doc],
      () => false,
      () => `copy-${++seq}`,
      { rootId: 'source' },
    );
    const copied = files[0];
    if (copied.format !== 'verd-frame' || files[1].format !== 'verd-document')
      throw new Error();
    const expected = {
      kind: 'cell',
      fileId: idMap.get('source'),
      cellId: idMap.get('target'),
    };
    const tableCopy = copied.cells[
      idMap.get('table')!
    ] as NodeCell<TableCellData>;
    const noteCopy = copied.cells[idMap.get('note')!] as NodeCell<{
      note: unknown;
    }>;
    const edgeCopy = copied.cells[idMap.get('edge')!];
    if (edgeCopy.cellType !== 'edge') throw new Error();
    for (const value of [
      copied.frame.content?.text,
      tableCopy.data!.cells[0].text,
      noteCopy.data!.note,
      edgeCopy.labels![0].richText,
      files[1].text,
    ])
      expect(parseWorkspaceLink(href(value))).toEqual(expected);
    expect(
      files[1].text.content.content![1].content![0].marks![0].attrs!['href'],
    ).toBe(link('source', 'target'));
    expect(href(file.frame.content.text)).toBe(link('old-hint', 'target'));
  });

  it('rewrites a colliding cell identity even when its file identity stays stable', () => {
    const file = createFrameFile(createFrameCell('source'));
    file.frame.children = ['target'];
    file.cells.target = attachText(
      createGeometryCell('target', 'rectangle', [[0, 0]]),
      text(link('source', 'target')),
    );
    const { files } = remapWorkspaceFiles(
      [file],
      (id) => id === 'target',
      () => 'new-target',
    );
    const copied = files[0];
    if (copied.format !== 'verd-frame') throw new Error();
    expect(
      parseWorkspaceLink(
        href((copied.cells['new-target'] as NodeCell).content?.text),
      ),
    ).toEqual({ kind: 'cell', fileId: 'source', cellId: 'new-target' });
  });

  it('pastes copied targets into their new owner and keeps targets outside the fragment at the original source', () => {
    const registry = createWorkspaceCellRegistry();
    let store = createCellStore(createFrameCell('source'));
    const a = attachText(
      createGeometryCell('a', 'rectangle', [[0, 0]]),
      text(link('source', 'b')),
    );
    const b = attachText(
      createGeometryCell('b', 'rectangle', [[0, 0]]),
      text('#cell%3Aoutside'),
    );
    store = applyCellOperations(
      store,
      [a, b].map((cell) => ({ type: 'insert_cell', parentId: 'source', cell })),
      registry,
    );
    const fragment = copyCellFragment(store, ['a', 'b'], registry);
    const operations = pasteCellFragment(
      fragment,
      'destination',
      (id) => `new-${id}`,
      [0, 0],
      undefined,
      undefined,
      registry,
    );
    const copied = operations.flatMap((op) =>
      op.type === 'insert_cell' ? [op.cell as NodeCell] : [],
    );
    expect(
      parseWorkspaceLink(
        href(copied.find((cell) => cell.id === 'new-a')!.content?.text),
      ),
    ).toEqual({ kind: 'cell', fileId: 'destination', cellId: 'new-b' });
    expect(
      parseWorkspaceLink(
        href(copied.find((cell) => cell.id === 'new-b')!.content?.text),
      ),
    ).toEqual({ kind: 'cell', fileId: 'source', cellId: 'outside' });
    const plan = planCellPaste({
      store,
      frameId: 'source',
      fragment,
      selectionIds: [],
      allocateId: (id) => `again-${id}`,
      registry,
    });
    const inserted = plan.operations.find(
      (op) => op.type === 'insert_cell' && op.cell.id === 'again-a',
    );
    if (inserted?.type !== 'insert_cell') throw new Error();
    expect(
      parseWorkspaceLink(href((inserted.cell as NodeCell).content?.text)),
    ).toEqual({ kind: 'cell', fileId: 'source', cellId: 'again-b' });
  });

  it('finalizes custom UML paste plans without rewriting existing owner text', () => {
    const registry = createWorkspaceCellRegistry();
    let store = createUmlClassFrameSnapshot('uml-file', 'uml-root').store;
    for (const id of ['a', 'b'])
      store = applyCellOperations(
        store,
        addUmlCell(
          store,
          'uml-file',
          attachText(createUmlClassCell(id), text(link('uml-file', 'b'))),
        ),
        registry,
      );
    const fragment = copyCellFragment(store, ['a', 'b'], registry);
    const plan = planCellPaste({
      store,
      frameId: 'uml-file',
      fragment,
      selectionIds: [],
      allocateId: (id) => `new-${id}`,
      registry,
    });
    const cell = plan.operations.find(
      (op) => op.type === 'insert_cell' && op.cell.id === 'new-a',
    );
    if (cell?.type !== 'insert_cell') throw new Error();
    expect(
      parseWorkspaceLink(href((cell.cell as NodeCell).content?.text)),
    ).toEqual({ kind: 'cell', fileId: 'uml-file', cellId: 'new-b' });
    expect(href((store.cells.a as NodeCell).content?.text)).toBe(
      link('uml-file', 'b'),
    );
  });
});
