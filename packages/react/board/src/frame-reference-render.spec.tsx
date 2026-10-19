import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createCellRuntime,
  createDocumentReferenceCell,
  createFrameCell,
  createFrameReferenceCell,
  fitFrameContent,
  frameContentBounds,
  type CellRuntime,
  type NodeCell,
} from '@sue/board-core';
import {
  FrameCanvas,
  type FrameCanvasController,
  type FrameDocumentReferences,
  type FrameInstanceQuery,
} from './frame-canvas';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

const paintFrame = async () =>
  act(
    async () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );

it.each([false, true])(
  'refreshes a stable document adapter using only revision, including through a cached reference Surface (nested=%s)',
  async (nested) => {
    const documentCell = createDocumentReferenceCell('document', 'source', {
      x: 10,
      y: 10,
      width: 400,
      height: 300,
    });
    const target = {
      ...createFrameCell('target'),
      children: [documentCell.id],
    };
    const targetStore = {
      rootId: target.id,
      cells: { target, document: documentCell },
    };
    const runtime = createCellRuntime({ store: targetStore });
    const reference = createFrameReferenceCell('reference', target.id, {
      x: 10,
      y: 10,
      width: 500,
      height: 400,
    });
    const board = { ...createFrameCell('board'), children: [reference.id] };
    const value = {
      store: nested
        ? { rootId: board.id, cells: { board, reference } }
        : targetStore,
    };
    const host = {
      acquire() {},
      release() {},
      get: () => ({
        occurrenceId: reference.id,
        runtime,
        readonly: true,
        preview: true,
      }),
      commit: async () => ({ status: 'accepted' as const }),
    };
    let revision = {},
      text = 'Original document';
    const body = vi.fn(() => <div>{text}</div>);
    const references: FrameDocumentReferences = {
      get revision() {
        return revision;
      },
      title: () => 'Document',
      render: body,
    };
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(async () => {
      await act(() => root.unmount());
      container.remove();
    });
    const render = async () =>
      act(() =>
        root.render(
          <FrameCanvas
            value={value}
            autoFit={false}
            instanceHost={nested ? host : undefined}
            documentReferences={references}
          />,
        ),
      );
    await render();
    for (
      let frame = 0;
      frame < 10 && !container.textContent?.includes(text);
      frame++
    )
      await paintFrame();
    expect(container.textContent).toContain(text);
    const initialRenders = body.mock.calls.length;
    text = 'Updated document';
    revision = {};
    await render();
    expect(container.textContent).toContain(text);
    expect(body).toHaveBeenCalledTimes(initialRenders + 1);
    expect(runtime.store).toBe(targetStore);
  },
);

it('uses target revision tokens across unrelated commits and adapter replacement, while refreshing missing or changed bindings', async () => {
  const shape: NodeCell = {
    id: 'shape',
    kind: 'geometry',
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 100, height: 50 },
  };
  const target = { ...createFrameCell('target'), children: [shape.id] };
  const runtime = createCellRuntime({
    store: { rootId: target.id, cells: { target, shape } },
  });
  const reference = createFrameReferenceCell('reference', target.id, {
    x: 0,
    y: 100,
    width: 400,
    height: 300,
  });
  const title = { ...shape, id: 'title' };
  const board = {
    ...createFrameCell('board'),
    children: [reference.id, title.id],
  };
  const value = {
    store: { rootId: board.id, cells: { board, reference, title } },
  };
  let available = true,
    preview = true;
  const host = {
    acquire() {},
    release() {},
    get: () =>
      available
        ? {
            occurrenceId: 'reference-instance',
            runtime,
            readonly: true,
            preview,
          }
        : null,
    commit: async () => ({ status: 'accepted' as const }),
  };
  let revision = {},
    targetRevision = {};
  const getRevision = vi.fn(() => targetRevision);
  const adapter = (): FrameDocumentReferences => ({
    get revision() {
      return revision;
    },
    getRevision,
    title: () => 'Document',
    render: () => null,
  });
  let references = adapter();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const controller = createRef<FrameCanvasController>();
  cleanups.push(async () => {
    await act(() => root.unmount());
    container.remove();
  });
  const render = async () =>
    act(() =>
      root.render(
        <FrameCanvas
          ref={controller}
          value={value}
          instanceHost={host}
          autoFit={false}
          documentReferences={references}
        />,
      ),
    );
  await render();
  for (
    let frame = 0;
    frame < 10 && !container.querySelector('svg[data-surface="nested"]');
    frame++
  )
    await paintFrame();
  expect(getRevision).toHaveBeenCalledWith(target.id, [board.id, target.id]);
  const nested = container.querySelector('svg[data-surface="nested"]')!;
  const measure = vi.spyOn(nested, 'getBoundingClientRect');
  await act(() =>
    controller.current!.runtime.transact({
      id: 'move-title',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...title, geometry: { ...title.geometry, x: 20 } },
        },
      ],
    }),
  );
  references = adapter();
  await render();
  expect(measure).not.toHaveBeenCalled();
  expect(container.querySelector('[data-open-source]')).not.toBeNull();
  preview = false;
  targetRevision = {};
  revision = {};
  await render();
  expect(measure).toHaveBeenCalled();
  expect(container.querySelector('[data-open-source]')).toBeNull();
  available = false;
  targetRevision = {};
  revision = {};
  await render();
  expect(container.querySelector('[data-frame-missing]')).not.toBeNull();
  expect(container.querySelector('svg[data-surface="nested"]')).toBeNull();
  available = true;
  targetRevision = {};
  revision = {};
  await render();
  expect(container.querySelector('svg[data-surface="nested"]')).not.toBeNull();
  expect(container.querySelector('[data-frame-missing]')).toBeNull();
});

