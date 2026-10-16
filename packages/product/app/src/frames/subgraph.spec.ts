import { describe, expect, it } from 'vitest';
import type { CellStore, FrameCell, NodeCell } from '@sue/board-core';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import { createCanvasSession } from '../canvas/canvas-session';
import { openWorkspaceSession } from '../session/workspace-session';
import {
  buildOrganizationIndex,
  duplicateFrameClosure,
  frameClosure,
  frameExportBundle,
  frameExportRootId,
  isFrameFileV2,
  parseFrameExport,
  partitionCellStore,
  recommendOrganization,
  remapImportedFiles,
  sameFrameContent,
  sameFrameFile,
  type FrameFileV2,
} from './frame-files';

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
  it('keeps a missing organization as a legacy independent entry', () => {
    const index = buildOrganizationIndex([file('a'), file('mind')]);
    expect(index.byFile.get('a')?.placement).toEqual({ kind: 'legacy' });
    expect(index.legacy).toContain('a');
    expect(index.unorganized).not.toContain('a');
  });

  it('attaches a subgraph and keeps a missing owner id', () => {
    const mind = file('c', {
      organization: { kind: 'subgraph', ownerFrameId: 'gone' },
      cells: { topic: mindNode('topic') },
      frame: frameCell('c', 'c', ['topic']),
    });
    const index = buildOrganizationIndex([file('a'), mind]);
    expect(index.byFile.get('c')?.placement).toEqual({
      kind: 'unorganized',
      retainedOwnerId: 'gone',
    });
    expect(mind.organization).toEqual({
      kind: 'subgraph',
      ownerFrameId: 'gone',
    });
  });

  it('does not rewrite an invalid organization on read', () => {
    const raw = {
      format: 'verd-frame',
      version: 2,
      organization: { kind: 'nope' },
      frame: frameCell('mind', 'mind', ['topic']),
      cells: { topic: mindNode('topic') },
    };
    expect(isFrameFileV2(raw)).toBe(true);
    const index = buildOrganizationIndex([raw]);
    expect(index.byFile.get('mind')?.placement.kind).toBe('unorganized');
    expect(index.diagnostics.some((item) => item.frameId === 'mind')).toBe(
      true,
    );
    expect(raw.organization).toEqual({ kind: 'nope' });
    const canvas = {
      ...file('board'),
      organization: { kind: 'subgraph', ownerFrameId: 'other' },
    } as FrameFileV2;
    const canvasIndex = buildOrganizationIndex([canvas, file('other')]);
    expect(canvasIndex.byFile.get('board')?.placement.kind).toBe('legacy');
    expect(canvas.organization?.kind).toBe('subgraph');
  });

  it('preserves organization by id and does not auto-own imports', () => {
    const existing = new Map<string, FrameFileV2>([
      ['board', file('board', { organization: { kind: 'standalone' } })],
    ]);
    const nested: CellStore = {
      rootId: 'board',
      cells: {
        board: frameCell('board', 'board', ['mind']),
        mind: {
          ...frameCell('mind', 'mind', ['topic']),
          geometry: { x: 40, y: 40, width: 300, height: 200 },
        },
        topic: mindNode('topic'),
      },
    };
    const created = partitionCellStore(nested, {
      existing,
      creationOwnerId: 'board',
    });
    const mind = created.files.find((item) => item.frame.id === 'mind')!;
    const board = created.files.find((item) => item.frame.id === 'board')!;
    expect(board.organization).toEqual({ kind: 'standalone' });
    expect(mind.organization).toEqual({
      kind: 'subgraph',
      ownerFrameId: 'board',
    });
    expect(
      Object.values(board.cells).some((cell) => cell.cellType === 'frame'),
    ).toBe(false);
    expect(created.owners.get('mind')).toBe('board');
    const imported = partitionCellStore(nested);
    expect(
      imported.files.find((item) => item.frame.id === 'mind')?.organization,
    ).toBeUndefined();
  });

  it('compares organization separately from canvas content', () => {
    const left = file('a', { organization: { kind: 'standalone' } });
    const right = file('a', {
      organization: { kind: 'subgraph', ownerFrameId: 'b' },
    });
    expect(sameFrameContent(left, right)).toBe(true);
    expect(sameFrameFile(left, right)).toBe(false);
  });

  it('includes owned subgraphs in a closure without walking upward', () => {
    const canvas = file('a', { organization: { kind: 'standalone' } });
    const mind = file('c', {
      organization: { kind: 'subgraph', ownerFrameId: 'a' },
      frame: frameCell('c', 'c', ['topic']),
      cells: { topic: mindNode('topic') },
    });
    expect(frameClosure([canvas, mind], 'a')).toEqual(['a', 'c']);
    expect(frameClosure([canvas, mind], 'c')).toEqual(['c']);
  });

  it('applies the copy and import ownership table', () => {
    const canvas = file('a', { organization: { kind: 'standalone' } });
    const mind = file('c', {
      organization: { kind: 'subgraph', ownerFrameId: 'a' },
      frame: frameCell('c', 'c', ['topic']),
      cells: { topic: mindNode('topic') },
    });
    const standalone = file('s', {
      organization: { kind: 'standalone' },
      frame: frameCell('s', 's', ['topic']),
      cells: { topic: mindNode('topic') },
    });
    let n = 0;
    const ids = () => `n${(n += 1)}`;
    const copiedCanvas = duplicateFrameClosure([canvas, mind], 'a', ids);
    const copiedMind = copiedCanvas.files.find(
      (item) => item.organization?.kind === 'subgraph',
    );
    expect(copiedMind?.organization).toEqual({
      kind: 'subgraph',
      ownerFrameId: copiedCanvas.rootId,
    });
    n = 0;
    const listed = duplicateFrameClosure([canvas, mind], 'c', ids, {
      mode: 'keep-owner',
    });
    expect(listed.files[0]?.organization).toEqual({
      kind: 'subgraph',
      ownerFrameId: 'a',
    });
    n = 0;
    const assigned = duplicateFrameClosure([mind], 'c', ids, {
      mode: 'assign-owner',
      assignOwnerId: 'b',
    });
    expect(assigned.files[0]?.organization).toEqual({
      kind: 'subgraph',
      ownerFrameId: 'b',
    });
    n = 0;
    const copiedStandalone = duplicateFrameClosure([standalone], 's', ids);
    expect(copiedStandalone.files[0]?.organization).toEqual({
      kind: 'standalone',
    });
    const imported = remapImportedFiles([mind], () => false, ids);
    expect(imported[0]?.organization).toEqual({ kind: 'subgraph' });
    const packed = remapImportedFiles([canvas, mind], () => false, ids);
    const owner = packed.find((item) => item.frame.id === 'a');
    const child = packed.find((item) => item.organization?.kind === 'subgraph');
    expect(child?.organization).toEqual({
      kind: 'subgraph',
      ownerFrameId: owner?.frame.id,
    });
  });

  it('recommends the sole regular canvas and leaves explicit charts alone', () => {
    const canvas = file('a');
    const other = file('b');
    const sole = file('c', {
      frame: frameCell('c', 'c', ['topic']),
      cells: {
        topic: mindNode('topic'),
        r: ref('r', 'a'),
      },
    });
    const referenced = file('a', {
      frame: frameCell('a', 'a', ['ref-c']),
      cells: { 'ref-c': ref('ref-c', 'c') },
    });
    const many = file('d', {
      frame: frameCell('d', 'd', ['topic']),
      cells: { topic: mindNode('topic') },
    });
    const fromA = file('a2', {
      frame: frameCell('a2', 'a2', ['r1']),
      cells: { r1: ref('r1', 'd') },
    });
    const fromB = file('b2', {
      frame: frameCell('b2', 'b2', ['r2']),
      cells: { r2: ref('r2', 'd') },
    });
    const explicit = file('e', {
      organization: { kind: 'standalone' },
      frame: frameCell('e', 'e', ['topic']),
      cells: { topic: mindNode('topic') },
    });
    const rows = recommendOrganization([
      referenced,
      other,
      sole,
      many,
      fromA,
      fromB,
      explicit,
      canvas,
    ]);
    expect(rows.find((row) => row.fileId === 'c')).toMatchObject({
      reason: 'sole-source',
      organization: { kind: 'subgraph', ownerFrameId: 'a' },
    });
    expect(rows.find((row) => row.fileId === 'd')?.reason).toBe(
      'multiple-sources',
    );
    expect(rows.find((row) => row.fileId === 'e')).toBeUndefined();
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
      creationOwnerId: 'A',
      label: 'create-mind',
    });
    expect(created.ok).toBe(true);
    const mindId = [...session.getState().files.keys()].find(
      (id) => id !== 'A' && id !== 'B',
    )!;
    expect(session.getState().organization.ownedBy.get('A')).toEqual([mindId]);
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
    expect(session.getState().files.get(mindId)!.file.organization).toEqual({
      kind: 'subgraph',
      ownerFrameId: 'A',
    });

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
    expect(savedMind.organization).toEqual({
      kind: 'subgraph',
      ownerFrameId: 'A',
    });
    expect((savedMind.cells.topic as NodeCell).content?.label).toBe('范围');
    const savedB = reopened.getState().files.get('B')!.file;
    expect(savedB.cells.r1).toBeTruthy();
    expect(savedB.cells.r2).toBeTruthy();
    expect(savedB.cells.preview).toBeTruthy();
    expect(before).toBe(true);
  });

  it('rolls back a rejected edit and rejects illegal organization', async () => {
    const { session } = await sessionFor([
      file('A'),
      file('mind', {
        frame: frameCell('mind', 'mind', ['topic']),
        cells: { topic: mindNode('topic') },
        organization: { kind: 'subgraph', ownerFrameId: 'A' },
      }),
      file('other', { organization: { kind: 'standalone' } }),
    ]);
    const canvas = createCanvasSession({ session });
    const occurrence = canvas.openFile('mind').occurrence!;
    const otherBefore = session.getState().files.get('other')!.file;
    const undoBefore = session.getState().canUndo;
    const rejected = await canvas.dispatch(occurrence.id, {
      id: 'bad',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...mindNode('topic'), kind: 'geometry' },
        },
      ],
    });
    expect(rejected.ok).toBe(false);
    expect((occurrence.runtime.store.cells.topic as NodeCell).kind).toBe(
      'mind-root',
    );
    expect(session.getState().files.get('other')!.file).toEqual(otherBefore);
    expect(session.getState().canUndo).toBe(undoBefore);
    const illegal = await session.apply({
      type: 'set-organization',
      fileId: 'A',
      organization: { kind: 'subgraph', ownerFrameId: 'mind' },
    });
    expect(illegal.ok).toBe(false);
    const self = await session.apply({
      type: 'set-organization',
      fileId: 'mind',
      organization: { kind: 'subgraph', ownerFrameId: 'mind' },
    });
    expect(self.ok).toBe(false);
  });

  it('commits organization as one undo that does not restore old content', async () => {
    const { session } = await sessionFor([
      file('A', { organization: { kind: 'standalone' } }),
      file('mind', {
        frame: frameCell('mind', 'mind', ['topic']),
        cells: { topic: mindNode('topic') },
      }),
    ]);
    const basis = session.getState().files.get('mind')!.file;
    const organized = await session.organize([
      {
        fileId: 'mind',
        organization: { kind: 'subgraph', ownerFrameId: 'A' },
        basisOrganization: null,
        basisSources: [],
      },
    ]);
    expect(organized.ok).toBe(true);
    const renamed = await session.apply({
      type: 'file',
      file: {
        ...session.getState().files.get('mind')!.file,
        frame: {
          ...session.getState().files.get('mind')!.file.frame,
          name: '改名',
        },
      },
    });
    expect(renamed.ok).toBe(true);
    const undone = await session.undo();
    expect(undone.ok).toBe(true);
    expect(session.getState().files.get('mind')!.file.frame.name).toBe('mind');
    expect(session.getState().files.get('mind')!.file.organization?.kind).toBe(
      'subgraph',
    );
    const orgUndo = await session.undo();
    expect(orgUndo.ok).toBe(true);
    expect(
      session.getState().files.get('mind')!.file.organization,
    ).toBeUndefined();
    expect(session.getState().files.get('mind')!.file.frame.name).toBe('mind');
    expect(basis.frame.name).toBe('mind');
    session.setReadonly(true);
    const blocked = await session.organize([
      {
        fileId: 'mind',
        organization: { kind: 'standalone' },
        basisOrganization: null,
        basisSources: [],
      },
    ]);
    expect(blocked.ok).toBe(false);
  });
});
