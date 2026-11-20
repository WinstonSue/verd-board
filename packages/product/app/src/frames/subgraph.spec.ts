import { describe, expect, it } from 'vitest';
import type { CellStore, FrameCell, NodeCell } from '@sue/board-core';
import { createMemoryWorkspaceHost } from '@sue/verd-board-workspace';
import { createCanvasSession } from '../canvas/canvas-session';
import { openWorkspaceSession } from '@sue/verd-board-workspace';
import {
  duplicateFrameClosure,
  frameClosure,
  frameExportBundle,
  frameExportRootId,
  parseFrameExport,
  sameFrameContent,
  sameFrameFile,
  type FrameFileV2,
} from '@sue/verd-board-workspace';

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

const file = (
  id: string,
  extra: Partial<FrameFileV2> = {},
  children: string[] = [],
): FrameFileV2 => ({
  format: 'verd-frame',
  version: 2,
  frame: frameCell(id, id, children),
  cells: {},
  ...extra,
});

const mindNode = (id: string): NodeCell => ({
  id,
  kind: 'mind-root',
  cellType: 'node',
  geometry: { x: 0, y: 0, width: 120, height: 40 },
});

const ref = (id: string, targetFrameId: string) =>
  ({
    id,
    kind: 'frame-reference',
    cellType: 'node',
    geometry: { x: 10, y: 10, width: 200, height: 120 },
    data: { targetFrameId },
  }) as FrameFileV2['cells'][string];

const sessionFor = async (files: FrameFileV2[] = []) => {
  const host = createMemoryWorkspaceHost({ now: () => 1_700_000_000_000 });
  const handle = (await host.openWorkspace({ path: `ws-${Math.random()}` }))!;
  const session = await openWorkspaceSession(host, handle, { delayMs: 60_000 });
  for (const item of files)
    await session.apply({ type: 'create-file', file: item });
  return { host, handle, session };
};

describe('frame organization', () => {
  it('compares organization separately from canvas content', () => {
    const left = file('a', { organization: { kind: 'standalone' } });
    const right = file('a', {
      organization: { kind: 'subgraph', ownerFrameId: 'b' },
    });
    expect(sameFrameContent(left, right)).toBe(true);
    expect(sameFrameFile(left, right)).toBe(false);
  });

  it('reads old bundles and records an optional root id', () => {
    const bundle = frameExportBundle([file('a'), file('b')], 'b');
    const parsed = parseFrameExport(JSON.parse(JSON.stringify(bundle)))!;
    expect(frameExportRootId(bundle, parsed)).toBe('b');
    const legacy = {
      format: 'verd-canvas-bundle',
      version: 1,
      files: [file('a')],
    };
    expect(frameExportRootId(legacy, parseFrameExport(legacy)!)).toBe('a');
  });
});

describe('subgraph editing', () => {
  it('syncs one mind across its canvas, two references, and its own tab', async () => {
    const { host, handle, session } = await sessionFor([
      file('A', { organization: { kind: 'standalone' } }, []),
      file('B', { organization: { kind: 'standalone' } }),
    ]);
    const nested: CellStore = {
      rootId: 'A',
      cells: {
        A: frameCell('A', 'A', ['C']),
        C: {
          ...frameCell('C', '需求脑图', ['topic']),
          geometry: { x: 30, y: 30, width: 320, height: 200 },
        },
        topic: mindNode('topic'),
      },
    };
    const created = await session.apply({
      type: 'edit-file',
      sourceFileId: 'A',
      store: nested,
      label: 'create-mind',
    });
    expect(created.ok).toBe(true);
    const mindId = [...session.getState().files.keys()].find(
      (id) => id !== 'A' && id !== 'B',
    )!;
    expect(
      session.getState().files.get(mindId)?.file.organization,
    ).toBeUndefined();
    expect(
      Object.values(session.getState().files.get('A')!.file.cells).some(
        (cell) => cell.cellType === 'frame',
      ),
    ).toBe(false);
    const before = session.getState().canUndo;

    const place = (id: string, x: number) =>
      ({
        ...ref(id, mindId),
        geometry: { x, y: 40, width: 220, height: 140 },
      }) as FrameFileV2['cells'][string];
    const boardB = session.getState().files.get('B')!.file;
    const placed = await session.apply({
      type: 'file',
      file: {
        ...boardB,
        frame: { ...boardB.frame, children: ['r1', 'r2', 'preview'] },
        cells: {
          r1: place('r1', 10),
          r2: place('r2', 260),
          preview: ref('preview', 'A'),
        },
      },
    });
    expect(placed.ok).toBe(true);
    expect(
      session.getState().files.get(mindId)!.file.organization,
    ).toBeUndefined();

    const canvas = createCanvasSession({ session });
    canvas.openFile('A');
    canvas.openFile('B');
    const own = canvas.openFile(mindId).occurrence!;
    const first = canvas.openRef('B', 'r1').occurrence!;
    const second = canvas.openRef('B', 'r2').occurrence!;
    expect(first.id).not.toBe(second.id);
    expect(first.appearancePath).toEqual(['B', 'r1']);
    first.runtime.select({ focus: [mindId], ids: ['topic'] });
    second.view.hover = 'topic';
    const edited = await canvas.dispatch(own.id, {
      id: 'rename-topic',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...mindNode('topic'),
            content: { label: '范围' },
          },
        },
      ],
    });
    expect(edited.ok).toBe(true);
    const labelOf = (occurrence: { runtime: { store: CellStore } }) =>
      (occurrence.runtime.store.cells.topic as NodeCell).content?.label;
    expect(labelOf(own)).toBe('范围');
    expect(labelOf(first)).toBe('范围');
    expect(labelOf(second)).toBe('范围');
    expect(first.runtime.selection.ids).toEqual(['topic']);
    expect(second.runtime.selection.ids).toEqual([]);
    expect(second.view.hover).toBe('topic');
    expect(session.getState().canUndo).toBe(true);
    await canvas.undo();
    expect(labelOf(first)).toBeUndefined();
    expect(labelOf(own)).toBeUndefined();
    expect(session.getState().canRedo).toBe(true);
    await canvas.redo();
    expect(labelOf(second)).toBe('范围');

    const preview = canvas.openRef('B', 'preview').occurrence!;
    expect(preview.contentReadonly).toBe(true);
    const blocked = await canvas.dispatch(preview.id, {
      id: 'nope',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...frameCell('A'), name: 'changed' },
        },
      ],
    });
    expect(blocked.ok).toBe(false);
    expect(session.getState().files.get('A')!.file.frame.name).toBe('A');
    const shell = await canvas.updateRefShell(preview.id, {
      geometry: { x: 12, y: 12, width: 240, height: 160 },
    });
    expect(shell.ok).toBe(true);

    await session.flush();
    const reopened = await openWorkspaceSession(host, handle, {
      delayMs: 60_000,
    });
    const savedMind = reopened.getState().files.get(mindId)!.file;
    expect(savedMind.organization).toBeUndefined();
    expect((savedMind.cells.topic as NodeCell).content?.label).toBe('范围');
    const savedB = reopened.getState().files.get('B')!.file;
    expect(savedB.cells.r1).toBeTruthy();
    expect(savedB.cells.r2).toBeTruthy();
    expect(savedB.cells.preview).toBeTruthy();
    expect(before).toBe(true);
  });
});

