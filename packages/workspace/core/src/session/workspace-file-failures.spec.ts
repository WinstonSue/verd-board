import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCellRuntime, createFrameCell } from '@sue/board-core';
import {
  createWorkflowStartCell,
  createWorkflowTaskCell,
} from '@sue/board-workflow';
import { createDocumentFile } from '../documents/document-files';
import { createFrameFile, type FrameFileV2 } from '../frames/frame-files';
import { createWorkspaceCellRegistry } from '../frames/plugins';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import {
  openWorkspaceSession,
  type WorkspaceSession,
} from './workspace-session';

const sessions: WorkspaceSession[] = [];
afterEach(() => sessions.splice(0).forEach((session) => session.dispose()));
const board = (id = 'good') => createFrameFile(createFrameCell(id));
const workflow = (broken = false): FrameFileV2 => {
  const file = board('flow');
  const start = createWorkflowStartCell('start');
  const task = createWorkflowTaskCell('task');
  start.data!.memberIds.push('task');
  if (broken) {
    task.data = start.data;
    delete start.data;
  }
  return {
    ...file,
    frame: { ...file.frame, children: ['start', 'task'] },
    cells: { start, task },
  };
};

async function setup(seed: Record<string, unknown>) {
  const host = createMemoryWorkspaceHost();
  const handle = (await host.openWorkspace({ path: 'failures' }))!;
  let sequence = 0;
  const write = async (path: string, content: unknown) => {
    const raw = await host.readFile(handle, path).catch(() => null);
    const receipt = await host.commit(handle, {
      transactionId: `write-${++sequence}`,
      writes: [
        {
          path,
          content:
            typeof content === 'string' ? content : JSON.stringify(content),
          expectedVersion: raw?.version ?? null,
        },
      ],
    });
    expect(receipt.outcome).toBe('applied');
  };
  for (const [path, file] of Object.entries(seed)) await write(path, file);
  const session = await openWorkspaceSession(host, handle, { delayMs: 60_000 });
  sessions.push(session);
  const assertRuntime = () =>
    expect(() =>
      createCellRuntime(
        { store: session.getState().store },
        createWorkspaceCellRegistry(),
      ),
    ).not.toThrow();
  return { host, handle, session, write, assertRuntime };
}