it.each([false, true])(
  'cuts a native A → B → A reference at its first repeated ancestor (exporting=%s)',
  async (exporting) => {
    const geometry = { x: 10, y: 10, width: 400, height: 300 };
    const a = { ...createFrameCell('a'), children: ['to-b'] };
    const b = { ...createFrameCell('b'), children: ['to-a'] };
    const toB = createFrameReferenceCell('to-b', b.id, geometry);
    const toA = createFrameReferenceCell('to-a', a.id, geometry);
    const sources = {
      a: { rootId: a.id, cells: { a, 'to-b': toB } },
      b: { rootId: b.id, cells: { b, 'to-a': toA } },
    };
    const acquisitions: FrameInstanceQuery[] = [];
    const runtimes = new Map<string, CellRuntime>();
    const host = {
      acquire(query: FrameInstanceQuery) {
        acquisitions.push(query);
        runtimes.set(
          query.appearance.join('/'),
          createCellRuntime({
            store: sources[query.targetFrameId as keyof typeof sources],
          }),
        );
      },
      get(query: FrameInstanceQuery) {
        const runtime = runtimes.get(query.appearance.join('/'));
        return runtime
          ? {
              occurrenceId: query.appearance.join('/'),
              runtime,
              readonly: true,
              preview: true,
            }
          : null;
      },
      release(query: FrameInstanceQuery) {
        runtimes.delete(query.appearance.join('/'));
      },
      commit: async () => ({ status: 'accepted' as const }),
    };
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(async () => {
      await act(() => root.unmount());
      container.remove();
    });
    await act(() =>
      root.render(
        <FrameCanvas
          value={{ store: sources.a }}
          instanceHost={host}
          autoFit={false}
          exporting={exporting}
        />,
      ),
    );
    for (let frame = 0; frame < 8; frame++) await paintFrame();
    expect(acquisitions.map((query) => query.appearance)).toEqual([
      [a.id, toB.id],
    ]);
    expect(
      container.querySelectorAll('svg[data-surface="nested"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-reference-instance] [data-cell-id="to-a"]')
        ?.textContent,
    ).toContain('已在当前预览路径');
    expect(
      container.querySelector('[data-reference-pending="true"]'),
    ).toBeNull();
  },
);

