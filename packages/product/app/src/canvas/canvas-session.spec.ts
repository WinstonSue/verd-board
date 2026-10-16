import { describe, expect, it } from 'vitest';
import type { FrameCell } from '@sue/board-core';
import type { FrameFileV2 } from '../frames/frame-files';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import { openWorkspaceSession } from '../session/workspace-session';
import {
  createCanvasSession,
  refOccurrenceId,
  rootOccurrenceId,
} from './canvas-session';

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

type CellId = string;

const fileFor = (
  id: string,
  cells: FrameFileV2['cells'] = {},
  children: CellId[] = [],
): FrameFileV2 => ({
  format: 'verd-frame',
  version: 2,
  frame: { ...frameCell(id), children },
  cells,
});

const refCell = (id: string, targetFrameId: string) =>
  ({
    id,
    cellType: 'node',
    kind: 'frame-reference',
    geometry: { x: 0, y: 0, width: 300, height: 200 },
    data: { targetFrameId },
  }) as never;

const setup = async () => {
  const host = createMemoryWorkspaceHost({ now: () => 1_700_000_000_000 });
  const handle = (await host.openWorkspace({ path: `ws-${Math.random()}` }))!;
  const session = await openWorkspaceSession(host, handle, {
    delayMs: 60_000,
  });
  const canvas = createCanvasSession({ session });
  return { host, handle, session, canvas };
};

const seedFiles = async (
  session: Awaited<ReturnType<typeof setup>>['session'],
  files: FrameFileV2[],
) => {
  for (const file of files) await session.apply({ type: 'create-file', file });
  await session.flush();
};

