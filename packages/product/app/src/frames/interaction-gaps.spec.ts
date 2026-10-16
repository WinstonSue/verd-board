import { describe, expect, it } from 'vitest';
import type { FrameCell, NodeCell } from '@sue/board-core';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import { openWorkspaceSession } from '../session/workspace-session';
import {
  createCanvasSession,
  type CanvasSession,
} from '../canvas/canvas-session';
import {
  assessReferencePlace,
  organizePreviewIsStale,
  type FrameFileV2,
} from '../frames/frame-files';
import {
  planReturnToSource,
  rememberEntrySource,
} from '../session/entry-source';
const frameCell = (id: string, name = id, children: string[] = []): FrameCell =>
  ({
    id,
    kind: 'frame',
    cellType: 'frame',
    name,
    geometry: { x: 0, y: 0, width: 800, height: 500 },
    children,
    groups: [],
  }) as FrameCell;

const file = (id: string, extra: Partial<FrameFileV2> = {}): FrameFileV2 => ({
  format: 'verd-frame',
  version: 2,
  frame: extra.frame ?? frameCell(id),
  cells: extra.cells ?? {},
  ...extra,
});

const mindNode = (id: string): NodeCell => ({
  id,
  kind: 'mind-root',
  cellType: 'node',
  geometry: { x: 0, y: 0, width: 120, height: 40 },
  content: { label: '主题' },
});

const ref = (id: string, targetFrameId: string, locked = false) =>
  ({
    id,
    kind: 'frame-reference',
    cellType: 'node',
    locked: locked || undefined,
    geometry: { x: 10, y: 10, width: 220, height: 140 },
    data: { targetFrameId },
  }) as FrameFileV2['cells'][string];

const sessionFor = async (files: FrameFileV2[]) => {
  const host = createMemoryWorkspaceHost({ now: () => 1_700_000_000_000 });
  const handle = (await host.openWorkspace({ path: `ws-${Math.random()}` }))!;
  const session = await openWorkspaceSession(host, handle, { delayMs: 60_000 });
  for (const item of files)
    await session.apply({ type: 'create-file', file: item });
  return { session, canvas: createCanvasSession({ session }) };
};

const labelOf = (canvas: CanvasSession, id: string) =>
  (canvas.get(id)?.runtime.store.cells.topic as NodeCell | undefined)?.content
    ?.label;

