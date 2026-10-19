import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCellRuntime,
  createFrameCell,
  isFrameCell,
  isFrameReferenceCell,
  type CellChange,
} from '@sue/board-core';
import type { VerdFrameProps } from '@sue/verd-board-ui';
import { WorkspaceApp } from './workspace-app';
import { createFrameFile } from './frames/frame-files';
import { createMemoryWorkspaceHost } from './host/memory-workspace-host';

let latest: VerdFrameProps | null = null;
vi.mock('@sue/verd-board-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sue/verd-board-ui')>();
  return {
    ...actual,
    VerdFrame: (props: VerdFrameProps) => {
      latest = props;
      return (
        <div data-canvas={props.frameId} data-save-status={props.saveStatus} />
      );
    },
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
let root: Root | null = null;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  latest = null;
  container?.remove();
});

const setup = async () => {
  const host = createMemoryWorkspaceHost();
  const handle = (await host.openWorkspace({ path: 'runtime-echo' }))!;
  const initial = createFrameFile({
    ...createFrameCell('board'),
    name: 'Initial board',
  });
  await host.commit(handle, {
    transactionId: 'seed',
    writes: [
      {
        path: 'Board.verd.json',
        content: JSON.stringify(initial),
        expectedVersion: null,
      },
    ],
    session: {
      tabs: [{ fileId: 'board' }],
      activeTabId: 'board',
      expandedDirs: [],
    },
  });
  let flush: () => Promise<void> = async () => {};
  host.onShutdown = (callback) => {
    flush = callback;
    return () => {};
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <WorkspaceApp host={host} workspace={{ path: 'runtime-echo' }} />,
    ),
  );
  expect(latest).not.toBeNull();
  const changeName = (name: string): CellChange => {
    const runtime = createCellRuntime(latest!.value);
    const board = runtime.store.cells.board;
    if (!isFrameCell(board)) throw new Error('Expected a canvas root');
    return runtime.transact({
      id: 'rename-board',
      operations: [{ type: 'replace_cell', cell: { ...board, name } }],
    });
  };
  return { host, handle, flush: () => flush(), changeName };
};
const name = () => {
  const board = latest!.value.store.cells.board;
  if (!isFrameCell(board)) throw new Error('Expected a canvas root');
  return board.name;
};

describe('WorkspaceApp runtime snapshot echoes', () => {
  it('retains the authored snapshot through the session roundtrip and save status notifications', async () => {
    const test = await setup();
    const change = test.changeName('Authored board');
    await act(async () => latest!.onChange(change));
    expect(name()).toBe('Authored board');
    expect(latest!.value).toBe(change.snapshot);

    const commit = test.host.commit.bind(test.host);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    test.host.commit = vi.fn(async (...args: Parameters<typeof commit>) => {
      await gate;
      return commit(...args);
    });
    let saving!: Promise<void>;
    await act(async () => {
      saving = test.flush();
    });
    expect(latest!.saveStatus).toBe('saving');
    expect(latest!.value).toBe(change.snapshot);
    await act(async () => {
      release();
      await saving;
    });
    expect(latest!.saveStatus).toBe('saved');
    expect(latest!.lastSavedAt).toEqual(expect.any(Number));
    expect(latest!.value).toBe(change.snapshot);
    const saved = await test.host.readSnapshot(test.handle);
    expect(saved.canvases[0].file?.frame.name).toBe('Authored board');
  });

  it('replaces the echoed snapshot for undo and a real external file update', async () => {
    const test = await setup();
    const change = test.changeName('Authored board');
    await act(async () => latest!.onChange(change));
    expect(latest!.value).toBe(change.snapshot);
    await act(async () => test.flush());
    await act(async () => latest!.history!.undo());
    expect(name()).toBe('Initial board');
    expect(latest!.value).not.toBe(change.snapshot);
    const undoSnapshot = latest!.value;
    await act(async () => test.flush());
    const saved = (await test.host.readSnapshot(test.handle)).canvases[0];
    const external = {
      ...saved.file!,
      frame: { ...saved.file!.frame, name: 'External board' },
    };
    await act(async () => {
      await test.host.commit(test.handle, {
        transactionId: 'external-update',
        writes: [
          {
            path: saved.path,
            content: JSON.stringify(external),
            expectedVersion: saved.version,
          },
        ],
      });
    });
    expect(name()).toBe('External board');
    expect(latest!.value).not.toBe(change.snapshot);
    expect(latest!.value).not.toBe(undoSnapshot);
  });

  it('adopts canonical references when a raw runtime edit promotes an owned Frame into a file', async () => {
    const test = await setup();
    const nested = createFrameCell('nested', {
      x: 600,
      y: 300,
      width: 240,
      height: 160,
    });
    const runtime = createCellRuntime(latest!.value);
    const change = runtime.transact({
      id: 'create-owned-frame',
      operations: [{ type: 'insert_cell', parentId: 'board', cell: nested }],
    });
    await act(async () => latest!.onChange(change));
    expect(latest!.value).not.toBe(change.snapshot);
    const owner = latest!.value.store.cells.board;
    expect(isFrameCell(owner)).toBe(true);
    if (!isFrameCell(owner)) throw new Error('Expected the owner canvas');
    expect(owner.children).toHaveLength(1);
    const reference = latest!.value.store.cells[owner.children[0]];
    expect(isFrameReferenceCell(reference)).toBe(true);
    if (!isFrameReferenceCell(reference))
      throw new Error('Expected a canonical reference');
    expect(reference.data.targetFrameId).toBe(nested.id);
    expect(latest!.value.store.cells.nested).toMatchObject({
      kind: 'frame',
      geometry: nested.geometry,
    });
    await act(async () => test.flush());
    const saved = await test.host.readSnapshot(test.handle);
    const source = saved.canvases.find(
      (entry) => entry.file?.frame.id === nested.id,
    );
    const parent = saved.canvases.find(
      (entry) => entry.file?.frame.id === 'board',
    );
    expect(source?.file?.frame.geometry).toEqual(nested.geometry);
    expect(parent?.file?.cells[reference.id]).toMatchObject({
      kind: 'frame-reference',
      data: { targetFrameId: nested.id },
    });
  });
});