describe('CanvasSession', () => {
  it('opens a root occurrence with an isolated runtime', async () => {
    const { session, canvas } = await setup();
    await seedFiles(session, [fileFor('board-1')]);
    const opened = canvas.openFile('board-1');
    expect(opened.ok).toBe(true);
    expect(opened.occurrence?.id).toBe(rootOccurrenceId('board-1'));
    expect(opened.occurrence?.runtime.store.rootId).toBe('board-1');
  });

  it('keeps two occurrences of one file fully independent', async () => {
    const { session, canvas } = await setup();
    await seedFiles(session, [
      fileFor('target'),
      fileFor('owner', { r1: refCell('r1', 'target') }, ['r1']),
      fileFor('owner2', { r2: refCell('r2', 'target') }, ['r2']),
    ]);
    const root = canvas.openFile('target').occurrence!;
    const embedded = canvas.openRef('owner', 'r1').occurrence!;
    const embedded2 = canvas.openRef('owner2', 'r2').occurrence!;
    expect(embedded.fileId).toBe('target');
    expect(embedded2.fileId).toBe('target');
    // Independent runtimes: selection in one does not leak to another.
    root.runtime.select({ focus: ['target'], ids: [] });
    expect(embedded.runtime.selection).not.toBe(root.runtime.selection);
    // Independent caches: same namespace, separate storage.
    const cacheA = canvas.cacheFor(root.id, 'layout');
    const cacheB = canvas.cacheFor(embedded.id, 'layout');
    cacheA.set('key', 'root-value');
    expect(cacheB.get('key')).toBeUndefined();
    // Independent view state.
    canvas.setView(root.id, { tool: 'hand' });
    expect(embedded.view.tool).toBe('select');
  });

  it('routes occurrence edits into the unified session history', async () => {
    const { session, canvas } = await setup();
    await seedFiles(session, [fileFor('board-1')]);
    const occurrence = canvas.openFile('board-1').occurrence!;
    const result = await canvas.dispatch(occurrence.id, {
      id: 'edit-1',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...occurrence.runtime.store.cells['board-1'],
            name: 'renamed',
          } as never,
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(session.getState().files.get('board-1')?.file.frame.name).toBe(
      'renamed',
    );
    expect(session.getState().canUndo).toBe(true);
  });

  it('undo/redo replays through the session and refreshes runtimes', async () => {
    const { session, canvas } = await setup();
    await seedFiles(session, [fileFor('board-1')]);
    const occurrence = canvas.openFile('board-1').occurrence!;
    await canvas.dispatch(occurrence.id, {
      id: 'edit-1',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...occurrence.runtime.store.cells['board-1'],
            name: 'v2',
          } as never,
        },
      ],
    });
    expect(occurrence.runtime.store.cells['board-1']).toMatchObject({
      name: 'v2',
    });
    await canvas.undo();
    expect(occurrence.runtime.store.cells['board-1']).toMatchObject({
      name: 'board-1',
    });
    await canvas.redo();
    expect(occurrence.runtime.store.cells['board-1']).toMatchObject({
      name: 'v2',
    });
    void session;
  });

  it('marks occurrences missing when the target is trashed and restores on undo', async () => {
    const { session, canvas } = await setup();
    await seedFiles(session, [fileFor('target')]);
    const occurrence = canvas.openFile('target').occurrence!;
    await session.apply({ type: 'trash-file', frameId: 'target' });
    canvas.syncFromSession();
    expect(occurrence.missing).toBe(true);
    const rejected = await canvas.dispatch(occurrence.id, {
      id: 'x',
      operations: [],
    });
    expect(rejected.ok).toBe(false);
    await session.undo();
    canvas.syncFromSession();
    expect(occurrence.missing).toBe(false);
  });

  it('tracks the nested active context and falls back on deactivate', async () => {
    const { session, canvas } = await setup();
    await seedFiles(session, [
      fileFor('target'),
      fileFor('owner', { r1: refCell('r1', 'target') }, ['r1']),
    ]);
    const root = canvas.openFile('owner').occurrence!;
    const embedded = canvas.openRef('owner', 'r1', root.id).occurrence!;
    expect(embedded.parentId).toBe(root.id);
    expect(canvas.activePath()).toEqual([root.id, embedded.id]);
    expect(canvas.active()?.id).toBe(embedded.id);
    canvas.deactivate(embedded.id);
    expect(canvas.active()?.id).toBe(root.id);
  });

  it('closes embedded occurrences when their parent closes', async () => {
    const { session, canvas } = await setup();
    await seedFiles(session, [
      fileFor('target'),
      fileFor('owner', { r1: refCell('r1', 'target') }, ['r1']),
    ]);
    const root = canvas.openFile('owner').occurrence!;
    const embedded = canvas.openRef('owner', 'r1', root.id).occurrence!;
    expect(embedded.id).toBe(refOccurrenceId('owner', 'r1'));
    canvas.close(root.id);
    expect(canvas.get(root.id)).toBeUndefined();
    expect(canvas.get(embedded.id)).toBeUndefined();
  });

  it('keeps a shared occurrence and its state until the last lease releases', async () => {
    const { session, canvas } = await setup();
    await seedFiles(session, [
      fileFor('target'),
      fileFor('owner', { r1: refCell('r1', 'target') }, ['r1']),
    ]);
    const root = canvas.openFile('owner').occurrence!;
    const embedded = canvas.openRef('owner', 'r1', root.id).occurrence!;
    const releaseEmbedded = canvas.retainOccurrence(embedded.id);
    const fullscreen = canvas.openRef('owner', 'r1', root.id).occurrence!;
    const releaseFullscreen = canvas.retainOccurrence(fullscreen.id);
    const cache = canvas.cacheFor(embedded.id, 'layout');
    cache.set('position', [12, 34]);
    canvas.setView(embedded.id, { camera: { x: 12, y: 34, zoom: 2 } });

    expect(fullscreen).toBe(embedded);
    releaseEmbedded();
    releaseEmbedded();
    expect(canvas.get(embedded.id)).toBe(embedded);
    expect(canvas.get(embedded.id)?.runtime).toBe(fullscreen.runtime);
    expect(canvas.get(embedded.id)?.view.camera).toEqual({
      x: 12,
      y: 34,
      zoom: 2,
    });
    expect(canvas.cacheFor(embedded.id, 'layout')).toBe(cache);
    expect(cache.get('position')).toEqual([12, 34]);
    expect(canvas.active()).toBe(embedded);

    releaseFullscreen();
    expect(canvas.get(embedded.id)).toBeUndefined();
    expect(canvas.active()).toBe(root);
    releaseFullscreen();
    expect(canvas.get(root.id)).toBe(root);
  });

  it('counts leases separately for different appearances of the same reference', async () => {
    const { session, canvas } = await setup();
    await seedFiles(session, [
      fileFor('target'),
      fileFor('owner', { r1: refCell('r1', 'target') }, ['r1']),
    ]);
    const first = canvas.openRef('owner', 'r1').occurrence!;
    const second = canvas.openRef('owner', 'r1', undefined, [
      'board',
      'nested-owner',
      'r1',
    ]).occurrence!;
    const releaseFirst = canvas.retainOccurrence(first.id);
    const releaseSecond = canvas.retainOccurrence(second.id);
    releaseFirst();
    expect(canvas.get(first.id)).toBeUndefined();
    expect(canvas.get(second.id)).toBe(second);
    releaseSecond();
    expect(canvas.occurrences()).toEqual([]);
  });

  it.each(['left', 'right'] as const)(
    'keeps the other nested appearance alive when the %s outer lease closes',
    async (closingSide) => {
      const { session, canvas } = await setup();
      await seedFiles(session, [
        fileFor('target'),
        fileFor('shared', { inner: refCell('inner', 'target') }, ['inner']),
        fileFor(
          'board',
          {
            left: refCell('left', 'shared'),
            right: refCell('right', 'shared'),
          },
          ['left', 'right'],
        ),
      ]);
      const root = canvas.openFile('board').occurrence!;
      const openBranch = (refId: 'left' | 'right') => {
        const outer = canvas.openRef('board', refId, root.id).occurrence!;
        const releaseOuter = canvas.retainOccurrence(outer.id);
        const inner = canvas.openRef(
          'shared',
          'inner',
          outer.id,
          [...outer.appearancePath, 'inner'],
          { activate: false },
        ).occurrence!;
        const releaseInner = canvas.retainOccurrence(inner.id);
        expect(inner.appearancePath).toEqual(['board', refId, 'inner']);
        expect(inner.id).toBe(
          refOccurrenceId('shared', 'inner', ['board', refId, 'inner']),
        );
        expect(inner.parentId).toBe(outer.id);
        expect(inner.fileId).toBe('target');
        return { outer, inner, releaseOuter, releaseInner };
      };
      const left = openBranch('left');
      const right = openBranch('right');
      expect(left.inner).not.toBe(right.inner);
      expect(left.inner.runtime).not.toBe(right.inner.runtime);
      const closing = closingSide === 'left' ? left : right;
      const surviving = closingSide === 'left' ? right : left;
      canvas.setView(surviving.inner.id, { tool: 'hand' });
      const cache = canvas.cacheFor(surviving.inner.id, 'layout');
      cache.set('position', [12, 34]);

      closing.releaseOuter();
      expect(canvas.get(closing.outer.id)).toBeUndefined();
      expect(canvas.get(closing.inner.id)).toBeUndefined();
      // Child cleanup can arrive after its parent's cascading close.
      closing.releaseInner();
      expect(canvas.get(surviving.outer.id)).toBe(surviving.outer);
      expect(canvas.get(surviving.inner.id)).toBe(surviving.inner);
      expect(surviving.inner.view.tool).toBe('hand');
      expect(canvas.cacheFor(surviving.inner.id, 'layout')).toBe(cache);
      expect(cache.get('position')).toEqual([12, 34]);

      surviving.releaseInner();
      expect(canvas.get(surviving.inner.id)).toBeUndefined();
      expect(canvas.get(surviving.outer.id)).toBe(surviving.outer);
      surviving.releaseOuter();
      expect(canvas.occurrences()).toEqual([root]);
    },
  );

  it.each(['self', 'parent'] as const)(
    'invalidates old leases after force-closing the %s and reopening the same id',
    async (closed) => {
      const { session, canvas } = await setup();
      await seedFiles(session, [
        fileFor('target'),
        fileFor('owner', { r1: refCell('r1', 'target') }, ['r1']),
      ]);
      const root = canvas.openFile('owner').occurrence!;
      const embedded = canvas.openRef('owner', 'r1', root.id).occurrence!;
      const releaseOld = canvas.retainOccurrence(embedded.id);
      const releaseOtherOld = canvas.retainOccurrence(embedded.id);
      canvas.close(closed === 'self' ? embedded.id : root.id);
      expect(canvas.get(embedded.id)).toBeUndefined();
      canvas.openFile('owner');
      const replacement = canvas.openRef('owner', 'r1').occurrence!;
      const releaseReplacement = canvas.retainOccurrence(replacement.id);
      expect(replacement.id).toBe(embedded.id);
      expect(replacement).not.toBe(embedded);

      releaseOld();
      releaseOtherOld();
      expect(canvas.get(replacement.id)).toBe(replacement);
      releaseReplacement();
      expect(canvas.get(replacement.id)).toBeUndefined();
    },
  );

  it('does not retain a future occurrence when the id is unavailable', async () => {
    const { session, canvas } = await setup();
    const releaseMissing = canvas.retainOccurrence(rootOccurrenceId('target'));
    await seedFiles(session, [fileFor('target')]);
    const occurrence = canvas.openFile('target').occurrence!;
    const release = canvas.retainOccurrence(occurrence.id);
    releaseMissing();
    releaseMissing();
    expect(canvas.get(occurrence.id)).toBe(occurrence);
    release();
    expect(canvas.get(occurrence.id)).toBeUndefined();
  });

  it('invalidates leases when the session is disposed', async () => {
    const { session, canvas } = await setup();
    await seedFiles(session, [fileFor('target')]);
    const occurrence = canvas.openFile('target').occurrence!;
    const release = canvas.retainOccurrence(occurrence.id);
    canvas.dispose();
    expect(canvas.occurrences()).toEqual([]);
    const replacement = canvas.openFile('target').occurrence!;
    release();
    expect(canvas.get(replacement.id)).toBe(replacement);
  });

  it('writes per-occurrence shell state into the owner file only', async () => {
    const { session, canvas } = await setup();
    await seedFiles(session, [
      fileFor('target'),
      fileFor('owner', { r1: refCell('r1', 'target') }, ['r1']),
    ]);
    const embedded = canvas.openRef('owner', 'r1').occurrence!;
    const result = await canvas.updateRefShell(embedded.id, {
      data: { mindOffsets: { 'mind-1': [12, 34] } },
      geometry: { x: 5, y: 6, width: 400, height: 300 },
    });
    expect(result.ok).toBe(true);
    const owner = session.getState().files.get('owner')?.file;
    const ref = owner?.cells['r1'];
    expect(ref).toMatchObject({
      data: { targetFrameId: 'target', mindOffsets: { 'mind-1': [12, 34] } },
      geometry: { x: 5, y: 6, width: 400, height: 300 },
    });
    // The shared target file is untouched.
    expect(session.getState().files.get('target')?.dirty).toBeFalsy();
    // Root occurrences have no shell to update.
    const root = canvas.openFile('target').occurrence!;
    expect((await canvas.updateRefShell(root.id, {})).ok).toBe(false);
  });

  it('refuses to open an occurrence for a missing or non-reference target', async () => {
    const { session, canvas } = await setup();
    await seedFiles(session, [fileFor('owner')]);
    expect(canvas.openFile('nope').ok).toBe(false);
    const bad = canvas.openRef('owner', 'not-a-ref');
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('Not a frame reference');
  });
});