describe('reference instances, place mode, and return source', () => {
  const mind = file('C', {
    organization: { kind: 'subgraph', ownerFrameId: 'A' },
    frame: frameCell('C', '需求脑图', ['topic']),
    cells: { topic: mindNode('topic') },
  });
  const boardA = file('A', {
    organization: { kind: 'standalone' },
    frame: frameCell('A', '产品规划', ['owned']),
    cells: { owned: ref('owned', 'C') },
  });
  const boardB = file('B', {
    organization: { kind: 'standalone' },
    frame: frameCell('B', '迭代复盘', ['r1', 'r2', 'preview']),
    cells: {
      r1: ref('r1', 'C'),
      r2: ref('r2', 'C'),
      preview: ref('preview', 'A'),
    },
  });

  const open = async () => {
    const ready = await sessionFor([boardA, boardB, mind]);
    ready.canvas.openFile('A');
    ready.canvas.openFile('B');
    ready.canvas.openFile('C');
    return ready;
  };

  it('keeps selection, hover, and mind offsets per reference while content syncs', async () => {
    const { session, canvas } = await open();
    const own = canvas.get('file:C')!;
    const first = canvas.openRef('B', 'r1', 'file:B', ['B', 'r1']).occurrence!;
    const second = canvas.openRef('B', 'r2', 'file:B', ['B', 'r2']).occurrence!;
    first.runtime.select({ focus: ['C'], ids: ['topic'] });
    canvas.setView(first.id, { hover: 'topic' });
    expect(second.runtime.selection.ids).toEqual([]);
    expect(canvas.get(second.id)?.view.hover).toBeNull();
    expect(canvas.get(first.id)?.view.hover).toBe('topic');

    const edited = await canvas.dispatch(first.id, {
      id: 'rename',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...mindNode('topic'), content: { label: '已同步' } },
        },
      ],
    });
    expect(edited.ok).toBe(true);
    expect(labelOf(canvas, first.id)).toBe('已同步');
    expect(labelOf(canvas, second.id)).toBe('已同步');
    expect(labelOf(canvas, own.id)).toBe('已同步');
    expect(first.runtime.selection.ids).toEqual(['topic']);
    expect(second.runtime.selection.ids).toEqual([]);
    await canvas.undo();
    expect(labelOf(canvas, first.id)).toBe('主题');
    expect(labelOf(canvas, second.id)).toBe('主题');
    expect(labelOf(canvas, own.id)).toBe('主题');
    await canvas.redo();

    const shellA = await canvas.updateRefShell(first.id, {
      data: { mindOffsets: { topic: [12, 8] } },
    });
    const shellB = await canvas.updateRefShell(second.id, {
      data: { mindOffsets: { topic: [1, 2] } },
    });
    expect(shellA.ok).toBe(true);
    expect(shellB.ok).toBe(true);
    const owner = session.getState().files.get('B')!.file;
    expect(
      owner.cells.r1 &&
        (owner.cells.r1 as { data: { mindOffsets?: unknown } }).data
          .mindOffsets,
    ).toEqual({
      topic: [12, 8],
    });
    expect(
      owner.cells.r2 &&
        (owner.cells.r2 as { data: { mindOffsets?: unknown } }).data
          .mindOffsets,
    ).toEqual({
      topic: [1, 2],
    });
    expect(
      (session.getState().files.get('C')!.file.cells.topic as NodeCell).data,
    ).toBeUndefined();

    expect(session.getState().canUndo).toBe(true);
  });

  it('rejects preview, locked, and read-only writes without moving history', async () => {
    const { session, canvas } = await open();
    const preview = canvas.openRef('B', 'preview', 'file:B', [
      'B',
      'preview',
    ]).occurrence!;
    expect(preview.contentReadonly).toBe(true);
    const before = session.getState().canUndo;
    const blocked = await canvas.dispatch(preview.id, {
      id: 'preview-edit',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...frameCell('A', '改了'), children: ['owned'], groups: [] },
        },
      ],
    });
    expect(blocked.ok).toBe(false);
    expect(session.getState().files.get('A')!.file.frame.name).toBe('产品规划');
    expect(session.getState().canUndo).toBe(before);
    const shell = await canvas.updateRefShell(preview.id, {
      geometry: { x: 30, y: 30, width: 240, height: 160 },
    });
    expect(shell.ok).toBe(true);

    const locked = file('L', {
      frame: frameCell('L', 'L', ['lock']),
      cells: { lock: ref('lock', 'C', true) },
    });
    await session.apply({ type: 'create-file', file: locked });
    canvas.openFile('L');
    const lockedRef = canvas.openRef('L', 'lock').occurrence!;
    const denied = await canvas.dispatch(lockedRef.id, {
      id: 'locked',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...mindNode('topic'), content: { label: 'no' } },
        },
      ],
    });
    expect(denied.ok).toBe(false);
    expect(labelOf(canvas, 'file:C')).toBe('主题');

    const grouped = file('G', {
      frame: {
        ...frameCell('G', 'G', ['inside', 'beside']),
        groups: ['group'],
      },
      cells: {
        group: {
          id: 'group',
          kind: 'group',
          cellType: 'group',
          locked: true,
          members: ['inside', 'beside'],
        } as FrameFileV2['cells'][string],
        inside: ref('inside', 'C'),
        beside: ref('beside', 'C'),
      },
    });
    const created = await session.apply({ type: 'create-file', file: grouped });
    expect(
      created.ok,
      created.diagnostics.map((item) => item.message).join('; '),
    ).toBe(true);
    canvas.openFile('G');
    const opened = canvas.openRef('G', 'inside');
    expect(opened.ok, opened.message).toBe(true);
    const inside = opened.occurrence!;
    const groupDenied = await canvas.dispatch(inside.id, {
      id: 'group-lock',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...mindNode('topic'), content: { label: 'nope' } },
        },
      ],
    });
    expect(groupDenied.ok).toBe(false);

    const undoBeforeReadonly = session.getState().canUndo;
    session.setReadonly(true);
    const readonlyResult = await canvas.dispatch(canvas.get('file:C')!.id, {
      id: 'readonly',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...mindNode('topic'), content: { label: 'blocked' } },
        },
      ],
    });
    expect(readonlyResult.ok).toBe(false);
    expect(labelOf(canvas, 'file:C')).toBe('主题');
    expect(session.getState().canUndo).toBe(undoBeforeReadonly);
  });

  it('leaves runtime and history unchanged when a commit is rejected', async () => {
    const { session, canvas } = await open();
    const occurrence = canvas.get('file:C')!;
    const beforeStore = JSON.stringify(occurrence.runtime.store);
    const beforeUndo = session.getState().canUndo;
    const rejected = await canvas.dispatch(occurrence.id, {
      id: 'drop-anchor',
      operations: [{ type: 'remove_cell', cellId: 'topic' }],
    });
    expect(rejected.ok).toBe(false);
    expect(JSON.stringify(occurrence.runtime.store)).toBe(beforeStore);
    expect(session.getState().files.get('C')!.file.cells.topic).toBeTruthy();
    expect(session.getState().canUndo).toBe(beforeUndo);
  });

  it('refuses a missing target or a cycle before a reference shell is inserted', async () => {
    const files = [boardA, boardB, mind];
    expect(assessReferencePlace(files, 'B', 'missing')).toBe(
      '引用目标已不存在',
    );
    expect(assessReferencePlace(files, 'C', 'A')).toMatch(/cycle/i);
    const { session } = await sessionFor(files);
    const undo = session.getState().canUndo;
    const cells = session.getState().files.get('C')!.file.cells;
    expect(
      assessReferencePlace(
        [...session.getState().files.values()].map((entry) => entry.file),
        'C',
        'missing',
      ),
    ).toBe('引用目标已不存在');
    expect(session.getState().canUndo).toBe(undo);
    expect(session.getState().files.get('C')!.file.cells).toEqual(cells);
  });

  it('refreshes a stale organize row and commits one history entry', async () => {
    const { session } = await sessionFor([
      file('A', { organization: { kind: 'standalone' } }),
      file('C', {
        frame: frameCell('C', 'C', ['topic']),
        cells: { topic: mindNode('topic') },
      }),
    ]);
    expect(organizePreviewIsStale(['A'], ['A', 'B'], false)).toBe(true);
    expect(organizePreviewIsStale([], [], false)).toBe(false);
    expect(organizePreviewIsStale([], [], true)).toBe(true);
    const undo = session.getState().canUndo;
    const organized = await session.organize([
      {
        fileId: 'C',
        organization: { kind: 'subgraph', ownerFrameId: 'A' },
        basisOrganization: null,
        basisSources: [],
      },
    ]);
    expect(organized.ok).toBe(true);
    expect(session.getState().canUndo).toBe(true);
    await session.undo();
    expect(
      session.getState().files.get('C')!.file.organization,
    ).toBeUndefined();
    expect(session.getState().canUndo).toBe(undo);
  });

  it('keeps return-to-source in memory and drops a deleted source', () => {
    const sources = new Map();
    rememberEntrySource(sources, 'C', {
      sourceFileId: 'B',
      refId: 'r1',
      occurrenceId: 'ref:B/r1',
    });
    rememberEntrySource(sources, 'C', {
      sourceFileId: 'A',
      refId: 'owned',
      occurrenceId: 'ref:A/owned',
    });
    expect(sources.get('C')?.refId).toBe('owned');
    rememberEntrySource(sources, 'C');
    expect(sources.has('C')).toBe(false);
    expect(
      planReturnToSource(
        { sourceFileId: 'B', refId: 'r1', occurrenceId: 'ref:B/r1' },
        true,
        false,
      ),
    ).toEqual({ type: 'missing-shell', fileId: 'B' });
    expect(
      planReturnToSource(
        { sourceFileId: 'gone', refId: 'r1', occurrenceId: 'x' },
        false,
        false,
      ).type,
    ).toBe('drop');
    expect(
      planReturnToSource(
        { sourceFileId: 'B', refId: 'r1', occurrenceId: 'ref:B/r1' },
        true,
        true,
      ),
    ).toEqual({ type: 'reveal', fileId: 'B', cellId: 'r1' });
    const persisted = {
      tabs: [],
      activeTabId: null,
      expandedDirs: [],
    };
    expect(JSON.stringify(persisted)).not.toContain('sourceFileId');
  });

  it('reloads a new canvas, its owned mind, and references without a conflict', async () => {
    const host = createMemoryWorkspaceHost({ now: () => 1_700_000_000_000 });
    const handle = (await host.openWorkspace({ path: 'ws-reload' }))!;
    const session = await openWorkspaceSession(host, handle, {
      delayMs: 60_000,
    });
    const nameless = (id: string, children: string[] = []): FrameFileV2 => ({
      format: 'verd-frame',
      version: 2,
      frame: {
        id,
        kind: 'frame',
        cellType: 'frame',
        geometry: { x: 0, y: 0, width: 960, height: 640 },
        children,
        groups: [],
      } as FrameCell,
      cells: {},
    });
    expect(
      (await session.apply({ type: 'create-file', file: nameless('legacy') }))
        .ok,
    ).toBe(true);
    expect(session.getState().files.get('legacy')?.path).toBe(
      '未命名画布.verd.json',
    );
    const created = await session.apply({
      type: 'create-file',
      file: nameless('A'),
      path: '未命名画布.verd.json',
    });
    expect(created.ok).toBe(true);
    const canvasA = session.getState().files.get('A');
    expect(canvasA?.path).toBe('未命名画布 2.verd.json');
    expect(canvasA?.conflicted).toBeFalsy();
    const mind = nameless('C', ['topic']);
    mind.organization = { kind: 'subgraph', ownerFrameId: 'A' };
    mind.cells = { topic: mindNode('topic') };
    const board = nameless('B', ['r1', 'r2', 'preview']);
    board.cells = {
      r1: ref('r1', 'C'),
      r2: ref('r2', 'C'),
      preview: ref('preview', 'A'),
    };
    expect((await session.apply({ type: 'create-file', file: mind })).ok).toBe(
      true,
    );
    expect((await session.apply({ type: 'create-file', file: board })).ok).toBe(
      true,
    );
    expect(await session.flush()).toBe(true);
    session.dispose();
    const reloaded = await openWorkspaceSession(host, handle, {
      delayMs: 60_000,
    });
    const files = reloaded.getState().files;
    expect(files.get('A')?.conflicted).toBeFalsy();
    expect(files.get('B')?.conflicted).toBeFalsy();
    expect(files.get('C')?.conflicted).toBeFalsy();
    expect(files.get('C')?.file.organization).toEqual({
      kind: 'subgraph',
      ownerFrameId: 'A',
    });
    expect(files.get('B')?.file.cells.r1).toMatchObject({
      data: { targetFrameId: 'C' },
    });
    expect(files.get('B')?.file.cells.r2).toMatchObject({
      data: { targetFrameId: 'C' },
    });
    expect(files.get('B')?.file.cells.preview).toMatchObject({
      data: { targetFrameId: 'A' },
    });
    expect(files.get('A')?.file.frame.id).toBe('A');
    reloaded.dispose();
  });
});