it('ignores legacy ownership in copy/export and keeps sources after references or parents are removed', async () => {
  const board = file('owner', {
    frame: frameCell('owner', 'Owner', ['embed']),
    cells: { embed: ref('embed', 'shared') },
  });
  const shared = file('shared', {
    organization: { kind: 'subgraph', ownerFrameId: 'owner' },
  });
  const orphan = file('orphan', {
    organization: { kind: 'subgraph', ownerFrameId: 'owner' },
  });
  expect(frameClosure([board, shared, orphan], 'owner')).toEqual([
    'owner',
    'shared',
  ]);
  let n = 0;
  const copy = duplicateFrameClosure(
    [board, shared, orphan],
    'owner',
    () => 'copy-' + ++n,
  );
  expect(copy.files).toHaveLength(2);
  expect(copy.files.every((file) => file.organization === undefined)).toBe(
    true,
  );
  const { session } = await sessionFor([board, shared, orphan]);
  expect(session.exportFiles('owner').map((file) => file.frame.id)).toEqual([
    'owner',
    'shared',
  ]);
  expect(
    (
      await session.apply({
        type: 'file',
        file: { ...board, frame: { ...board.frame, children: [] }, cells: {} },
      })
    ).ok,
  ).toBe(true);
  expect(session.getState().files.has('shared')).toBe(true);
  expect(
    (await session.apply({ type: 'trash-file', fileId: 'owner' })).ok,
  ).toBe(true);
  expect(session.getState().files.has('shared')).toBe(true);
  expect(session.getState().files.has('orphan')).toBe(true);
  session.dispose();
});

it('reads legacy organization as inert data without rewriting unrelated files on open or edit', async () => {
  const host = createMemoryWorkspaceHost();
  const handle = (await host.openWorkspace({ path: 'legacy-inert' }))!;
  const a = file('legacy-a', {
    organization: { kind: 'subgraph', ownerFrameId: 'missing' },
  });
  const b = file('legacy-b', { organization: { kind: 'standalone' } });
  const bytes = JSON.stringify(b);
  await host.commit(handle, {
    transactionId: 'legacy-source',
    writes: [
      {
        path: 'a.verd',
        content: JSON.stringify(a),
        expectedVersion: null,
      },
      { path: 'b.verd', content: bytes, expectedVersion: null },
    ],
  });
  const session = await openWorkspaceSession(host, handle);
  expect(session.getState().diagnostics).toEqual([]);
  expect(
    session.getState().files.get('legacy-a')?.file.organization,
  ).toBeUndefined();
  expect(await session.flush()).toBe(true);
  expect(
    new TextDecoder().decode((await host.readFile(handle, 'b.verd')).content),
  ).toBe(bytes);
  await session.apply({
    type: 'file',
    file: { ...a, frame: { ...a.frame, name: 'Edited' } },
  });
  expect(await session.flush()).toBe(true);
  expect(
    JSON.parse(
      new TextDecoder().decode((await host.readFile(handle, 'a.verd')).content),
    ).organization,
  ).toBeUndefined();
  expect(
    new TextDecoder().decode((await host.readFile(handle, 'b.verd')).content),
  ).toBe(bytes);
  session.dispose();
});
