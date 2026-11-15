import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect } from 'vitest';
import { createWebWorkspaceHost } from '../host/web-workspace-host';
import { createDocumentFile } from '@sue/verd-board-workspace';
import { openWorkspaceSession } from '@sue/verd-board-workspace';
import { extractSearchRecord, searchRecords } from './search';
import {
  readOrganization,
  remapOrganization,
  topLevelPaths,
} from '@sue/verd-board-workspace';
const doc = (id: string, text = '知识管理') => {
  const file = createDocumentFile(id, id);
  file.text.content = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
  file.text.plainText = text;
  return file;
};
const ordinaryBytes = new Uint8Array([0, 255, 10, 195, 40]);
async function setup() {
  const host = createWebWorkspaceHost({
    indexedDB: new IDBFactory(),
    dbName: crypto.randomUUID(),
  });
  const handle = (await host.openWorkspace({ path: 'project' }))!;
  await host.commit(handle, {
    transactionId: 'seed',
    mkdirs: ['a', 'a/empty', 'target'],
    writes: [
      {
        path: 'a/one.verd-doc.json',
        content: JSON.stringify(doc('one')),
        expectedVersion: null,
      },
      {
        path: 'two.verd-doc.json',
        content: JSON.stringify(doc('two')),
        expectedVersion: null,
      },
      { path: 'a/raw.bin', content: ordinaryBytes, expectedVersion: null },
      { path: 'a/bad.verd-doc.json', content: 'broken', expectedVersion: null },
    ],
  });
  return {
    host,
    handle,
    session: await openWorkspaceSession(host, handle, { autoSaveDelay: 60000 }),
  };
}
describe('workspace organization', () => {
  it('keeps stable favorites and remaps directory references', () => {
    const value = {
      navigation: {
        favorites: ['one'],
        sort: 'manual',
        order: { a: ['file:one', 'path:a/empty'] },
      },
    };
    expect(
      readOrganization(remapOrganization(value, [{ from: 'a', to: 'b' }]))
        .order,
    ).toEqual({ b: ['file:one', 'path:b/empty'] });
    expect(topLevelPaths(['a', 'a/empty', 'a', 'b'])).toEqual(['a', 'b']);
  });
  it('moves whole directories and mixed selections with one undo/redo', async () => {
    const { host, handle, session } = await setup();
    try {
      expect(
        (
          await session.apply({
            type: 'organize-entries',
            moves: [
              { from: 'a', to: 'target/a' },
              { from: 'a/empty', to: 'target/empty' },
              { from: 'two.verd-doc.json', to: 'target/two.verd-doc.json' },
            ],
          })
        ).ok,
      ).toBe(true);
      let snapshot = await host.readSnapshot(handle);
      expect(snapshot.entries.map((e) => e.path)).toContain('target/a/raw.bin');
      expect((await host.readFile(handle, 'target/a/raw.bin')).content).toEqual(
        ordinaryBytes,
      );
      expect(snapshot.entries.map((e) => e.path)).toContain('target/a/empty');
      expect(snapshot.entries.map((e) => e.path)).toContain(
        'target/a/bad.verd-doc.json',
      );
      expect((await session.undo()).ok).toBe(true);
      snapshot = await host.readSnapshot(handle);
      expect(snapshot.entries.map((e) => e.path)).toContain('a/raw.bin');
      expect((await host.readFile(handle, 'a/raw.bin')).content).toEqual(
        ordinaryBytes,
      );
      expect(snapshot.entries.map((e) => e.path)).toContain(
        'two.verd-doc.json',
      );
      expect((await session.redo()).ok).toBe(true);
    } finally {
      session.dispose();
    }
  });
  it('rejects every move when a target is occupied', async () => {
    const { host, handle, session } = await setup();
    try {
      expect(
        (
          await session.apply({
            type: 'organize-entries',
            moves: [
              { from: 'a', to: 'target/a' },
              { from: 'two.verd-doc.json', to: 'target' },
            ],
          })
        ).ok,
      ).toBe(false);
      expect(
        (await host.readSnapshot(handle)).entries.map((e) => e.path),
      ).toContain('a/raw.bin');
    } finally {
      session.dispose();
    }
  });
  it('trashes mixed selections and restores everything in one step', async () => {
    const { host, handle, session } = await setup();
    try {
      expect(
        (
          await session.apply({
            type: 'organize-entries',
            trashPaths: ['a', 'a/empty', 'two.verd-doc.json'],
          })
        ).ok,
      ).toBe(true);
      expect((await host.readSnapshot(handle)).trash).toHaveLength(2);
      expect((await session.undo()).ok).toBe(true);
      expect(
        (await host.readSnapshot(handle)).entries.map((e) => e.path),
      ).toContain('a/raw.bin');
      expect((await host.readFile(handle, 'a/raw.bin')).content).toEqual(
        ordinaryBytes,
      );
      expect((await session.redo()).ok).toBe(true);
    } finally {
      session.dispose();
    }
  });
  it('creates, pins and hides web workspace records without removing data', async () => {
    const { host, handle, session } = await setup();
    try {
      const created = (await host.createWorkspace!({ name: 'Notes' }))!;
      await host.activateWorkspace!(created);
      await host.updateWorkspaceHistory!({
        id: handle.historyId!,
        pinned: true,
      });
      expect(
        (await host.listWorkspaceHistory!()).find(
          (h) => h.id === handle.historyId,
        )?.pinned,
      ).toBe(true);
      await host.updateWorkspaceHistory!({
        id: handle.historyId!,
        remove: true,
      });
      expect(
        (await host.listWorkspaceHistory!()).some(
          (h) => h.id === handle.historyId,
        ),
      ).toBe(false);
      expect((await host.readSnapshot(handle)).documents).toHaveLength(3);
    } finally {
      session.dispose();
    }
  });
});
describe('workspace full text search', () => {
  it('matches Chinese substrings, case-insensitive English and file-wide AND', () => {
    const record = extractSearchRecord(
      doc('one', '知识管理 Hello'),
      'notes/one.verd-doc.json',
    );
    expect(searchRecords([record], '管理 HELLO')).toHaveLength(1);
    expect(searchRecords([record], '管理 missing')).toHaveLength(0);
    expect(searchRecords([record], '管理', true)).toHaveLength(0);
    expect(searchRecords([record], 'notes', true)).toHaveLength(1);
  });
  it('retains different positions for repeated text blocks', () => {
    const file = doc('one', '重复');
    file.text.content.content!.push({
      type: 'paragraph',
      content: [{ type: 'text', text: '重复' }],
    });
    const hits = searchRecords([extractSearchRecord(file, 'one')], '重复');
    expect(hits.map((h) => h.fragment.from)).toEqual([1, 5]);
  });
  it('keeps queries responsive at the agreed reference size', () => {
    const records = Array.from({ length: 1000 }, (_, i) =>
      extractSearchRecord(
        doc(String(i), '知识管理 architecture '.repeat(1000)),
        `notes/${i}`,
      ),
    );
    const graph = {
      format: 'verd-frame',
      version: 2,
      frame: { id: 'diagram', name: 'Diagram' },
      cells: Object.fromEntries(
        Array.from({ length: 10000 }, (_, i) => [
          String(i),
          {
            id: String(i),
            name: 'Node ' + i,
            content: { label: 'diagram label ' + i },
          },
        ]),
      ),
    } as unknown as import('@sue/verd-board-workspace').FrameFileV2;
    records.push(extractSearchRecord(graph, 'diagram.verd.json'));
    const timings = Array.from({ length: 10 }, () => {
      const start = performance.now();
      expect(searchRecords(records, '管理 architecture')).toHaveLength(1000);
      return performance.now() - start;
    }).sort((a, b) => a - b);
    const p95 = timings[Math.ceil(timings.length * 0.95) - 1];
    console.info(
      'workspace search benchmark',
      JSON.stringify({
        files: records.length,
        diagramNodes: 10000,
        p95Ms: Math.round(p95 * 100) / 100,
      }),
    );
    expect(p95).toBeLessThan(200);
  });
});

