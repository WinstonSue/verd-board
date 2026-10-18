import { describe, expect, it, vi } from 'vitest';
import type { CellStore, FrameCell, FrameReferenceCell } from '@sue/board-core';
import { WORKSPACE_ROOT_ID, type FrameFileV2 } from '../frames/frame-files';
import { createDocumentFile } from '../documents/document-files';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import type {
  CommitRequest,
  WorkspaceHost,
  WorkspaceHostSnapshot,
} from '../host/workspace-host';
import {
  openWorkspaceSession,
  type WorkspaceSession,
} from './workspace-session';

const frameCell = (id: string, name = id): FrameCell =>
  ({
    id,
    kind: 'frame',
    cellType: 'frame',
    name,
    geometry: { x: 0, y: 0, width: 960, height: 640 },
    children: [],
    groups: [],
  }) as FrameCell;

const fileFor = (id: string, name = id): FrameFileV2 => ({
  format: 'verd-frame',
  version: 2,
  frame: frameCell(id, name),
  cells: {},
});

const withCells = (file: FrameFileV2, cells: FrameFileV2['cells']) => ({
  ...file,
  cells,
});

const refCell = (id: string, targetFrameId: string): FrameReferenceCell => ({
  id,
  kind: 'frame-reference',
  cellType: 'node',
  geometry: { x: 0, y: 0, width: 200, height: 120 },
  data: { targetFrameId },
});

/** File whose root owns one reference instance `refId -> targetId`. */
const withRef = (file: FrameFileV2, refId: string, targetId: string) => ({
  ...file,
  frame: { ...file.frame, children: [refId] },
  cells: { [refId]: refCell(refId, targetId) },
});

const workspaceStore = (...frames: FrameCell[]): CellStore => ({
  rootId: WORKSPACE_ROOT_ID,
  cells: Object.fromEntries([
    ...frames.map((frame) => [frame.id, frame] as const),
    [
      WORKSPACE_ROOT_ID,
      {
        ...frameCell(WORKSPACE_ROOT_ID),
        children: frames.map((frame) => frame.id),
      },
    ],
  ]),
});

const fileJson = (id: string, name = id) => JSON.stringify(fileFor(id, name));

/** Records commit requests while delegating to a real memory host. */
const spyHost = (inner: WorkspaceHost) => {
  const commits: CommitRequest[] = [];
  const host: WorkspaceHost = {
    ...inner,
    commit: async (handle, request) => {
      commits.push(request);
      return inner.commit(handle, request);
    },
  };
  return { host, commits };
};

const openSession = async (options?: {
  host?: WorkspaceHost;
  seed?: (snapshot: WorkspaceHostSnapshot) => void;
}) => {
  const inner = createMemoryWorkspaceHost({ now: () => 1_700_000_000_000 });
  const { host, commits } = spyHost(options?.host ?? inner);
  const handle = (await host.openWorkspace({ path: `ws-${Math.random()}` }))!;
  return { host, commits, handle };
};

const sessionOf = async (options?: { delayMs?: number }) => {
  const { host, commits, handle } = await openSession();
  const session = await openWorkspaceSession(host, handle, {
    delayMs: options?.delayMs ?? 60_000,
  });
  return { host, commits, handle, session };
};

const entryPaths = (session: WorkspaceSession) =>
  [...session.getState().files.values()].map((entry) => entry.path);

