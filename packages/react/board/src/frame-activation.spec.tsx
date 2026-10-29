import {
  createCellRuntime,
  createFrameCell,
  createFrameReferenceCell,
  createDocumentReferenceCell,
  type CellRuntime,
  type FrameSnapshot,
  type NodeCell,
} from '@sue/board-core';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import {
  FrameCanvas,
  type FrameCanvasController,
  type FrameInstanceHost,
} from './frame-canvas';
import { createTestFramePluginSet } from '../../../../tests/fixtures/plugins/ui';
import { createTestCellRegistry } from '../../../../tests/fixtures/plugins/registry';
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function setup(exporting = false) {
  const pluginSet = createTestFramePluginSet(),
    registry = createTestCellRegistry();
  const shape: NodeCell = {
    id: 'shape',
    cellType: 'node',
    kind: 'geometry',
    geometry: { x: 10, y: 10, width: 180, height: 70 },
    content: { label: 'Shared subject' },
  };
  const doc = createDocumentReferenceCell('inner-doc', 'source-doc', {
    x: 10,
    y: 110,
    width: 250,
    height: 140,
  });
  const target = {
    ...createFrameCell('target'),
    name: 'Target',
    children: [shape.id, doc.id],
  };
  let available = true;
  let snapshot: FrameSnapshot = {
    store: { rootId: target.id, cells: { target, shape, [doc.id]: doc } },
  };
  const refs = ['a', 'b'].map((id, index) =>
    createFrameReferenceCell(id, target.id, {
      x: index * 600,
      y: 0,
      width: 540,
      height: 400,
    }),
  );
  const board = {
    ...createFrameCell('board'),
    children: refs.map((r) => r.id),
  };
  const value = {
    store: { rootId: board.id, cells: { board, a: refs[0], b: refs[1] } },
  };
  const instances = new Map<string, CellRuntime>(),
    listeners = new Set<() => void>();
  const acquire = vi.fn((query, options) => {
    expect(options).toEqual({ edit: true });
    instances.set(query.refId, createCellRuntime(snapshot, registry));
    return () => {
      instances.delete(query.refId);
    };
  });
  const host: FrameInstanceHost = {
    source: {
      getSnapshot: (id) => (id === target.id && available ? snapshot : null),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    acquire,
    release: vi.fn(),
    get: (query) =>
      instances.has(query.refId)
        ? {
            occurrenceId: query.refId,
            runtime: instances.get(query.refId)!,
            readonly: false,
            preview: false,
          }
        : null,
    commit: async () => ({ status: 'accepted' }),
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container),
    controller = createRef<FrameCanvasController>();
  const renderDocument = vi.fn(() => <div>Full inner document</div>);
  const open = vi.fn();
  const paint = vi.fn(() => undefined);
  const extensions = [{ kind: 'geometry', presentation: paint }];
  await act(async () =>
    root.render(
      <FrameCanvas
        ref={controller}
        value={value}
        pluginSet={pluginSet}
        extensions={extensions}
        instanceHost={host}
        referenceInteraction="activate"
        autoFit={false}
        exporting={exporting}
        onOpenFrame={open}
        documentReferences={{
          title: () => 'Inner document',
          render: renderDocument,
        }}
      />,
    ),
  );
  for (let i = 0; i < 6; i++)
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });
  cleanup.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const enter = async (id: string) =>
    act(async () => {
      container
        .querySelector(`[data-cell-id="${id}"] > [data-frame-shell]`)!
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
  return {
    container,
    controller,
    instances,
    acquire,
    renderDocument,
    paint,
    open,
    enter,
    source: {
      remove() {
        available = false;
        listeners.forEach((l) => l());
      },
      update() {
        const nextShape = { ...shape, content: { label: 'Updated subject' } };
        snapshot = {
          store: {
            ...snapshot.store,
            cells: { ...snapshot.store.cells, shape: nextShape },
          },
        };
        listeners.forEach((l) => l());
      },
    },
  };
}
it('renders source subjects and nested reference cards without acquiring editors or installing internal interactions', async () => {
  const test = await setup();
  expect(test.container.textContent).toContain('Shared subject');
  expect(test.container.textContent).toContain('Inner document');
  expect(test.container.textContent).not.toContain('Full inner document');
  expect(test.renderDocument).not.toHaveBeenCalled();
  expect(test.acquire).not.toHaveBeenCalled();
  const boundary = test.container.querySelector(
    '[data-preview-paint-boundary]',
  )!;
  const viewport = boundary.firstElementChild as HTMLElement;
  expect(boundary.tagName).toBe('foreignObject');
  expect(viewport.style.contain).toBe('layout paint');
  expect(viewport.style.overflow).toBe('hidden');
  expect(viewport.querySelector('svg[data-preview-viewport]')).not.toBeNull();
  expect(boundary.closest('[data-frame-header]')).toBeNull();
  expect(
    test.container.querySelectorAll('svg[data-surface="nested"]'),
  ).toHaveLength(0);
  expect(
    test.container.querySelectorAll(
      '[data-reference-preview] [data-node-interaction], [data-reference-preview] [data-edge-hit]',
    ),
  ).toHaveLength(0);
  await act(async () => test.source.update());
  expect(test.container.textContent).toContain('Updated subject');
  await test.enter('a');
  expect(test.acquire).toHaveBeenCalledTimes(1);
  expect(
    test.container.querySelectorAll('svg[data-surface="nested"]'),
  ).toHaveLength(1);
  expect(test.instances.size).toBe(1);
  expect(test.renderDocument).not.toHaveBeenCalled();
  await test.enter('b');
  expect([...test.instances.keys()]).toEqual(['b']);
  expect(
    test.container.querySelectorAll('svg[data-surface="nested"]'),
  ).toHaveLength(1);
  const nested = test.container.querySelector('svg[data-surface="nested"]')!;
  await act(async () =>
    nested.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(test.instances.size).toBe(0);
  expect(
    test.container.querySelectorAll('svg[data-surface="nested"]'),
  ).toHaveLength(0);
});
it('exports the same subject as flat SVG without HTML preview boundaries or editing instances', async () => {
  const t = await setup(true);
  expect(t.container.textContent).toContain('Shared subject');
  expect(t.container.textContent).toContain('Inner document');
  expect(t.container.querySelector('[data-preview-paint-boundary]')).toBeNull();
  expect(t.container.querySelector('[data-preview-viewport]')).toBeNull();
  expect(
    t.container.querySelector(
      '[data-reference-preview] [data-frame-content-id]',
    ),
  ).not.toBeNull();
  expect(t.acquire).not.toHaveBeenCalled();
});
it('keeps Electron 28 previews live and flat without creating an editing instance', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
    'Chrome/120.0 Electron/28.3.3',
  );
  const t = await setup();
  expect(t.container.querySelector('[data-preview-paint-boundary]')).toBeNull();
  expect(t.container.querySelector('[data-preview-viewport]')).toBeNull();
  const subject = t.container.querySelector(
    '[data-reference-preview] [data-frame-content-id]',
  )!;
  expect(subject.closest('svg')?.getAttribute('data-surface')).toBe('root');
  expect(
    t.container.querySelector(
      '[data-frame-export-exclude="visibility-observer"] > div',
    ),
  ).not.toBeNull();
  expect(t.acquire).not.toHaveBeenCalled();
  await act(async () => t.source.update());
  expect(t.container.textContent).toContain('Updated subject');
});
it('keeps a failed editing instance mounted and waits for the latest requested target', async () => {
  const test = await setup();
  await test.enter('a');
  const child = test.controller.current!.getActiveController();
  const flush = vi
    .spyOn(child, 'flushEditing')
    .mockResolvedValue({ status: 'rejected', message: 'Conflict' });
  await test.enter('b');
  expect([...test.instances.keys()]).toEqual(['a']);
  expect(test.container.textContent).toContain('Conflict');
  let resolve!: (value: { status: 'accepted' }) => void;
  flush.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await test.enter('b');
  expect([...test.instances.keys()]).toEqual(['a']);
  await act(async () => resolve({ status: 'accepted' }));
  expect([...test.instances.keys()]).toEqual(['b']);
});