it('indexes visible diagram text and fields without expanding reference addresses', () => {
  const file = {
    format: 'verd-frame',
    version: 2,
    frame: { id: 'board', name: 'Board' },
    cells: {
      node: {
        id: 'node',
        name: '节点',
        data: {
          attributes: [{ name: 'customer', type: 'string' }],
          methods: [{ name: 'save' }],
          operands: [{ guard: 'ready' }],
        },
        content: {
          text: {
            content: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '正文' }],
                },
              ],
            },
          },
        },
      },
      hidden: { id: 'hidden', hidden: true, name: 'secret' },
      reference: { id: 'reference', data: { targetFrameId: 'internal-id' } },
    },
  } as unknown as import('@sue/verd-board-workspace').FrameFileV2;
  const record = extractSearchRecord(file, 'board.verd.json');
  expect(searchRecords([record], 'customer ready')[0].fragment.cellId).toBe(
    'node',
  );
  expect(searchRecords([record], 'secret')).toHaveLength(0);
  expect(searchRecords([record], 'internal-id')).toHaveLength(0);
});
it('maintains precise positions around marks, tables and inline atoms', () => {
  const file = doc('one');
  file.text.content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'ab', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'cd' },
          { type: 'hardBreak' },
          { type: 'text', text: 'ef' },
        ],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: '表格' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const record = extractSearchRecord(file, 'one');
  expect(searchRecords([record], 'bc')[0].fragment.from).toBe(1);
  expect(searchRecords([record], 'de')).toHaveLength(0);
  expect(searchRecords([record], '表格')[0].fragment.from).toBe(13);
});