describe('WorkspaceSession', () => {
  const directorySession = async () => {
    const { host, commits, handle } = await openSession();
    await host.commit(handle, {
      transactionId: 'seed-directory',
      mkdirs: ['docs/nested/empty', 'docs-other'],
      writes: [
        {
          path: 'docs/board.verd.json',
          content: fileJson('inside'),
          expectedVersion: null,
        },
        {
          path: 'docs/nested/note.verd-doc.json',
          content: JSON.stringify(createDocumentFile('note', 'Note')),
          expectedVersion: null,
        },
        {
          path: 'docs/nested/raw.txt',
          content: 'raw bytes',
          expectedVersion: null,
        },
        {
          path: 'outside.verd.json',
          content: JSON.stringify(
            withRef(fileFor('outside'), 'ref-inside', 'inside'),
          ),
          expectedVersion: null,
        },
      ],
    });
    const session = await openWorkspaceSession(host, handle, {
      delayMs: 60_000,
    });
    return { session, host, commits, handle };
  };

  it('trashes and restores a mixed subtree as one item, preserving identities, bytes and empty directories', async () => {
    const { session, host, handle } = await directorySession();
    const original = (await host.readSnapshot(handle)).entries;
    expect(
      (await session.apply({ type: 'trash-directory', path: 'docs' })).ok,
    ).toBe(true);
    expect(session.getState().files.has('inside')).toBe(false);
    expect(session.getState().documents.has('note')).toBe(false);
    expect(
      session.getState().entries.some((entry) => entry.path === 'docs-other'),
    ).toBe(true);
    expect(session.getState().trash).toHaveLength(1);
    const entryId = session.getState().trash[0].entryId;
    expect((await session.apply({ type: 'restore-file', entryId })).ok).toBe(
      true,
    );
    expect(session.getState().files.has('inside')).toBe(true);
    expect(session.getState().documents.get('note')?.file.id).toBe('note');
    expect(
      new TextDecoder().decode(
        (await host.readFile(handle, 'docs/nested/raw.txt')).content,
      ),
    ).toBe('raw bytes');
    expect((await host.readSnapshot(handle)).entries).toEqual(original);
    expect(
      session.getState().files.get('outside')?.file.cells['ref-inside'],
    ).toEqual(refCell('ref-inside', 'inside'));
  });

  it('replays folder trash and restore as one undo/redo step, including raw files', async () => {
    const { session, host, handle } = await directorySession();
    await session.apply({ type: 'trash-directory', path: 'docs' });
    expect((await session.undo()).ok).toBe(true);
    expect(session.getState().files.has('inside')).toBe(true);
    expect((await session.redo()).ok).toBe(true);
    expect(session.getState().files.has('inside')).toBe(false);
    await session.apply({
      type: 'restore-file',
      entryId: session.getState().trash[0].entryId,
    });
    expect((await session.undo()).ok).toBe(true);
    expect(session.getState().trash).toHaveLength(1);
    expect((await session.redo()).ok).toBe(true);
    expect(
      (await host.readSnapshot(handle)).entries.some(
        (entry) => entry.path === 'docs/nested/empty',
      ),
    ).toBe(true);
    expect(
      new TextDecoder().decode(
        (await host.readFile(handle, 'docs/nested/raw.txt')).content,
      ),
    ).toBe('raw bytes');
  });

  it('supports empty folders and raw-file restore undo/redo', async () => {
    const { session, host, handle } = await directorySession();
    await session.apply({ type: 'trash-directory', path: 'docs/nested/empty' });
    expect((await session.undo()).ok).toBe(true);
    expect((await session.redo()).ok).toBe(true);
    const raw = await host.readFile(handle, 'docs/nested/raw.txt');
    const receipt = await host.commit(handle, {
      transactionId: 'trash-raw',
      trash: [{ path: raw.path, expectedVersion: raw.version }],
    });
    await session.syncFromHost();
    expect(
      (
        await session.apply({
          type: 'restore-file',
          entryId: receipt.trashEntries![0].entryId,
        })
      ).ok,
    ).toBe(true);
    expect((await session.undo()).ok).toBe(true);
    expect((await session.redo()).ok).toBe(true);
    expect(
      new TextDecoder().decode((await host.readFile(handle, raw.path)).content),
    ).toBe('raw bytes');
  });

  it('flushes new files before folder trash and refuses to delete after a save conflict', async () => {
    const { session, host, handle } = await directorySession();
    await session.apply({
      type: 'create-file',
      file: fileFor('new'),
      path: 'docs/new.verd.json',
    });
    expect(
      (await session.apply({ type: 'trash-directory', path: 'docs' })).ok,
    ).toBe(true);
    await session.undo();
    expect(session.getState().files.has('new')).toBe(true);
    await session.apply({
      type: 'file',
      file: fileFor('inside', 'Local edit'),
    });
    const raw = await host.readFile(handle, 'docs/board.verd.json');
    await host.commit(handle, {
      transactionId: 'external-change',
      writes: [
        {
          path: raw.path,
          expectedVersion: raw.version,
          content: fileJson('inside', 'External edit'),
        },
      ],
    });
    expect(
      (await session.apply({ type: 'trash-directory', path: 'docs' })).ok,
    ).toBe(false);
    expect(
      (await host.readSnapshot(handle)).entries.some(
        (entry) => entry.path === 'docs',
      ),
    ).toBe(true);
  });

  it('rejects occupied restore paths, invalid folders and readonly mutations', async () => {
    const { session } = await directorySession();
    for (const path of [
      '',
      '/',
      '..',
      '.verdboard',
      '.verdboard/trash',
      'docs/board.verd.json',
    ])
      expect((await session.apply({ type: 'trash-directory', path })).ok).toBe(
        false,
      );
    await session.apply({ type: 'trash-directory', path: 'docs' });
    const entryId = session.getState().trash[0].entryId;
    session.mkdir('docs');
    expect((await session.apply({ type: 'restore-file', entryId })).ok).toBe(
      false,
    );
    expect(session.getState().trash).toHaveLength(1);
    session.setReadonly(true);
    expect(
      (await session.apply({ type: 'purge-trash', entryIds: [entryId] })).ok,
    ).toBe(false);
    expect(
      (await session.apply({ type: 'trash-directory', path: 'docs-other' })).ok,
    ).toBe(false);
  });

  it('permanent deletion removes related history and keeps unrelated undo', async () => {
    const { session, host, handle } = await directorySession();
    await session.apply({ type: 'create-file', file: fileFor('unrelated') });
    await session.apply({ type: 'file', file: fileFor('inside', 'Edited') });
    await session.apply({ type: 'trash-directory', path: 'docs' });
    const entryId = session.getState().trash[0].entryId;
    expect(
      (await session.apply({ type: 'purge-trash', entryIds: [entryId] })).ok,
    ).toBe(true);
    expect(session.getState().trash).toHaveLength(0);
    expect((await session.undo()).ok).toBe(true);
    expect(session.getState().files.has('unrelated')).toBe(false);
    expect(session.getState().canUndo).toBe(false);
    expect(session.getState().files.has('inside')).toBe(false);
    expect((await host.readSnapshot(handle)).trash).toEqual([]);
  });

  it('permanent deletion also removes single-file resurrection and empty-directory history', async () => {
    const { session } = await directorySession();
    await session.apply({ type: 'file', file: fileFor('inside', 'Edited') });
    await session.apply({ type: 'trash-file', frameId: 'inside' });
    await session.flush();
    await session.apply({ type: 'trash-directory', path: 'docs/nested/empty' });
    await session.apply({
      type: 'purge-trash',
      entryIds: session.getState().trash.map((entry) => entry.entryId),
    });
    expect(session.getState().canUndo).toBe(false);
    expect(session.getState().canRedo).toBe(false);
  });

  it('keeps history for a different file created at a previously trashed path', async () => {
    const { session } = await directorySession();
    expect(
      (await session.apply({ type: 'trash-file', fileId: 'inside' })).ok,
    ).toBe(true);
    expect(await session.flush()).toBe(true);
    const entryId = session.getState().trash[0].entryId;
    await session.apply({
      type: 'create-file',
      file: fileFor('replacement'),
      path: 'docs/board.verd.json',
    });
    expect(
      (await session.apply({ type: 'purge-trash', entryIds: [entryId] })).ok,
    ).toBe(true);
    expect(session.getState().canUndo).toBe(true);
    expect((await session.undo()).ok).toBe(true);
    expect(session.getState().files.has('replacement')).toBe(false);
    expect(session.getState().files.has('inside')).toBe(false);
    expect(session.getState().canUndo).toBe(false);
  });

  it('replays an unconfirmed purge without touching trash added after confirmation', async () => {
    const { session, host, handle } = await directorySession();
    await session.apply({ type: 'trash-directory', path: 'docs' });
    const entryIds = session.getState().trash.map((entry) => entry.entryId);
    const commit = host.commit.bind(host);
    let loseReceipt = true;
    const attempts: string[] = [];
    host.commit = async (handle_, request) => {
      const receipt = await commit(handle_, request);
      if (request.purge) {
        attempts.push(request.transactionId);
        if (loseReceipt) {
          loseReceipt = false;
          throw new Error('Lost purge receipt');
        }
      }
      return receipt;
    };
    expect((await session.apply({ type: 'purge-trash', entryIds })).ok).toBe(
      false,
    );
    expect(session.getState().trash).toHaveLength(1);
    expect((await session.undo()).ok).toBe(false);
    const later = await host.commit(handle, {
      transactionId: 'external-later-trash',
      trash: [{ path: 'docs-other' }],
    });
    expect((await session.apply({ type: 'purge-trash', entryIds })).ok).toBe(
      true,
    );
    expect(attempts).toEqual([attempts[0], attempts[0]]);
    expect(session.getState().trash.map((entry) => entry.entryId)).toEqual([
      later.trashEntries![0].entryId,
    ]);
    expect(session.getState().canUndo).toBe(false);
  });

  it('can explicitly resume a failed undo without losing the history transition', async () => {
    const { session, host } = await directorySession();
    await session.apply({ type: 'trash-directory', path: 'docs' });
    const commit = host.commit.bind(host);
    let loseReceipt = true;
    host.commit = async (handle, request) => {
      const receipt = await commit(handle, request);
      if (request.restore && loseReceipt) {
        loseReceipt = false;
        throw new Error('Lost undo receipt');
      }
      return receipt;
    };
    expect((await session.undo()).ok).toBe(false);
    expect(session.getState().trashUnconfirmed).toBe(true);
    expect((await session.retryTrashOperation()).ok).toBe(true);
    expect(session.getState().trashUnconfirmed).toBe(false);
    expect(session.getState().files.has('inside')).toBe(true);
    expect(session.getState().canRedo).toBe(true);
    expect((await session.redo()).ok).toBe(true);
    expect(session.getState().files.has('inside')).toBe(false);
  });

  it('retries unknown outcomes with the same transaction and blocks intervening writes', async () => {
    const { session, host, handle } = await directorySession();
    const commit = host.commit.bind(host);
    let loseReceipt = true;
    const attempts: string[] = [];
    host.commit = async (handle_, request) => {
      if (request.trash?.[0]?.path === 'docs') {
        attempts.push(request.transactionId);
        const receipt = await commit(handle_, request);
        if (loseReceipt) {
          loseReceipt = false;
          throw new Error('Lost receipt');
        }
        return receipt;
      }
      return commit(handle_, request);
    };
    expect(
      (await session.apply({ type: 'trash-directory', path: 'docs' })).ok,
    ).toBe(false);
    expect(
      (await session.apply({ type: 'create-file', file: fileFor('blocked') }))
        .ok,
    ).toBe(false);
    expect(await session.flush()).toBe(false);
    expect(
      (await session.apply({ type: 'trash-directory', path: 'docs' })).ok,
    ).toBe(true);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toBe(attempts[1]);
    expect((await host.readSnapshot(handle)).trash).toHaveLength(1);
    expect((await session.undo()).ok).toBe(true);
  });

  it('opens an empty workspace with initialized config', async () => {
    const { session } = await sessionOf();
    const state = session.getState();
    expect(state.files.size).toBe(0);
    expect(state.dirty).toBe(false);
    expect(state.config.version).toBeGreaterThanOrEqual(1);
  });

  it('creates a file, persists it on flush and records one history entry', async () => {
    const { session, commits, host, handle } = await sessionOf();
    const result = await session.apply({
      type: 'create-file',
      file: fileFor('board-1', 'Board One'),
    });
    expect(result.ok).toBe(true);
    expect(entryPaths(session)).toEqual(['Board One.verd.json']);
    expect(session.getState().dirty).toBe(true);
    expect(session.getState().canUndo).toBe(true);

    await session.flush();
    expect(commits).toHaveLength(1);
    expect(commits[0].writes).toHaveLength(1);

    const snapshot = await host.readSnapshot(handle);
    expect(snapshot.canvases.map((canvas) => canvas.path)).toEqual([
      'Board One.verd.json',
    ]);
    expect(session.getState().dirty).toBe(false);
    const entry = session.getState().files.get('board-1');
    expect(entry?.version).toBe(snapshot.canvases[0].version);
  });

  it('creates a seeded file without an undo entry when history is declined', async () => {
    const { session } = await sessionOf();
    const result = await session.apply({
      type: 'create-file',
      file: fileFor('board-1', 'Board One'),
      recordHistory: false,
    });
    expect(result.ok).toBe(true);
    expect(entryPaths(session)).toEqual(['Board One.verd.json']);
    expect(session.getState().canUndo).toBe(false);
    expect(session.getState().canRedo).toBe(false);
  });

  it('batches a whole store partition into a single commit', async () => {
    const { session, commits } = await sessionOf();
    const result = await session.apply({
      type: 'store',
      store: workspaceStore(frameCell('a'), frameCell('b'), frameCell('c')),
    });
    expect(result.ok).toBe(true);
    expect(session.getState().files.size).toBe(3);
    await session.flush();
    expect(commits).toHaveLength(1);
    expect(commits[0].writes).toHaveLength(3);
  });

  it('trashes a file and restores it with the same identity', async () => {
    const { session, host, handle } = await sessionOf();
    await session.apply({ type: 'create-file', file: fileFor('board-1') });
    await session.flush();

    const trashed = await session.apply({
      type: 'trash-file',
      frameId: 'board-1',
    });
    expect(trashed.ok).toBe(true);
    expect(session.getState().files.size).toBe(0);
    await session.flush();
    expect(session.getState().trash).toHaveLength(1);

    const snapshot = await host.readSnapshot(handle);
    expect(snapshot.canvases).toEqual([]);
    expect(snapshot.trash).toHaveLength(1);

    const restored = await session.apply({
      type: 'restore-file',
      entryId: snapshot.trash[0].entryId,
    });
    expect(restored.ok).toBe(true);
    expect(session.getState().files.has('board-1')).toBe(true);
    expect(session.getState().trash).toHaveLength(0);
  });

  it('undoes and redoes multi-file commands as one step', async () => {
    const { session } = await sessionOf();
    await session.apply({
      type: 'store',
      store: workspaceStore(frameCell('a'), frameCell('b')),
    });
    expect(session.getState().files.size).toBe(2);

    const undone = await session.undo();
    expect(undone.ok).toBe(true);
    expect(session.getState().files.size).toBe(0);
    expect(session.getState().canRedo).toBe(true);

    const redone = await session.redo();
    expect(redone.ok).toBe(true);
    expect(session.getState().files.size).toBe(2);
  });

  it('undo of a trash restores the file with identical content', async () => {
    const { session, host, handle } = await sessionOf();
    const file = withCells(fileFor('board-1'), {
      'cell-1': {
        id: 'cell-1',
        cellType: 'node',
        kind: 'rect',
        geometry: { x: 0, y: 0, width: 10, height: 10 },
      } as never,
    });
    file.frame.children = ['cell-1'];
    await session.apply({ type: 'create-file', file });
    await session.flush();
    await session.apply({ type: 'trash-file', frameId: 'board-1' });
    await session.undo();

    const entry = session.getState().files.get('board-1');
    expect(entry?.file.cells['cell-1']).toBeTruthy();
    await session.flush();
    const snapshot = await host.readSnapshot(handle);
    expect(snapshot.canvases.map((canvas) => canvas.path)).toEqual([
      'board-1.verd.json',
    ]);
  });

  it('rejects a cyclic candidate without mutating state', async () => {
    const { session } = await sessionOf();
    const ref = (id: string, target: string) =>
      ({
        id,
        cellType: 'node',
        kind: 'frame-reference',
        geometry: { x: 0, y: 0, width: 10, height: 10 },
        data: { targetFrameId: target },
      }) as never;
    const cyclicA = withCells(fileFor('a'), { r1: ref('r1', 'b') });
    const cyclicB = withCells(fileFor('b'), { r2: ref('r2', 'a') });
    await session.apply({ type: 'create-file', file: cyclicA });
    const before = session.getState().files.size;

    const result = await session.apply({ type: 'create-file', file: cyclicB });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(session.getState().files.size).toBe(before);
  });

  it('moves a file while preserving its identity', async () => {
    const { session, host, handle } = await sessionOf();
    await session.apply({ type: 'create-file', file: fileFor('board-1') });
    await session.flush();
    const version = session.getState().files.get('board-1')?.version;

    const moved = await session.apply({
      type: 'move-file',
      frameId: 'board-1',
      toPath: 'docs/board-1.verd.json',
    });
    expect(moved.ok).toBe(true);
    await session.flush();

    const snapshot = await host.readSnapshot(handle);
    expect(snapshot.canvases.map((canvas) => canvas.path)).toEqual([
      'docs/board-1.verd.json',
    ]);
    // A move preserves content, so the digest stays the same version.
    expect(session.getState().files.get('board-1')?.version).toBe(version);
  });

  it('marks a file conflicted when the host rejects its write', async () => {
    const { session, host, handle } = await sessionOf();
    await session.apply({ type: 'create-file', file: fileFor('board-1') });
    await session.flush();

    // The local file goes dirty first, then an external writer moves the
    // same file underneath the pending write.
    await session.apply({
      type: 'file',
      file: fileFor('board-1', 'Local edit'),
    });
    const snapshot = await host.readSnapshot(handle);
    const version = snapshot.canvases[0].version;
    await host.commit(handle, {
      transactionId: 'external-tx',
      writes: [
        {
          path: 'board-1.verd.json',
          content: fileJson('board-1', 'External'),
          expectedVersion: version,
        },
      ],
    });

    await expect(session.flush()).resolves.toBe(false);
    // A retry must not report clean merely because its rejected op left the queue.
    await expect(session.flush()).resolves.toBe(false);
    const entry = session.getState().files.get('board-1');
    expect(entry?.conflicted).toBe(true);
    expect(session.getState().diagnostics.length).toBeGreaterThan(0);
  });

  it('keeps the rest of the queue flowing after one file conflicts', async () => {
    const { session, host, handle } = await sessionOf();
    await session.apply({ type: 'create-file', file: fileFor('a') });
    await session.apply({ type: 'create-file', file: fileFor('b') });
    await session.flush();

    // 'a' goes dirty locally before the external writer touches it; 'b'
    // stays clean, so its queued write must still commit after 'a' rejects.
    await session.apply({
      type: 'file',
      file: fileFor('a', 'A local'),
    });
    const snapshot = await host.readSnapshot(handle);
    const aVersion = snapshot.canvases.find(
      (c) => c.path === 'a.verd.json',
    )?.version;
    await host.commit(handle, {
      transactionId: 'external-tx',
      writes: [
        {
          path: 'a.verd.json',
          content: fileJson('a', 'External A'),
          expectedVersion: aVersion!,
        },
      ],
    });

    await session.apply({
      type: 'file',
      file: fileFor('b', 'B local'),
    });
    await session.flush();
    const after = await host.readSnapshot(handle);
    const b = after.canvases.find((canvas) => canvas.path === 'b.verd.json');
    expect(b?.file?.frame.name).toBe('B local');
    expect(session.getState().files.get('a')?.conflicted).toBe(true);
  });

  it('retries an io-error commit with the same transactionId', async () => {
    const inner = createMemoryWorkspaceHost({ now: () => 1_700_000_000_000 });
    let failOnce = true;
    const requests: CommitRequest[] = [];
    const host: WorkspaceHost = {
      ...inner,
      commit: async (handle, request) => {
        requests.push(request);
        if (failOnce) {
          failOnce = false;
          throw new Error('injected io failure');
        }
        return inner.commit(handle, request);
      },
    };
    const handle = (await host.openWorkspace({ path: 'ws-retry' }))!;
    const session = await openWorkspaceSession(host, handle, {
      delayMs: 60_000,
    });
    await session.apply({ type: 'create-file', file: fileFor('board-1') });
    // An I/O failure surfaces as a `false` result plus error status; the
    // same transactionId is replayed on the next flush.
    await expect(session.flush()).resolves.toBe(false);
    expect(session.getState().saveStatus).toBe('error');

    await session.flush();
    expect(requests).toHaveLength(2);
    expect(requests[0].transactionId).toBe(requests[1].transactionId);
    expect(session.getState().saveStatus).toBe('saved');
  });

  it('rebases a write queued behind a retried io-error commit', async () => {
    const inner = createMemoryWorkspaceHost({ now: () => 1_700_000_000_000 });
    let calls = 0;
    const host: WorkspaceHost = {
      ...inner,
      commit: async (handle, request) => {
        calls += 1;
        if (calls === 2) throw new Error('injected io failure');
        return inner.commit(handle, request);
      },
    };
    const handle = (await host.openWorkspace({ path: 'ws-rebase' }))!;
    const session = await openWorkspaceSession(host, handle, {
      delayMs: 60_000,
    });
    await session.apply({ type: 'create-file', file: fileFor('board-1') });
    await session.flush();

    await session.apply({
      type: 'file',
      file: fileFor('board-1', 'Edit One'),
    });
    await expect(session.flush()).resolves.toBe(false);

    // Queued while the failed commit waits to retry: stamps the version
    // that commit is about to replace, so it must be re-based on settle.
    await session.apply({
      type: 'file',
      file: fileFor('board-1', 'Edit Two'),
    });
    await session.flush();

    expect(session.getState().saveStatus).toBe('saved');
    expect(session.getState().files.get('board-1')?.conflicted).toBeFalsy();
    const read = await host.readFile(handle, 'board-1.verd.json');
    expect(JSON.parse(new TextDecoder().decode(read.content)).frame.name).toBe(
      'Edit Two',
    );
  });

  it('rebases a write queued while a commit is in-flight', async () => {
    const inner = createMemoryWorkspaceHost({ now: () => 1_700_000_000_000 });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const host: WorkspaceHost = {
      ...inner,
      commit: async (handle, request) => {
        calls += 1;
        if (calls === 2) await gate;
        return inner.commit(handle, request);
      },
    };
    const handle = (await host.openWorkspace({ path: 'ws-inflight' }))!;
    const session = await openWorkspaceSession(host, handle, {
      delayMs: 60_000,
    });
    await session.apply({ type: 'create-file', file: fileFor('board-1') });
    await session.flush();

    await session.apply({
      type: 'file',
      file: fileFor('board-1', 'Edit One'),
    });
    const inflight = session.flush();
    await session.apply({
      type: 'file',
      file: fileFor('board-1', 'Edit Two'),
    });
    release();
    await inflight;

    expect(session.getState().saveStatus).toBe('saved');
    expect(session.getState().files.get('board-1')?.conflicted).toBeFalsy();
    const read = await host.readFile(handle, 'board-1.verd.json');
    expect(JSON.parse(new TextDecoder().decode(read.content)).frame.name).toBe(
      'Edit Two',
    );
  });

  it('persists navigation session state without entering undo history', async () => {
    const { session, host, handle } = await sessionOf();
    session.setSessionState({
      tabs: [{ fileId: 'a' }],
      activeTabId: 'a',
      expandedDirs: ['docs'],
    });
    expect(session.getState().canUndo).toBe(false);
    await session.flush();

    const snapshot = await host.readSnapshot(handle);
    expect(snapshot.session?.activeTabId).toBe('a');
    expect(snapshot.session?.expandedDirs).toEqual(['docs']);
  });

  it('publishes uncommitted workspace config immediately', async () => {
    const { session } = await sessionOf();
    const version = session.getState().config.version;
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    session.setWorkspaceConfig({ name: 'Draft' });
    expect(listener).toHaveBeenCalledOnce();
    expect(session.getState().config).toEqual({
      version,
      value: { name: 'Draft' },
    });
    unsubscribe();
    session.dispose();
  });

  it('rebases config queued during a commit without losing the next canvas write', async () => {
    const inner = createMemoryWorkspaceHost();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    const host: WorkspaceHost = {
      ...inner,
      commit: async (handle, request) => {
        if (first) {
          first = false;
          entered();
          await gate;
        }
        return inner.commit(handle, request);
      },
    };
    const handle = (await host.openWorkspace({ path: 'config-in-flight' }))!;
    const session = await openWorkspaceSession(host, handle, {
      delayMs: 60_000,
    });
    const version = session.getState().config.version;
    session.setWorkspaceConfig({ name: 'First' });
    const flushing = session.flush();
    await started;
    session.setWorkspaceConfig({ name: 'Second', mindDefaultWidth: 320 });
    await session.apply({
      type: 'create-file',
      file: fileFor('queued-canvas'),
    });
    release();
    expect(await flushing).toBe(true);
    expect(await session.flush()).toBe(true);
    const snapshot = await host.readSnapshot(handle);
    expect(snapshot.config).toEqual({
      version: version + 2,
      value: { name: 'Second', mindDefaultWidth: 320 },
    });
    expect(
      snapshot.canvases.some(
        (entry) => entry.file?.frame.id === 'queued-canvas',
      ),
    ).toBe(true);
    expect(session.getState().config.version).toBe(version + 2);
    session.dispose();
  });

  it('updates workspace config via compare-and-swap', async () => {
    const { session, host, handle } = await sessionOf();
    session.setWorkspaceConfig({ name: 'My workspace' });
    await session.flush();
    const snapshot = await host.readSnapshot(handle);
    expect(snapshot.config.value).toEqual({ name: 'My workspace' });
    expect(session.getState().config.version).toBe(2);
  });

  it('syncs external file changes into clean files', async () => {
    const { session, host, handle } = await sessionOf();
    await session.apply({ type: 'create-file', file: fileFor('board-1') });
    await session.flush();

    const snapshot = await host.readSnapshot(handle);
    await host.commit(handle, {
      transactionId: 'external-tx',
      writes: [
        {
          path: 'board-1.verd.json',
          content: fileJson('board-1', 'External name'),
          expectedVersion: snapshot.canvases[0].version,
        },
      ],
    });
    // The subscription may fire asynchronously; sync explicitly too.
    await session.syncFromHost();
    expect(session.getState().files.get('board-1')?.file.frame.name).toBe(
      'External name',
    );
    expect(session.getState().files.get('board-1')?.conflicted).toBeFalsy();
  });

  it('marks a dirty file conflicted when its base version moves externally', async () => {
    const { session, host, handle } = await sessionOf();
    await session.apply({ type: 'create-file', file: fileFor('board-1') });
    await session.flush();
    await session.apply({
      type: 'file',
      file: fileFor('board-1', 'Local dirty'),
    });

    const snapshot = await host.readSnapshot(handle);
    await host.commit(handle, {
      transactionId: 'external-tx',
      writes: [
        {
          path: 'board-1.verd.json',
          content: fileJson('board-1', 'External'),
          expectedVersion: snapshot.canvases[0].version,
        },
      ],
    });
    await session.syncFromHost();
    const entry = session.getState().files.get('board-1');
    expect(entry?.conflicted).toBe(true);
    // Local content is preserved, not overwritten.
    expect(entry?.file.frame.name).toBe('Local dirty');
  });

  it.each([false, true])(
    'discards a host read overtaken by a local edit (committed: %s)',
    async (commitBeforeReadReturns) => {
      const inner = createMemoryWorkspaceHost();
      let delayNextRead = false;
      let releaseRead!: () => void;
      let capturedRead!: () => void;
      const captured = new Promise<void>((resolve) => {
        capturedRead = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      const host: WorkspaceHost = {
        ...inner,
        // Explicit reads below reproduce the watch/read/commit interleaving.
        subscribe: () => () => {},
        readSnapshot: async (handle) => {
          const delay = delayNextRead;
          delayNextRead = false;
          const snapshot = await inner.readSnapshot(handle);
          if (delay) {
            capturedRead();
            await gate;
          }
          return snapshot;
        },
      };
      const { handle } = await openSession({ host });
      const session = await openWorkspaceSession(host, handle, {
        delayMs: 60_000,
      });
      await session.apply({ type: 'create-file', file: fileFor('board-1') });
      await session.flush();
      delayNextRead = true;
      const sync = session.syncFromHost();
      await captured;
      await session.apply({
        type: 'file',
        file: fileFor('board-1', 'Latest local edit'),
      });
      if (commitBeforeReadReturns) expect(await session.flush()).toBe(true);
      releaseRead();
      await sync;
      expect(session.getState().files.get('board-1')?.file.frame.name).toBe(
        'Latest local edit',
      );
      expect(session.getState().files.get('board-1')?.conflicted).toBeFalsy();
      expect(await session.flush()).toBe(true);
      expect((await session.undo()).ok).toBe(true);
      expect(session.getState().files.get('board-1')?.file.frame.name).toBe(
        'board-1',
      );
      expect(await session.flush()).toBe(true);
      session.dispose();
    },
  );

  it('notifies subscribers on state changes', async () => {
    const { session } = await sessionOf();
    const listener = vi.fn();
    session.subscribe(listener);
    await session.apply({ type: 'create-file', file: fileFor('x') });
    expect(listener).toHaveBeenCalled();
  });

  it('duplicates a file with its whole dependency closure', async () => {
    const { session, commits } = await sessionOf();
    // a -> b -> c, plus unrelated x.
    await session.apply({
      type: 'store',
      store: {
        rootId: WORKSPACE_ROOT_ID,
        cells: {
          a: { ...frameCell('a'), children: ['r1'] },
          b: { ...frameCell('b'), children: ['r2'] },
          c: frameCell('c'),
          x: frameCell('x'),
          r1: refCell('r1', 'b'),
          r2: refCell('r2', 'c'),
          [WORKSPACE_ROOT_ID]: {
            ...frameCell(WORKSPACE_ROOT_ID),
            children: ['a', 'b', 'c', 'x'],
          },
        },
      },
    });
    const result = await session.apply({
      type: 'duplicate-file',
      frameId: 'a',
    });
    expect(result.ok).toBe(true);
    const state = session.getState();
    expect(state.files.size).toBe(7);
    const cloneA = [...state.files.values()].find(
      (entry) =>
        entry.path.startsWith('a') &&
        !['a', 'b', 'c', 'x'].includes(entry.file.frame.id),
    );
    expect(cloneA).toBeTruthy();
    const cloneARef = Object.values(cloneA!.file.cells)[0];
    expect(cloneARef.kind).toBe('frame-reference');
    const cloneBId = (cloneARef as FrameReferenceCell).data.targetFrameId;
    const cloneB = state.files.get(cloneBId);
    expect(cloneB).toBeTruthy();
    const cloneBRef = Object.values(cloneB!.file.cells)[0];
    const cloneCId = (cloneBRef as FrameReferenceCell).data.targetFrameId;
    expect(state.files.has(cloneCId)).toBe(true);
    // Internal references repoint at the copies — the clone shares nothing.
    expect(cloneCId).not.toBe('c');
    // One history entry: a single undo removes all three clones.
    await session.undo();
    expect(session.getState().files.size).toBe(4);
    await session.flush();
    expect(commits.length).toBeGreaterThan(0);
  });

  it('duplicates a reference occurrence with an independent target', async () => {
    const { session } = await sessionOf();
    await session.apply({
      type: 'store',
      store: {
        rootId: WORKSPACE_ROOT_ID,
        cells: {
          a: { ...frameCell('a'), children: ['r1'] },
          b: frameCell('b'),
          r1: refCell('r1', 'b'),
          [WORKSPACE_ROOT_ID]: {
            ...frameCell(WORKSPACE_ROOT_ID),
            children: ['a', 'b'],
          },
        },
      },
    });
    const result = await session.apply({
      type: 'duplicate-reference',
      ownerFrameId: 'a',
      refId: 'r1',
    });
    expect(result.ok).toBe(true);
    const owner = session.getState().files.get('a');
    expect(owner?.file.frame.children).toHaveLength(2);
    const newRefId = owner!.file.frame.children[1];
    const newRef = owner!.file.cells[newRefId] as FrameReferenceCell;
    expect(newRef.kind).toBe('frame-reference');
    const cloneTarget = newRef.data.targetFrameId;
    expect(cloneTarget).not.toBe('b');
    expect(session.getState().files.has(cloneTarget)).toBe(true);
    // The original occurrence still points at the original target.
    const original = owner!.file.cells['r1'] as FrameReferenceCell;
    expect(original.data.targetFrameId).toBe('b');
  });

  it('rejects duplicating a reference with an unresolved target', async () => {
    const { session } = await sessionOf();
    await session.apply({
      type: 'store',
      store: {
        rootId: WORKSPACE_ROOT_ID,
        cells: {
          a: { ...frameCell('a'), children: ['r1'] },
          r1: refCell('r1', 'ghost'),
          [WORKSPACE_ROOT_ID]: {
            ...frameCell(WORKSPACE_ROOT_ID),
            children: ['a'],
          },
        },
      },
    });
    const result = await session.apply({
      type: 'duplicate-reference',
      ownerFrameId: 'a',
      refId: 'r1',
    });
    expect(result.ok).toBe(false);
  });

  it('imports a bundle, remapping colliding identities and keeping foreign refs', async () => {
    const { session } = await sessionOf();
    await session.apply({ type: 'create-file', file: fileFor('a', 'Local A') });
    const imported = withRef(fileFor('a', 'Foreign A'), 'r9', 'outside');
    const result = await session.apply({
      type: 'import-files',
      files: [imported],
    });
    expect(result.ok).toBe(true);
    const state = session.getState();
    expect(state.files.size).toBe(2);
    const foreign = [...state.files.values()].find(
      (entry) => entry.file.frame.id !== 'a',
    );
    expect(foreign).toBeTruthy();
    // The external target id survives: unresolved now, resolvable later.
    const ref = Object.values(foreign!.file.cells)[0] as FrameReferenceCell;
    expect(ref.data.targetFrameId).toBe('outside');
  });

  it('exports a file together with its dependency closure', async () => {
    const { session } = await sessionOf();
    await session.apply({
      type: 'store',
      store: {
        rootId: WORKSPACE_ROOT_ID,
        cells: {
          a: { ...frameCell('a'), children: ['r1'] },
          b: { ...frameCell('b'), children: ['r2'] },
          c: frameCell('c'),
          x: frameCell('x'),
          r1: refCell('r1', 'b'),
          r2: refCell('r2', 'c'),
          [WORKSPACE_ROOT_ID]: {
            ...frameCell(WORKSPACE_ROOT_ID),
            children: ['a', 'b', 'c', 'x'],
          },
        },
      },
    });
    const closure = session.exportFiles('a');
    expect(closure.map((file) => file.frame.id)).toEqual(['a', 'b', 'c']);
  });

  /** Drives a file into the conflicted state: local dirty write meets a moved disk version. */
  const makeConflict = async (
    session: WorkspaceSession,
    host: WorkspaceHost,
    handle: Parameters<WorkspaceHost['readSnapshot']>[0],
  ) => {
    await session.apply({
      type: 'file',
      file: fileFor('board-1', 'Local edit'),
    });
    const snapshot = await host.readSnapshot(handle);
    const version = snapshot.canvases[0].version;
    await host.commit(handle, {
      transactionId: 'external-tx',
      writes: [
        {
          path: 'board-1.verd.json',
          content: fileJson('board-1', 'External'),
          expectedVersion: version,
        },
      ],
    });
    await session.flush();
    expect(session.getState().files.get('board-1')?.conflicted).toBe(true);
  };

  it('resolves a conflict keeping local content', async () => {
    const { session, host, handle } = await sessionOf();
    await session.apply({ type: 'create-file', file: fileFor('board-1') });
    await session.flush();
    await makeConflict(session, host, handle);

    const result = await session.resolveConflict('board-1', 'keep-local');
    expect(result.ok).toBe(true);
    expect(session.getState().saveStatus).toBe('saved');
    const entry = session.getState().files.get('board-1');
    expect(entry?.conflicted).toBeFalsy();
    expect(entry?.dirty).toBe(false);
    const snapshot = await host.readSnapshot(handle);
    expect(snapshot.canvases[0].file?.frame.name).toBe('Local edit');
    // The diverged disk version moved to trash, not silently overwritten.
    expect(session.getState().trash.length).toBeGreaterThan(0);
  });

  it('resolves a conflict by loading the disk version, undoably', async () => {
    const { session, host, handle } = await sessionOf();
    await session.apply({ type: 'create-file', file: fileFor('board-1') });
    await session.flush();
    await makeConflict(session, host, handle);

    const result = await session.resolveConflict('board-1', 'load-disk');
    expect(result.ok).toBe(true);
    expect(session.getState().saveStatus).toBe('saved');
    const entry = session.getState().files.get('board-1');
    expect(entry?.conflicted).toBeFalsy();
    expect(entry?.file.frame.name).toBe('External');
    // Undo restores the discarded local edit rather than losing it.
    await session.undo();
    expect(session.getState().files.get('board-1')?.file.frame.name).toBe(
      'Local edit',
    );
  });
});