it('refits nested content immediately when its parent reference shell changes geometry', async () => {
  const shape: NodeCell = {
    id: 'shape',
    cellType: 'node',
    kind: 'geometry',
    geometry: { x: 10, y: 20, width: 100, height: 50 },
  };
  const target = { ...createFrameCell('target'), children: [shape.id] };
  const runtime = createCellRuntime({
    store: { rootId: target.id, cells: { target, shape } },
  });
  const reference = createFrameReferenceCell('reference', target.id, {
    x: 10,
    y: 10,
    width: 400,
    height: 300,
  });
  const board = { ...createFrameCell('board'), children: [reference.id] };
  const value = { store: { rootId: board.id, cells: { board, reference } } };
  const host = {
    acquire() {},
    release() {},
    get: () => ({
      occurrenceId: reference.id,
      runtime,
      readonly: true,
      preview: true,
    }),
    commit: async () => ({ status: 'accepted' as const }),
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const controller = createRef<FrameCanvasController>();
  cleanups.push(async () => {
    await act(() => root.unmount());
    container.remove();
  });
  await act(() =>
    root.render(
      <FrameCanvas
        ref={controller}
        value={value}
        instanceHost={host}
        autoFit={false}
      />,
    ),
  );
  for (
    let frame = 0;
    frame < 10 && !container.querySelector('svg[data-surface="nested"]');
    frame++
  )
    await paintFrame();
  const content = () =>
    container.querySelector(
      '[data-reference-instance] [data-frame-content-id="target"]',
    )!;
  const original = content().getAttribute('transform');
  const childRevision = runtime.revision;
  const nextReference = {
    ...reference,
    geometry: { x: 60, y: 90, width: 700, height: 360 },
  };
  await act(() =>
    controller.current!.runtime.transact({
      id: 'resize-reference',
      operations: [{ type: 'replace_cell', cell: nextReference }],
    }),
  );
  const fit = fitFrameContent(
    { ...target, geometry: nextReference.geometry },
    frameContentBounds(runtime.store, target.id),
  );
  expect(content().getAttribute('transform')).toBe(
    `translate(${fit.offset[0]} ${fit.offset[1]}) scale(${fit.scale})`,
  );
  expect(content().getAttribute('transform')).not.toBe(original);
  expect(runtime.revision).toBe(childRevision);
  expect(runtime.selection.ids).toEqual([]);
});

it('isolates nested rendering from parent selection, retains child subscriptions and forwards fresh callbacks', async () => {
  const geometry = { x: 10, y: 10, width: 100, height: 40 };
  const shape: NodeCell = {
    id: 'shape',
    cellType: 'node',
    kind: 'geometry',
    geometry,
    content: { label: 'Child' },
  };
  const target = { ...createFrameCell('target'), children: [shape.id] };
  const runtime = createCellRuntime({
    store: { rootId: target.id, cells: { target, shape } },
  });
  const reference = createFrameReferenceCell('reference', target.id, {
    ...geometry,
    width: 400,
    height: 300,
  });
  const a = { ...shape, id: 'a' },
    b = { ...shape, id: 'b' };
  const board = {
    ...createFrameCell('board'),
    children: [reference.id, a.id, b.id],
  };
  const value = {
    store: { rootId: board.id, cells: { board, reference, a, b } },
  };
  const host = {
    acquire() {},
    release() {},
    get: () => ({
      occurrenceId: 'reference-instance',
      runtime,
      readonly: true,
      preview: true,
    }),
    commit: async () => ({ status: 'accepted' as const }),
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const controller = createRef<FrameCanvasController>();
  cleanups.push(async () => {
    await act(() => root.unmount());
    container.remove();
  });
  const oldOpen = vi.fn(),
    newOpen = vi.fn();
  const render = async (onOpenFrame = oldOpen) =>
    act(() =>
      root.render(
        <FrameCanvas
          ref={controller}
          value={value}
          instanceHost={host}
          autoFit={false}
          onOpenFrame={onOpenFrame}
        />,
      ),
    );
  await render();
  for (
    let frame = 0;
    frame < 10 && !container.querySelector('svg[data-surface="nested"]');
    frame++
  )
    await act(
      async () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  const nested = container.querySelector('svg[data-surface="nested"]')!;
  const measure = vi.spyOn(nested, 'getBoundingClientRect');
  const world =
    container.querySelector('svg[data-surface="root"] > [data-frame-world]') ??
    container.querySelector('[data-frame-world]')!;
  const paint = vi.spyOn(world, 'setAttribute');
  for (const id of ['a', 'b', 'a'])
    await act(() =>
      controller.current!.runtime.select({ focus: [board.id], ids: [id] }),
    );
  expect(measure).not.toHaveBeenCalled();
  expect(
    paint.mock.calls.filter(([attribute]) => attribute === 'transform'),
  ).toEqual([]);
  await render(newOpen);
  await act(() =>
    container.querySelector<HTMLButtonElement>('[data-open-source]')!.click(),
  );
  expect(oldOpen).not.toHaveBeenCalled();
  expect(newOpen).toHaveBeenCalledWith(
    target.id,
    expect.objectContaining({ refId: reference.id }),
  );
  await act(() =>
    runtime.transact({
      id: 'update-child',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...shape, content: { label: 'Updated child' } },
        },
      ],
    }),
  );
  expect(nested.textContent).toContain('Updated child');
  expect(measure).toHaveBeenCalled();
});