it('only activates the latest request after a shared submission barrier and ignores late completions', async () => {
  const test = await setup();
  await test.enter('a');
  let resolve!: (value: { status: 'accepted' }) => void;
  const flush = vi
    .spyOn(test.controller.current!.getActiveController(), 'flushEditing')
    .mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
  await test.enter('b');
  await test.enter('a');
  expect(flush).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ status: 'accepted' }));
  expect([...test.instances.keys()]).toEqual(['a']);
  expect(
    test.container.querySelectorAll('svg[data-surface="nested"]'),
  ).toHaveLength(1);
});
it('releases an editing occurrence when its source disappears and does not reactivate a missing target', async () => {
  const test = await setup();
  await test.enter('a');
  await act(async () => test.source.remove());
  expect(test.instances.size).toBe(0);
  expect(
    test.container.querySelectorAll('svg[data-surface="nested"]'),
  ).toHaveLength(0);
  expect(test.container.textContent).toContain('引用缺失');
  await test.enter('a');
  expect(test.instances.size).toBe(0);
});

it('reuses the preview scene through shell movement and camera zoom, but redraws changed source content', async () => {
  const t = await setup();
  const before = t.paint.mock.calls.length;
  const shell = t.controller.current!.runtime.store.cells.a as NodeCell;
  await act(async () => {
    await t.controller.current!.dispatch({
      id: 'move-shell',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...shell, geometry: { ...shell.geometry, x: 90, y: 60 } },
        },
      ],
    });
    t.controller.current!.restoreCamera({ zoom: 2, origination: [20, 30] });
  });
  expect(t.paint).toHaveBeenCalledTimes(before);
  expect(t.acquire).not.toHaveBeenCalled();
  await act(async () => t.source.update());
  expect(t.paint.mock.calls.length).toBeGreaterThan(before);
});

it('selects an inner reference shell in the active source without activating a deeper editor', async () => {
  const t = await setup();
  await t.enter('a');
  const card = t.container.querySelector(
    'svg[data-surface="nested"] [data-reference-card="source-doc"] [data-frame-shell]',
  )!;
  await act(async () => {
    const event = new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 30,
      clientY: 130,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    card.dispatchEvent(event);
  });
  expect(
    t.controller.current!.getActiveController().runtime.selection.ids,
  ).toEqual(['inner-doc']);
  expect(t.instances.size).toBe(1);
  expect(t.renderDocument).not.toHaveBeenCalled();
});

it('observes HTML viewports so older Desktop Chromium can admit and paint SVG subjects', async () => {
  const targets: Element[] = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        targets.push(target);
        this.callback(
          [
            {
              isIntersecting: true,
              intersectionRect: { left: 0, top: 0, right: 200, bottom: 200 },
            } as IntersectionObserverEntry,
          ],
          this as unknown as IntersectionObserver,
        );
      }
      disconnect() {}
    },
  );
  const t = await setup();
  expect(targets.length).toBeGreaterThan(0);
  expect(targets.every((target) => target instanceof HTMLElement)).toBe(true);
  expect(t.container.textContent).toContain('Shared subject');
  expect(t.acquire).not.toHaveBeenCalled();
});