it('moves newly created dirty files after flushing their actual versions', async () => {
  const { host, handle, session } = await setup();
  try {
    expect(
      (
        await session.apply({
          type: 'create-file',
          file: doc('new'),
          path: 'new.verd-doc.json',
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await session.apply({
          type: 'organize-entries',
          moves: [
            { from: 'new.verd-doc.json', to: 'target/new.verd-doc.json' },
          ],
        })
      ).ok,
    ).toBe(true);
    expect(
      (await host.readSnapshot(handle)).entries.map((e) => e.path),
    ).toContain('target/new.verd-doc.json');
  } finally {
    session.dispose();
  }
});

it('purging batch trash removes histories that could recreate purged files', async () => {
  const { host, handle, session } = await setup();
  try {
    await session.apply({
      type: 'create-file',
      file: doc('new'),
      path: 'new.verd-doc.json',
    });
    expect(
      (
        await session.apply({
          type: 'organize-entries',
          trashPaths: ['new.verd-doc.json'],
        })
      ).ok,
    ).toBe(true);
    const trash = (await host.readSnapshot(handle)).trash;
    expect(
      (
        await session.apply({
          type: 'purge-trash',
          entryIds: trash.map((t) => t.entryId),
        })
      ).ok,
    ).toBe(true);
    expect(session.getState().canUndo).toBe(false);
  } finally {
    session.dispose();
  }
});

it('retains the exact transaction after an indeterminate publication and retries without duplicating moves', async () => {
  const { host, handle, session: original } = await setup();
  original.dispose();
  const commit = host.commit.bind(host);
  const transactions: string[] = [];
  let unknown = true;
  host.commit = async (handle, request) => {
    if (request.transactionId.endsWith('-organize')) {
      transactions.push(request.transactionId);
      const receipt = await commit(handle, request);
      if (unknown) {
        unknown = false;
        return {
          transactionId: request.transactionId,
          outcome: 'rejected',
          reason: 'io-error',
        };
      }
      return receipt;
    }
    return commit(handle, request);
  };
  const session = await openWorkspaceSession(host, handle, {
    autoSaveDelay: 60000,
  });
  try {
    expect(
      (
        await session.apply({
          type: 'organize-entries',
          moves: [{ from: 'a', to: 'target/a' }],
        })
      ).ok,
    ).toBe(false);
    expect(session.getState().trashUnconfirmed).toBe(true);
    expect(
      (await session.apply({ type: 'create-file', file: doc('blocked') })).ok,
    ).toBe(false);
    expect((await session.retryTrashOperation()).ok).toBe(true);
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toBe(transactions[1]);
    expect(
      (await host.readSnapshot(handle)).entries.map((e) => e.path),
    ).toContain('target/a/raw.bin');
    expect((await session.undo()).ok).toBe(true);
  } finally {
    session.dispose();
  }
});

it('undoing a move preserves favorites added after the move', async () => {
  const { session } = await setup();
  try {
    await session.apply({
      type: 'organize-entries',
      moves: [{ from: 'a', to: 'target/a' }],
    });
    session.setWorkspaceConfig({
      ...session.getState().config.value,
      navigation: { favorites: ['one'], sort: 'manual', order: {} },
    });
    expect((await session.undo()).ok).toBe(true);
    expect(readOrganization(session.getState().config.value).favorites).toEqual(
      ['one'],
    );
  } finally {
    session.dispose();
  }
});
