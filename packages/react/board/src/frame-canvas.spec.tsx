import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  createFrameCell,
  createCellStore,
  createCellRuntime,
  applyCellOperations,
  createCellRegistry,
  frameContentViewport,
  NodeUtil,
  isNodeCell,
  type Cell,
  type CellStore,
  type FrameSnapshot,
} from '@sue/board-core';
import { FrameCanvas, type FrameCanvasController } from './frame-canvas';
const snapshot = (): FrameSnapshot => ({
  store: applyCellOperations(createCellStore(createFrameCell('root')), [
    {
      type: 'insert_cell',
      parentId: 'root',
      cell: {
        id: 'a',
        kind: 'geometry',
        cellType: 'node',
        geometry: { x: 10, y: 10, width: 100, height: 50 },
        content: { label: 'Hello' },
      },
    },
  ]),
});
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
describe('FrameCanvas', () => {
  it('keeps complete appearance paths for inner references reached through different shells', async () => {
    const reference = (id: string, targetFrameId: string): Cell =>
      ({
        id,
        kind: 'frame-reference',
        cellType: 'node',
        geometry: { x: 0, y: 0, width: 200, height: 150 },
        data: { targetFrameId },
      }) as Cell;
    const board: FrameSnapshot = {
      store: {
        rootId: 'board',
        cells: {
          board: { ...createFrameCell('board'), children: ['r1', 'r2'] },
          r1: reference('r1', 'middle'),
          r2: reference('r2', 'middle'),
        },
      },
    };
    const middle: FrameSnapshot = {
      store: {
        rootId: 'middle',
        cells: {
          middle: { ...createFrameCell('middle'), children: ['inner'] },
          inner: reference('inner', 'root'),
        },
      },
    };
    const runtimes = new Map<string, ReturnType<typeof createCellRuntime>>();
    const paths: string[][] = [];
    const host = {
      acquire(query: { appearance: string[] }) {
        paths.push(query.appearance);
      },
      release() {},
      get(query: { appearance: string[]; targetFrameId: string }) {
        const id = query.appearance.join('/');
        if (!runtimes.has(id))
          runtimes.set(
            id,
            createCellRuntime(
              query.targetFrameId === 'middle' ? middle : snapshot(),
            ),
          );
        return {
          occurrenceId: id,
          runtime: runtimes.get(id)!,
          readonly: false,
          preview: false,
        };
      },
      commit: async () => ({ status: 'accepted' as const }),
    };
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <FrameCanvas
            value={board}
            instanceHost={host}
            autoFit={false}
            readonly
            inputMode="present"
          />,
        ),
      );
      expect(paths).toContainEqual(['board', 'r1', 'inner']);
      expect(paths).toContainEqual(['board', 'r2', 'inner']);
      expect(runtimes.size).toBe(4);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('presents a shared reference without resetting its editor selection or activating it', async () => {
    const target = snapshot();
    const runtime = createCellRuntime(target);
    const shell: FrameSnapshot = {
      store: {
        rootId: 'board',
        cells: {
          board: { ...createFrameCell('board'), children: ['ref'] },
          ref: {
            id: 'ref',
            cellType: 'node',
            kind: 'frame-reference',
            geometry: { x: 20, y: 20, width: 200, height: 140 },
            data: { targetFrameId: 'root' },
          } as Cell,
        },
      },
    };
    const release = vi.fn(),
      legacyRelease = vi.fn(),
      commit = vi.fn();
    const host = {
      get: () => ({
        occurrenceId: 'ref-instance',
        runtime,
        readonly: false,
        preview: false,
      }),
      acquire: () => release,
      release: legacyRelease,
      commit: async () => {
        commit();
        return { status: 'accepted' as const };
      },
    };
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const activate = vi.fn(),
      tap = vi.fn();
    const render = (present: boolean) =>
      root.render(
        <>
          <FrameCanvas
            key="editor"
            value={shell}
            frameId="board"
            instanceHost={host}
            autoFit={false}
            onChange={() => {}}
          />
          {present && (
            <FrameCanvas
              key="present"
              value={shell}
              frameId="board"
              instanceHost={host}
              autoFit={false}
              readonly
              inputMode="present"
              onActiveInstance={activate}
              onPresentTap={tap}
            />
          )}
        </>,
      );
    try {
      await act(async () => render(false));
      await act(async () => runtime.select({ focus: ['root'], ids: ['a'] }));
      const selection = runtime.selection;
      await act(async () => render(true));
      expect(runtime.selection).toBe(selection);
      const ids = [...container.querySelectorAll('clipPath')].map(
        (node) => node.id,
      );
      expect(ids.length).toBeGreaterThan(1);
      expect(new Set(ids).size).toBe(ids.length);
      const canvas = container.querySelectorAll<SVGSVGElement>(
        'svg[data-surface="root"]',
      )[1];
      canvas.setPointerCapture = vi.fn();
      const inner = canvas.querySelector(
        '[data-reference-instance] [data-cell-id="a"]',
      )!;
      expect(inner).toBeTruthy();
      await act(async () => {
        for (const type of ['pointerdown', 'pointerup']) {
          const event = new MouseEvent(type, {
            bubbles: true,
            button: 0,
            clientX: 40,
            clientY: 40,
          });
          Object.defineProperty(event, 'pointerId', { value: 1 });
          (type === 'pointerdown' ? inner : canvas).dispatchEvent(event);
        }
      });
      expect(tap).toHaveBeenCalledWith('ref');
      expect(runtime.selection).toBe(selection);
      expect(activate).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
      await act(async () => render(false));
      expect(release).toHaveBeenCalledTimes(1);
      expect(legacyRelease).not.toHaveBeenCalled();
      expect(runtime.selection).toBe(selection);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('selects a keyboard-created cell only after an accepted transaction and host snapshot arrive', async () => {
    class CreateTopic extends NodeUtil {
      readonly kind = 'geometry';
      keyboard(_store: CellStore, cell: Cell, key: string) {
        return key === 'Tab' && isNodeCell(cell)
          ? [
              {
                type: 'insert_cell' as const,
                parentId: 'root',
                cell: { ...cell, id: 'new-topic' },
              },
            ]
          : undefined;
      }
    }
    for (const hostMode of [false, true]) {
      const container = document.createElement('div'),
        root = createRoot(container),
        ref = createRef<FrameCanvasController>();
      const registry = createCellRegistry();
      registry.register(new CreateTopic());
      const original = snapshot(),
        onSelectionChange = vi.fn();
      let release!: (result: { status: 'accepted' | 'rejected' }) => void;
      let intent: import('@sue/board-core').CellTransaction | undefined;
      const adapter = { toFrameSnapshot: (value: FrameSnapshot) => value };
      const render = (value: FrameSnapshot) =>
        root.render(
          hostMode ? (
            <FrameCanvas
              ref={ref}
              value={value}
              registry={registry}
              adapter={adapter}
              onSelectionChange={onSelectionChange}
              onIntent={(transaction) => {
                intent = transaction;
                return new Promise((resolve) => {
                  release = resolve;
                });
              }}
            />
          ) : (
            <FrameCanvas
              ref={ref}
              value={value}
              registry={registry}
              onChange={() => {}}
              onSelectionChange={onSelectionChange}
            />
          ),
        );
      await act(async () => render(original));
      await act(async () => {
        ref.current!.runtime.select({ focus: ['root'], ids: ['a'] });
        container.querySelector('svg')!.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Tab',
            code: 'Tab',
            bubbles: true,
          }),
        );
      });
      if (hostMode) {
        expect(ref.current!.runtime.selection.ids).toEqual(['a']);
        expect(ref.current!.runtime.store.cells['new-topic']).toBeUndefined();
        await act(async () => {
          release({ status: 'rejected' });
        });
        expect(ref.current!.runtime.selection.ids).toEqual(['a']);
        await act(async () => {
          container.querySelector('svg')!.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Tab',
              code: 'Tab',
              bubbles: true,
            }),
          );
        });
        await act(async () => {
          release({ status: 'accepted' });
        });
        expect(ref.current!.runtime.selection.ids).toEqual(['a']);
        await act(async () =>
          render({
            store: applyCellOperations(original.store, intent!.operations),
          }),
        );
      }
      expect(ref.current!.runtime.selection.ids).toEqual(['new-topic']);
      expect(onSelectionChange).toHaveBeenLastCalledWith({
        focus: ['root'],
        ids: ['new-topic'],
      });
      await act(async () => root.unmount());
    }
  });
  it('isolates selection and transactions in two canvases sharing an input snapshot', async () => {
    const container = document.createElement('div'),
      root = createRoot(container);
    const left = createRef<FrameCanvasController>(),
      right = createRef<FrameCanvasController>(),
      value = snapshot();
    const onSelectionChange = vi.fn();
    await act(async () =>
      root.render(
        <>
          <FrameCanvas
            ref={left}
            value={value}
            onChange={() => {}}
            onSelectionChange={onSelectionChange}
          />
          <FrameCanvas ref={right} value={value} onChange={() => {}} />
        </>,
      ),
    );
    await act(async () => {
      left.current!.runtime.select({ focus: ['root'], ids: ['a'] });
      await left.current!.dispatch({
        id: 'delete',
        operations: [{ type: 'remove_cell', cellId: 'a' }],
      });
    });
    expect(left.current!.runtime.store.cells.a).toBeUndefined();
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      focus: ['root'],
      ids: [],
    });
    expect(right.current!.runtime.store.cells.a).toBeTruthy();
    expect(right.current!.runtime.selection.ids).toEqual([]);
    expect(value.store.cells.a).toBeTruthy();
    await act(async () => root.unmount());
  });
  it('renders custom nodes and rejects controller edits in readonly mode', async () => {
    const container = document.createElement('div'),
      root = createRoot(container),
      ref = createRef<FrameCanvasController>(),
      onChange = vi.fn();
    await act(async () =>
      root.render(
        <FrameCanvas
          ref={ref}
          value={snapshot()}
          readonly
          onChange={onChange}
          extensions={[
            {
              kind: 'geometry',
              render: (context) => <text>{`${context.frameId}: custom`}</text>,
            },
          ]}
        />,
      ),
    );
    expect(container.textContent).toContain('root: custom');
    const result = await ref.current!.dispatch({
      id: 'delete',
      operations: [{ type: 'remove_cell', cellId: 'a' }],
    });
    expect(result.status).toBe('rejected');
    expect(onChange).not.toHaveBeenCalled();
    expect(ref.current!.runtime.store.cells.a).toBeTruthy();
    await act(async () => root.unmount());
  });
  it('delegates history and accepts host updates after an accepted intent', async () => {
    const container = document.createElement('div'),
      root = createRoot(container),
      ref = createRef<FrameCanvasController>();
    const value = snapshot(),
      history = { undo: vi.fn(), redo: vi.fn() },
      onIntent = vi.fn(async () => ({ status: 'accepted' as const }));
    const adapter = { toFrameSnapshot: (value: FrameSnapshot) => value };
    const render = (value: FrameSnapshot) =>
      root.render(
        <FrameCanvas
          ref={ref}
          value={value}
          adapter={adapter}
          onIntent={onIntent}
          history={history}
        />,
      );
    await act(async () => render(value));
    await act(async () => {
      await ref.current!.dispatch({
        id: 'delete',
        operations: [{ type: 'remove_cell', cellId: 'a' }],
      });
    });
    expect(ref.current!.runtime.store.cells.a).toBeTruthy();
    const accepted = {
      store: applyCellOperations(value.store, [
        { type: 'remove_cell', cellId: 'a' },
      ]),
    };
    await act(async () => render(accepted));
    expect(ref.current!.runtime.store.cells.a).toBeUndefined();
    await act(async () => {
      ref.current!.undo();
      ref.current!.redo();
    });
    expect(history.undo).toHaveBeenCalledOnce();
    expect(history.redo).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });
  it('renders cells and commits a transaction through its controller', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container),
      ref = createRef<FrameCanvasController>(),
      onChange = vi.fn();
    await act(async () =>
      root.render(
        <FrameCanvas ref={ref} value={snapshot()} onChange={onChange} />,
      ),
    );
    expect(container.textContent).toContain('Hello');
    await act(async () => {
      await ref.current!.dispatch({
        id: 'delete',
        operations: [{ type: 'remove_cell', cellId: 'a' }],
      });
    });
    expect(onChange.mock.calls[0][0].snapshot.store.cells.a).toBeUndefined();
    await act(async () => ref.current!.undo());
    expect(ref.current!.runtime.store.cells.a).toBeTruthy();
    await act(async () => root.unmount());
    container.remove();
  });
  it('does not mutate a third party snapshot while an async edit is rejected', async () => {
    const container = document.createElement('div'),
      root = createRoot(container),
      ref = createRef<FrameCanvasController>(),
      value = snapshot(),
      onReject = vi.fn();
    let release!: (value: { status: 'rejected'; message: string }) => void;
    const onIntent = vi.fn(
      () =>
        new Promise<{ status: 'rejected'; message: string }>((resolve) => {
          release = resolve;
        }),
    );
    await act(async () =>
      root.render(
        <FrameCanvas
          ref={ref}
          value={value}
          adapter={{ toFrameSnapshot: (value) => value }}
          onIntent={onIntent}
          onReject={onReject}
        />,
      ),
    );
    let request!: Promise<unknown>;
    await act(async () => {
      request = ref.current!.dispatch({
        id: 'delete',
        operations: [{ type: 'remove_cell', cellId: 'a' }],
      });
    });
    expect(value.store.cells.a).toBeTruthy();
    expect(ref.current!.runtime.store.cells.a).toBeTruthy();
    await act(async () => {
      release({ status: 'rejected', message: 'Denied' });
      await request;
    });
    expect(onReject).toHaveBeenCalledWith({
      status: 'rejected',
      message: 'Denied',
    });
    expect(container.textContent).toContain('Denied');
    await act(async () => root.unmount());
  });
  it('selects a pasted cell for either host arrival order and ignores a rejected or superseded request', async () => {
    const adapter = { toFrameSnapshot: (value: FrameSnapshot) => value };
    const pasted = (value: FrameSnapshot, id: string): FrameSnapshot => ({
      store: applyCellOperations(value.store, [
        {
          type: 'insert_cell',
          parentId: 'root',
          cell: {
            id,
            kind: 'geometry',
            cellType: 'node',
            geometry: { x: 200, y: 10, width: 40, height: 20 },
          },
        },
      ]),
    });
    const run = async (
      order: 'accept-first' | 'write-first' | 'reject' | 'reselect' | 'delay',
    ) => {
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      const ref = createRef<FrameCanvasController>();
      const original = snapshot();
      let release!: (result: { status: 'accepted' | 'rejected' }) => void;
      let settled: { status: 'accepted' | 'rejected' } | undefined;
      let intent: import('@sue/board-core').CellTransaction | undefined;
      const render = (value: FrameSnapshot) =>
        root.render(
          <FrameCanvas
            ref={ref}
            value={value}
            adapter={adapter}
            onIntent={(transaction) => {
              intent = transaction;
              return new Promise((resolve) => {
                release = (result) => {
                  settled = result;
                  resolve(result);
                };
              });
            }}
          />,
        );
      await act(async () => render(original));
      await act(async () => {
        ref.current!.runtime.select({ focus: ['root'], ids: ['a'] });
        container.querySelector('svg')!.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'd',
            code: 'KeyD',
            metaKey: true,
            bubbles: true,
          }),
        );
      });
      const inserted = intent!.operations.find(
        (operation) => operation.type === 'insert_cell',
      );
      const nextId =
        inserted && inserted.type === 'insert_cell' ? inserted.cell.id : '';
      const next = pasted(original, nextId);
      const resultPromise = Promise.resolve({ status: 'accepted' as const });
      if (order === 'write-first') {
        await act(async () => render(next));
        expect(ref.current!.runtime.selection.ids).toEqual(['a']);
        await act(async () => {
          release({ status: 'accepted' });
          await resultPromise;
        });
      } else if (order === 'accept-first') {
        await act(async () => {
          release({ status: 'accepted' });
        });
        expect(ref.current!.runtime.selection.ids).toEqual(['a']);
        await act(async () => render(next));
      } else if (order === 'reject') {
        const rejected = ref.current!.dispatch({
          id: 'noop',
          operations: [],
        });
        await act(async () => {
          release({ status: 'rejected' });
          await rejected.catch(() => undefined);
        });
        await act(async () => render(next));
        expect(ref.current!.runtime.selection.ids).toEqual(['a']);
      } else if (order === 'reselect') {
        await act(async () => {
          container.querySelector('[data-cell-id="a"]')!.dispatchEvent(
            new MouseEvent('pointerdown', {
              bubbles: true,
              button: 0,
              buttons: 1,
              clientX: 20,
              clientY: 20,
            }),
          );
        });
        await act(async () => {
          release({ status: 'accepted' });
        });
        await act(async () => render(next));
        expect(ref.current!.runtime.selection.ids).not.toEqual([nextId]);
        expect(settled).toEqual({ status: 'accepted' });
        expect(container.textContent).not.toContain('rejected');
      } else {
        expect(ref.current!.runtime.selection.ids).toEqual(['a']);
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
        });
        expect(ref.current!.runtime.selection.ids).toEqual(['a']);
        await act(async () => {
          release({ status: 'accepted' });
        });
        expect(ref.current!.runtime.selection.ids).toEqual(['a']);
        await act(async () => render(next));
      }
      if (
        order === 'accept-first' ||
        order === 'write-first' ||
        order === 'delay'
      )
        expect(ref.current!.runtime.selection.ids).toEqual([nextId]);
      await act(async () => root.unmount());
      container.remove();
    };
    await run('write-first');
    await run('accept-first');
    await run('reject');
    await run('delay');
    await run('reselect');
  });
  it('keeps a two-pointer zoom in memory and still accepts a later single pointer', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onChange = vi.fn();
    await act(async () =>
      root.render(<FrameCanvas value={snapshot()} onChange={onChange} />),
    );
    const svg = container.querySelector('svg')!;
    svg.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(
        type: string,
        init: MouseEventInit & { pointerId: number; pointerType?: string },
      ) {
        super(type, init);
        this.pointerId = init.pointerId;
        this.pointerType = init.pointerType ?? 'touch';
      }
    }
    const fire = (type: string, pointerId: number, x: number, y: number) =>
      svg.dispatchEvent(
        new TestPointerEvent(type, {
          bubbles: true,
          pointerId,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0,
          pointerType: 'touch',
        }),
      );
    await act(async () => {
      fire('pointerdown', 1, 100, 100);
      fire('pointerdown', 2, 300, 100);
      fire('pointermove', 2, 500, 100);
    });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => {
      fire('pointerup', 2, 500, 100);
      fire('pointerup', 1, 100, 100);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(
      svg.querySelector('[data-frame-world]')?.getAttribute('transform'),
    ).toBe('scale(2) translate(-50 -50)');
    await act(async () => {
      fire('pointerdown', 3, 10, 10);
      fire('pointerup', 3, 10, 10);
    });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    container.remove();
  });
  it('pans and zooms locally through cancel or lost capture', async () => {
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: MouseEventInit & { pointerId: number }) {
        super(type, init);
        this.pointerId = init.pointerId;
      }
    }
    const mount = async () => {
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      const onChange = vi.fn();
      await act(async () =>
        root.render(<FrameCanvas value={snapshot()} onChange={onChange} />),
      );
      const svg = container.querySelector('svg')!;
      svg.getBoundingClientRect = () =>
        ({
          left: 0,
          top: 0,
          width: 800,
          height: 600,
          right: 800,
          bottom: 600,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
      const fire = (type: string, pointerId: number, x: number, y: number) =>
        svg.dispatchEvent(
          new TestPointerEvent(type, {
            bubbles: true,
            pointerId,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0,
          }),
        );
      return { container, root, onChange, svg, fire };
    };
    const viewport = (svg: SVGSVGElement) => {
      const match = svg
        .querySelector('[data-frame-world]')!
        .getAttribute('transform')!
        .match(/scale\(([^)]+)\) translate\(([^ ]+) ([^)]+)\)/)!;
      return {
        zoom: Number(match[1]),
        origination: [-Number(match[2]) || 0, -Number(match[3]) || 0],
      };
    };
    const pan = await mount();
    await act(async () => {
      pan.fire('pointerdown', 1, 100, 100);
      pan.fire('pointerdown', 2, 300, 100);
      pan.fire('pointermove', 1, 140, 100);
      pan.fire('pointermove', 2, 340, 100);
      pan.fire('pointerup', 1, 140, 100);
      pan.fire('pointerup', 2, 340, 100);
    });
    expect(pan.onChange).not.toHaveBeenCalled();
    expect(viewport(pan.svg)).toMatchObject({
      zoom: 1,
      origination: [-40, 0],
    });
    await act(async () => {
      pan.fire('pointerdown', 3, 20, 20);
      pan.fire('pointerup', 3, 20, 20);
    });
    expect(pan.onChange).not.toHaveBeenCalled();
    await act(async () => pan.root.unmount());
    pan.container.remove();

    const combined = await mount();
    await act(async () => {
      combined.fire('pointerdown', 1, 100, 100);
      combined.fire('pointerdown', 2, 300, 100);
      combined.fire('pointermove', 1, 140, 160);
      combined.fire('pointermove', 2, 540, 160);
      combined.fire('pointerup', 2, 540, 160);
      combined.fire('pointerup', 1, 140, 160);
    });
    expect(viewport(combined.svg)).toMatchObject({
      zoom: 2,
      origination: [30, 20],
    });
    await act(async () => combined.root.unmount());
    combined.container.remove();

    const cancel = await mount();
    await act(async () => {
      cancel.fire('pointerdown', 1, 100, 100);
      cancel.fire('pointerdown', 2, 300, 100);
      cancel.fire('pointermove', 2, 500, 100);
      cancel.svg.dispatchEvent(
        new TestPointerEvent('pointercancel', {
          bubbles: true,
          pointerId: 2,
          clientX: 500,
          clientY: 100,
        }),
      );
      cancel.svg.dispatchEvent(
        new TestPointerEvent('pointercancel', {
          bubbles: true,
          pointerId: 1,
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    expect(cancel.onChange).not.toHaveBeenCalled();
    expect(viewport(cancel.svg)).toMatchObject({
      zoom: 2,
      origination: [50, 50],
    });
    await act(async () => {
      cancel.fire('pointerdown', 4, 12, 12);
      cancel.fire('pointerup', 4, 12, 12);
    });
    expect(cancel.onChange).not.toHaveBeenCalled();
    await act(async () => cancel.root.unmount());
    cancel.container.remove();

    const lost = await mount();
    await act(async () => {
      lost.fire('pointerdown', 1, 100, 100);
      lost.fire('pointerdown', 2, 300, 100);
      lost.fire('pointermove', 1, 140, 100);
      lost.fire('pointermove', 2, 340, 100);
      lost.svg.dispatchEvent(
        new Event('lostpointercapture', { bubbles: true }),
      );
      lost.svg.dispatchEvent(
        new Event('lostpointercapture', { bubbles: true }),
      );
    });
    expect(lost.onChange).not.toHaveBeenCalled();
    expect(viewport(lost.svg)).toMatchObject({
      zoom: 1,
      origination: [-40, 0],
    });
    await act(async () => {
      lost.fire('pointerdown', 5, 8, 8);
      lost.fire('pointerup', 5, 8, 8);
    });
    expect(lost.onChange).not.toHaveBeenCalled();
    await act(async () => lost.root.unmount());
    lost.container.remove();
  });
  it('stores a finite rotation after dragging the rotate handle', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onChange = vi.fn();
    const ref = createRef<FrameCanvasController>();
    await act(async () =>
      root.render(
        <FrameCanvas ref={ref} value={snapshot()} onChange={onChange} />,
      ),
    );
    const svg = container.querySelector('svg')!;
    svg.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    svg.setPointerCapture = () => {};
    svg.hasPointerCapture = () => true;
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: MouseEventInit & { pointerId: number }) {
        super(type, init);
        this.pointerId = init.pointerId;
      }
    }
    const fire = (target: EventTarget, type: string, x: number, y: number) =>
      target.dispatchEvent(
        new TestPointerEvent(type, {
          bubbles: true,
          pointerId: 1,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0,
        }),
      );
    await act(async () => {
      ref.current!.runtime.select({ focus: ['root'], ids: ['a'] });
    });
    const handle = container.querySelector('[data-rotate-handle]');
    expect(handle).toBeTruthy();
    await act(async () => {
      fire(handle!, 'pointerdown', 60, -18);
    });
    await act(async () => {
      fire(svg, 'pointermove', 113, 35);
    });
    await act(async () => {
      fire(svg, 'pointerup', 113, 35);
    });
    const geometry =
      onChange.mock.calls.at(-1)?.[0].snapshot.store.cells.a.geometry;
    expect(Number.isFinite(geometry.rotation)).toBe(true);
    expect(geometry.rotation).toBeCloseTo(Math.PI / 2);
    await act(async () => root.unmount());
    container.remove();
  });

  it('renders a frame-reference occurrence with resolved target content', async () => {
    const store: CellStore = {
      rootId: 'ws',
      cells: {
        ws: {
          ...createFrameCell('ws'),
          children: ['board', 'target'],
        } as FrameSnapshot['store']['cells'][string],
        board: { ...createFrameCell('board'), children: ['r1'] },
        target: {
          ...createFrameCell('target'),
          name: '目标画布',
          children: ['inner'],
        },
        r1: {
          id: 'r1',
          kind: 'frame-reference',
          cellType: 'node',
          geometry: { x: 0, y: 0, width: 400, height: 300 },
          data: { targetFrameId: 'target' },
        } as Cell,
        inner: {
          id: 'inner',
          kind: 'geometry',
          cellType: 'node',
          geometry: { x: 10, y: 10, width: 40, height: 30 },
        } as Cell,
      },
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const ref = createRef<FrameCanvasController>();
    await act(async () =>
      root.render(
        <FrameCanvas
          ref={ref}
          value={{ store }}
          frameId="board"
          onChange={() => {}}
        />,
      ),
    );
    expect(
      container.querySelector('[data-cell-kind="frame-reference"]'),
    ).toBeTruthy();
    // The target's content renders inside the occurrence shell.
    expect(container.querySelector('[data-cell-id="inner"]')).toBeTruthy();
    await act(async () => root.unmount());
    container.remove();
  });

  it('renders a missing placeholder for an unresolved reference', async () => {
    const store: CellStore = {
      rootId: 'ws',
      cells: {
        ws: { ...createFrameCell('ws'), children: ['board'] } as Cell,
        board: { ...createFrameCell('board'), children: ['r1'] },
        r1: {
          id: 'r1',
          kind: 'frame-reference',
          cellType: 'node',
          geometry: { x: 0, y: 0, width: 400, height: 300 },
          data: { targetFrameId: 'ghost' },
        } as Cell,
      },
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const ref = createRef<FrameCanvasController>();
    await act(async () =>
      root.render(
        <FrameCanvas
          ref={ref}
          value={{ store }}
          frameId="board"
          onChange={() => {}}
        />,
      ),
    );
    expect(container.querySelector('[data-frame-missing]')).toBeTruthy();
    await act(async () => root.unmount());
    container.remove();
  });

  it('acquires a reference instance after mount and keeps two shells distinct', async () => {
    const calls: string[] = [];
    const store: CellStore = {
      rootId: 'board',
      cells: {
        board: {
          ...createFrameCell('board'),
          children: ['r1', 'r2'],
        } as Cell,
        r1: {
          id: 'r1',
          kind: 'frame-reference',
          cellType: 'node',
          geometry: { x: 0, y: 0, width: 200, height: 120 },
          data: { targetFrameId: 'mind' },
        } as Cell,
        r2: {
          id: 'r2',
          kind: 'frame-reference',
          cellType: 'node',
          geometry: { x: 240, y: 0, width: 200, height: 120 },
          data: { targetFrameId: 'mind' },
        } as Cell,
        mind: {
          ...createFrameCell('mind'),
          children: ['topic'],
        } as Cell,
        topic: {
          id: 'topic',
          kind: 'geometry',
          cellType: 'node',
          geometry: { x: 0, y: 0, width: 40, height: 20 },
        } as Cell,
      },
    };
    const host = {
      get: () => {
        calls.push('get');
        return null;
      },
      acquire: (query: { refId: string }) => {
        calls.push(`acquire:${query.refId}`);
      },
      release: () => {
        calls.push('release');
      },
      commit: async () => ({ status: 'accepted' as const }),
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    expect(calls).toEqual([]);
    await act(async () =>
      root.render(
        <FrameCanvas
          value={{ store }}
          frameId="board"
          onChange={() => {}}
          instanceHost={host}
        />,
      ),
    );
    expect(calls.filter((call) => call.startsWith('acquire')).sort()).toEqual([
      'acquire:r1',
      'acquire:r2',
    ]);
    expect(container.querySelectorAll('[data-reference-instance]').length).toBe(
      2,
    );
    await act(async () => root.unmount());
    expect(calls.filter((call) => call === 'release').length).toBe(2);
    container.remove();
  });
});

describe('reference instance editing', () => {
  const mindStore = (): CellStore => ({
    rootId: 'mind',
    cells: {
      mind: { ...createFrameCell('mind'), children: ['topic'] } as Cell,
      topic: {
        id: 'topic',
        kind: 'geometry',
        cellType: 'node',
        geometry: { x: 20, y: 20, width: 80, height: 40 },
        content: { label: '主题' },
        ports: [{ id: 'p', direction: 'both', side: 'right' }],
      } as Cell,
    },
  });
  const boardStore = (): CellStore => ({
    rootId: 'board',
    cells: {
      board: {
        ...createFrameCell('board'),
        children: ['r1', 'r2', 'preview'],
      } as Cell,
      r1: {
        id: 'r1',
        kind: 'frame-reference',
        cellType: 'node',
        geometry: { x: 0, y: 40, width: 280, height: 180 },
        data: { targetFrameId: 'mind' },
      } as Cell,
      r2: {
        id: 'r2',
        kind: 'frame-reference',
        cellType: 'node',
        geometry: { x: 320, y: 40, width: 280, height: 180 },
        data: { targetFrameId: 'mind' },
      } as Cell,
      preview: {
        id: 'preview',
        kind: 'frame-reference',
        cellType: 'node',
        geometry: { x: 0, y: 260, width: 280, height: 180 },
        data: { targetFrameId: 'empty' },
      } as Cell,
      empty: { ...createFrameCell('empty'), children: [] } as Cell,
    },
  });

  const pointer = (type: string) =>
    new (class extends MouseEvent {
      pointerId = 1;
      constructor() {
        super(type, { bubbles: true, button: 0, clientX: 30, clientY: 30 });
      }
    })();

  const mount = async (options?: {
    readonlyPreview?: boolean;
    onExit?: (id: string) => void;
  }) => {
    const left = createCellRuntime({ store: mindStore() });
    const right = createCellRuntime({ store: mindStore() });
    const empty = createCellRuntime({
      store: {
        rootId: 'empty',
        cells: { empty: createFrameCell('empty') as Cell },
      },
    });
    const commits: { id: string; cellIds: string[] }[] = [];
    const active: string[] = [];
    const host = {
      get: (query: { refId: string }) => {
        if (query.refId === 'preview')
          return {
            occurrenceId: 'preview',
            runtime: empty,
            readonly: true,
            preview: true,
          };
        const runtime = query.refId === 'r1' ? left : right;
        return {
          occurrenceId: query.refId,
          runtime,
          readonly: false,
          preview: false,
        };
      },
      acquire: () => {},
      release: () => {},
      commit: async (
        id: string,
        transaction: {
          operations: {
            type: string;
            cell?: { id: string };
            cellId?: string;
          }[];
        },
      ) => {
        const runtime = id === 'r1' ? left : id === 'r2' ? right : empty;
        try {
          runtime.transact({ ...transaction, history: false });
          if (id === 'r1' || id === 'r2') {
            (id === 'r1' ? right : left).transact({
              ...transaction,
              history: false,
            });
          }
        } catch (error) {
          return {
            status: 'rejected' as const,
            message: error instanceof Error ? error.message : String(error),
          };
        }
        commits.push({
          id,
          cellIds: transaction.operations.map(
            (operation) => operation.cell?.id ?? operation.cellId ?? '',
          ),
        });
        return { status: 'accepted' as const };
      },
      updateMindOffset: () => {},
    };
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const parentSelection = vi.fn();
    await act(async () =>
      root.render(
        <FrameCanvas
          value={{ store: boardStore() }}
          frameId="board"
          onChange={() => {}}
          onSelectionChange={parentSelection}
          onActiveInstance={(id) => {
            active.push(id ?? 'parent');
          }}
          instanceHost={host}
        />,
      ),
    );
    const cell = (instance: string, id: string) =>
      container.querySelector(
        `[data-reference-instance="${instance}"] [data-cell-id="${id}"]`,
      );
    return {
      container,
      root,
      left,
      right,
      empty,
      commits,
      active,
      cell,
      parentSelection,
    };
  };

  it('selects and hovers one reference without selecting the other', async () => {
    const view = await mount();
    const first = view.cell('r1', 'topic')!;
    const second = view.cell('r2', 'topic')!;
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    await act(async () => {
      first.dispatchEvent(pointer('pointerenter'));
      first.dispatchEvent(pointer('pointerover'));
    });
    expect(
      view.container.querySelectorAll(
        '[data-reference-instance="r1"] [data-port-id="p"]',
      ).length,
    ).toBeGreaterThan(0);
    expect(
      view.container.querySelector(
        '[data-reference-instance="r2"] [data-port-id="p"]',
      ),
    ).toBeNull();
    await act(async () => {
      first.dispatchEvent(pointer('pointerdown'));
    });
    expect(view.left.selection.ids).toEqual(['topic']);
    expect(view.right.selection.ids).toEqual([]);
    await act(async () => {
      second.dispatchEvent(pointer('pointerdown'));
    });
    expect(view.right.selection.ids).toEqual(['topic']);
    expect(view.left.selection.ids).toEqual(['topic']);
    await act(async () => rootUnmount(view));
  });

  it('edits the active instance, copies that selection, and ignores a read-only preview', async () => {
    const view = await mount();
    const first = view.cell('r1', 'topic')!;
    await act(async () => {
      first.dispatchEvent(pointer('pointerdown'));
    });
    const nested = view.container.querySelector(
      '[data-reference-instance="r1"] svg',
    )!;
    const data = new Map<string, string>();
    await act(async () => {
      nested.dispatchEvent(
        Object.assign(new Event('copy', { bubbles: true, cancelable: true }), {
          clipboardData: {
            setData: (type: string, value: string) => data.set(type, value),
            getData: () => '',
          },
        }),
      );
    });
    expect(data.get('application/x-verd-cells')).toContain('topic');
    expect(data.get('application/x-verd-cells')).not.toContain('"r1"');
    await act(async () => {
      nested.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
      );
    });
    expect(view.commits.some((commit) => commit.id === 'r1')).toBe(true);
    expect(view.left.store.cells.topic).toBeUndefined();
    expect(view.right.store.cells.topic).toBeUndefined();
    expect(
      view.container.querySelector('[data-cell-kind="frame-reference"]'),
    ).toBeTruthy();
    const preview = view.container.querySelector('[data-preview-open]');
    expect(preview?.textContent).toContain('打开编辑');
    const previewSvg = view.container.querySelector(
      '[data-reference-instance="preview"] svg',
    )!;
    const commitsBefore = view.commits.length;
    await act(async () => {
      previewSvg.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
      );
    });
    expect(view.commits.length).toBe(commitsBefore);
    await act(async () => rootUnmount(view));
  });

  it('ends text edit before leaving the instance, and shell or blank returns to the parent', async () => {
    const view = await mount();
    const first = view.cell('r1', 'topic')!;
    await act(async () => {
      first.dispatchEvent(pointer('pointerdown'));
      first.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const nested = view.container.querySelector(
      '[data-reference-instance="r1"] svg',
    )!;
    const exitsBefore = view.active.filter((id) => id === 'parent').length;
    await act(async () => {
      nested.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(view.active.filter((id) => id === 'parent').length).toBe(
      exitsBefore,
    );
    await act(async () => {
      nested.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(view.active.at(-1)).toBe('parent');
    expect(view.parentSelection.mock.calls.at(-1)?.[0].ids).toContain('r1');
    await act(async () => {
      first.dispatchEvent(pointer('pointerdown'));
    });
    const shell = view.container.querySelector('[data-cell-id="r1"]')!;
    await act(async () => {
      shell.dispatchEvent(pointer('pointerdown'));
    });
    expect(view.active.at(-1)).toBe('parent');
    const svg = view.container.querySelector('svg[data-surface="root"]')!;
    await act(async () => {
      first.dispatchEvent(pointer('pointerdown'));
      svg.dispatchEvent(pointer('pointerdown'));
    });
    expect(view.active.at(-1)).toBe('parent');
    await act(async () => rootUnmount(view));
  });

  it('keeps an inner mind node inside the reference surface so a pointer selects it', async () => {
    const shell = { x: 400, y: 280, width: 280, height: 180 };
    const mind = createCellRuntime({ store: mindStore() });
    const store: CellStore = {
      rootId: 'board',
      cells: {
        board: {
          ...createFrameCell('board'),
          children: ['r1'],
        } as Cell,
        r1: {
          id: 'r1',
          kind: 'frame-reference',
          cellType: 'node',
          geometry: shell,
          data: { targetFrameId: 'mind' },
        } as Cell,
      },
    };
    const host = {
      get: () => ({
        occurrenceId: 'r1',
        runtime: mind,
        readonly: false,
        preview: false,
      }),
      acquire: () => {},
      release: () => {},
      commit: async () => ({ status: 'accepted' as const }),
    };
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <FrameCanvas
          value={{ store }}
          frameId="board"
          onChange={() => {}}
          instanceHost={host}
          onActiveInstance={() => {}}
        />,
      ),
    );
    const viewport = frameContentViewport(shell);
    const world = container.querySelector(
      '[data-reference-instance="r1"] [data-frame-world]',
    );
    expect(world?.getAttribute('transform')).toBe(
      `scale(1) translate(${-viewport.x} ${-viewport.y})`,
    );
    const topic = container.querySelector(
      '[data-reference-instance="r1"] [data-cell-id="topic"]',
    )!;
    await act(async () => {
      topic.dispatchEvent(pointer('pointerdown'));
    });
    expect(mind.selection.ids).toEqual(['topic']);
    await act(async () => root.unmount());
    container.remove();
  });

  it('renders a regular-canvas preview by resolving the references inside it', async () => {
    const mind = createCellRuntime({ store: mindStore() });
    const page = createCellRuntime({
      store: {
        rootId: 'page',
        cells: {
          page: { ...createFrameCell('page'), children: ['inner'] } as Cell,
          inner: {
            id: 'inner',
            kind: 'frame-reference',
            cellType: 'node',
            geometry: { x: 24, y: 24, width: 200, height: 120 },
            data: { targetFrameId: 'mind' },
          } as Cell,
        },
      },
    });
    const store: CellStore = {
      rootId: 'board',
      cells: {
        board: {
          ...createFrameCell('board'),
          children: ['preview'],
        } as Cell,
        preview: {
          id: 'preview',
          kind: 'frame-reference',
          cellType: 'node',
          geometry: { x: 0, y: 40, width: 320, height: 220 },
          data: { targetFrameId: 'page' },
        } as Cell,
      },
    };
    const host = {
      get: (query: { refId: string }) => {
        if (query.refId === 'preview')
          return {
            occurrenceId: 'preview',
            runtime: page,
            readonly: true,
            preview: true,
          };
        if (query.refId === 'inner')
          return {
            occurrenceId: 'inner',
            runtime: mind,
            readonly: true,
            preview: false,
          };
        return null;
      },
      acquire: () => {},
      release: () => {},
      commit: async () => ({ status: 'accepted' as const }),
    };
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <FrameCanvas
          value={{ store }}
          frameId="board"
          onChange={() => {}}
          instanceHost={host}
        />,
      ),
    );
    const preview = container.querySelector(
      '[data-reference-instance="preview"]',
    )!;
    expect(preview.textContent).toContain('主题');
    expect(preview.textContent).not.toContain('引用缺失');
    expect(preview.textContent).toContain('打开原画布');
    await act(async () => root.unmount());
    container.remove();
  });
});

const rootUnmount = async (view: {
  root: ReturnType<typeof createRoot>;
  container: HTMLElement;
}) => {
  view.root.unmount();
  view.container.remove();
};