describe('workspace file failure isolation', () => {
  it('isolates the original workflow failure and unreadable JSON without changing disk bytes', async () => {
    const { host, handle, session, assertRuntime } = await setup({
      'good.verd': board(),
      'flow.verd': workflow(true),
      'broken.verd-doc.json': '{ unfinished',
    });
    const state = session.getState();
    expect([...state.files.keys()]).toEqual(['good']);
    expect(state.failedFiles.get('flow.verd')?.fileId).toBe('flow');
    expect(
      state.failedFiles
        .get('flow.verd')
        ?.diagnostics.map((issue) => issue.message)
        .join(';'),
    ).toContain('Invalid workflow anchor');
    expect(
      state.failedFiles.get('broken.verd-doc.json')?.fileId,
    ).toBeUndefined();
    assertRuntime();
    expect(
      (
        await session.apply({
          type: 'file',
          file: {
            ...board(),
            frame: { ...board().frame, name: 'Edited normally' },
          },
        })
      ).ok,
    ).toBe(true);
    expect(await session.flush()).toBe(true);
    expect(
      new TextDecoder().decode(
        (await host.readFile(handle, 'flow.verd')).content,
      ),
    ).toBe(JSON.stringify(workflow(true)));
    expect(
      new TextDecoder().decode(
        (await host.readFile(handle, 'broken.verd-doc.json')).content,
      ),
    ).toBe('{ unfinished');
  });

  it('quarantines a clean external update and recovers after a valid external repair', async () => {
    const { session, write, assertRuntime } = await setup({
      'good.verd': board(),
      'flow.verd': workflow(),
    });
    await write('flow.verd', workflow(true));
    await session.syncFromHost();
    expect(session.getState().files.has('flow')).toBe(false);
    expect(session.getState().files.has('good')).toBe(true);
    assertRuntime();
    await write('flow.verd', workflow());
    await session.syncFromHost();
    expect(session.getState().files.has('flow')).toBe(true);
    expect(session.getState().failedFiles.size).toBe(0);
    expect(session.getState().diagnostics).toEqual([]);
    assertRuntime();
  });

  it('remembers a known identity when JSON breaks, but does not invent one for a new file', async () => {
    const { session, write } = await setup({
      'note.verd-doc.json': createDocumentFile('note'),
    });
    await write('note.verd-doc.json', '{ half-written');
    await session.syncFromHost();
    expect(
      session.getState().failedFiles.get('note.verd-doc.json')?.fileId,
    ).toBe('note');
    await write('note.verd-doc.json', '{ still writing');
    await session.syncFromHost();
    expect(
      session.getState().failedFiles.get('note.verd-doc.json')?.fileId,
    ).toBe('note');
    await write('note.verd-doc.json', createDocumentFile('note'));
    await session.syncFromHost();
    expect(session.getState().documents.has('note')).toBe(true);
    expect(session.getState().failedFiles.size).toBe(0);
    expect(session.getState().diagnostics).toEqual([]);
  });

  it('does not delay external failure detection behind queued navigation metadata', async () => {
    const { session, write } = await setup({ 'flow.verd': workflow() });
    session.setSessionState({
      tabs: [{ fileId: 'flow' }],
      activeTabId: 'flow',
      expandedDirs: [],
    });
    await write('flow.verd', workflow(true));
    await vi.waitFor(() =>
      expect(session.getState().failedFiles.has('flow.verd')).toBe(true),
    );
    expect(session.getState().session.activeTabId).toBe('flow');
  });

  it('keeps unsaved content and history, and refuses to load invalid disk content', async () => {
    const { session, write, assertRuntime } = await setup({
      'good.verd': board(),
    });
    const local = board();
    local.frame.name = 'Unsaved local';
    await session.apply({ type: 'file', file: local });
    const before = session.getState().files.get('good')?.file;
    await write('good.verd', {
      ...board(),
      cells: {
        missingGeometry: {
          id: 'missingGeometry',
          kind: 'geometry',
          cellType: 'node',
        },
      },
    });
    await session.syncFromHost();
    expect(session.getState().files.get('good')?.file).toBe(before);
    expect(session.getState().files.get('good')?.conflicted).toBe(true);
    expect(session.getState().canUndo).toBe(true);
    expect((await session.resolveConflict('good', 'load-disk')).ok).toBe(false);
    expect(session.getState().files.get('good')?.file).toBe(before);
    assertRuntime();
    expect((await session.resolveConflict('good', 'keep-local')).ok).toBe(true);
    expect(session.getState().failedFiles.size).toBe(0);
    expect(session.getState().files.get('good')?.file.frame.name).toBe(
      'Unsaved local',
    );
  });

  it('reserves unavailable file identities and paths for creates, moves and imports', async () => {
    const { session, assertRuntime } = await setup({
      'flow.verd': workflow(true),
      'good.verd': board(),
    });
    expect(
      (
        await session.apply({
          type: 'create-file',
          file: board('other'),
          path: 'flow.verd',
        })
      ).ok,
    ).toBe(true);
    expect(session.getState().files.get('other')?.path).not.toBe('flow.verd');
    expect(
      (await session.apply({ type: 'create-file', file: board('flow') })).ok,
    ).toBe(false);
    expect(
      (
        await session.apply({
          type: 'move-file',
          fileId: 'good',
          toPath: 'flow.verd',
        })
      ).ok,
    ).toBe(false);
    const doc = createDocumentFile('doc', 'flow');
    expect(
      (
        await session.apply({
          type: 'create-file',
          file: doc,
          path: 'flow.verd',
        })
      ).ok,
    ).toBe(true);
    expect(session.getState().documents.get('doc')?.path).not.toBe('flow.verd');
    expect(
      (await session.apply({ type: 'import-files', files: [workflow()] })).ok,
    ).toBe(true);
    expect(session.getState().files.has('flow')).toBe(false);
    expect(session.getState().failedFiles.has('flow.verd')).toBe(true);
    assertRuntime();
  });

  it('quarantines both sides of an identity collision while unrelated files remain usable', async () => {
    const { session, assertRuntime } = await setup({
      'a.verd': board('duplicate'),
      'b.verd': board('duplicate'),
      'good.verd': board(),
    });
    expect([...session.getState().files.keys()]).toEqual(['good']);
    expect([...session.getState().failedFiles.keys()].sort()).toEqual([
      'a.verd',
      'b.verd',
    ]);
    assertRuntime();
  });

  it('does not reintroduce broken data when restoring a folder or replaying its history', async () => {
    const { session, host, handle, assertRuntime } = await setup({
      'docs/flow.verd': workflow(true),
      'good.verd': board(),
    });
    expect(
      (await session.apply({ type: 'trash-directory', path: 'docs' })).ok,
    ).toBe(true);
    expect(session.getState().failedFiles.size).toBe(0);
    const entryId = session.getState().trash[0].entryId;
    expect((await session.apply({ type: 'restore-file', entryId })).ok).toBe(
      true,
    );
    expect(session.getState().failedFiles.has('docs/flow.verd')).toBe(true);
    assertRuntime();
    expect((await session.undo()).ok).toBe(true);
    expect(session.getState().failedFiles.size).toBe(0);
    expect((await session.redo()).ok).toBe(true);
    assertRuntime();
    expect(
      new TextDecoder().decode(
        (await host.readFile(handle, 'docs/flow.verd')).content,
      ),
    ).toBe(JSON.stringify(workflow(true)));
  });

  it('rejects an incoming file that collides only with unsaved local cells', async () => {
    const { session, write, assertRuntime } = await setup({
      'good.verd': board(),
    });
    const local = board();
    local.frame.children = ['local-reference'];
    local.cells['local-reference'] = {
      id: 'local-reference',
      kind: 'frame-reference',
      cellType: 'node',
      geometry: { x: 0, y: 0, width: 10, height: 10 },
      data: { targetFrameId: 'absent' },
    };
    expect((await session.apply({ type: 'file', file: local })).ok).toBe(true);
    await write('incoming.verd', board('local-reference'));
    await session.syncFromHost();
    expect(session.getState().files.get('good')?.dirty).toBe(true);
    expect(session.getState().failedFiles.has('incoming.verd')).toBe(true);
    expect(session.getState().files.has('local-reference')).toBe(false);
    assertRuntime();
  });

  it('keeps unrelated edits saveable while a duplicate identity conflicts with a dirty local file', async () => {
    const { session, host, handle, write, assertRuntime } = await setup({
      'good.verd': board(),
      'other.verd': board('other'),
    });
    const local = board();
    local.frame.name = 'Unsaved';
    await session.apply({ type: 'file', file: local });
    await write('copy.verd', board());
    await session.syncFromHost();
    const other = board('other');
    other.frame.name = 'Still saves';
    expect((await session.apply({ type: 'file', file: other })).ok).toBe(true);
    await session.flush();
    expect(
      new TextDecoder().decode(
        (await host.readFile(handle, 'other.verd')).content,
      ),
    ).toContain('Still saves');
    assertRuntime();
  });

  it('contains a validator exception and an unknown kind to their respective files', async () => {
    const malformed = board('malformed');
    malformed.cells.bad = {
      id: 'bad',
      cellType: 'node',
      kind: 'rectangle',
    } as never;
    malformed.frame.children.push('bad');
    const unknown = board('unknown');
    unknown.cells.unsupported = {
      id: 'unsupported',
      cellType: 'node',
      kind: 'future-plugin',
      geometry: { x: 0, y: 0, width: 1, height: 1 },
    } as never;
    unknown.frame.children.push('unsupported');
    const { session, assertRuntime } = await setup({
      'bad.verd': malformed,
      'unknown.verd': unknown,
      'good.verd': board(),
    });
    expect(session.getState().failedFiles.size).toBe(2);
    expect([...session.getState().files.keys()]).toEqual(['good']);
    assertRuntime();
  });
});
