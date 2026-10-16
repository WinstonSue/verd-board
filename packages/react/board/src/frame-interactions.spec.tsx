import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyCellOperations,
  createCellStore,
  createFrameCell,
  groupCells,
  type FrameSnapshot,
  type EdgeCell,
  type GroupCell,
  type NodeCell,
} from '@sue/board-core';
import { FrameCanvas, type FrameCanvasController } from './frame-canvas';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});
const fixture = (): FrameSnapshot => ({
  store: applyCellOperations(createCellStore(createFrameCell('root')), [
    {
      type: 'insert_cell',
      parentId: 'root',
      cell: {
        ...createFrameCell('nested'),
        geometry: { x: 100.4, y: 120.7, width: 320, height: 240 },
        content: { label: 'Nested' },
      },
    },
    {
      type: 'insert_cell',
      parentId: 'nested',
      cell: {
        id: 'leaf',
        cellType: 'node',
        kind: 'geometry',
        geometry: { x: -10.4, y: 20.7, width: 600, height: 400 },
        content: { label: 'Leaf' },
      },
    },
  ]),
});
const mount = async (
  options: {
    readonly?: boolean;
    pending?: boolean;
    value?: FrameSnapshot;
    onCanvasContextMenu?: (point: [number, number] | null) => void;
  } = {},
) => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container),
    controller = createRef<FrameCanvasController>();
  const value = options.value ?? fixture(),
    onChange = vi.fn(),
    onIntent = vi.fn();
  let release!: (result: { status: 'rejected' }) => void;
  onIntent.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await act(async () =>
    root.render(
      <FrameCanvas
        ref={controller}
        value={value}
        autoFit={false}
        readonly={options.readonly}
        onCanvasContextMenu={options.onCanvasContextMenu}
        {...(options.pending
          ? {
              adapter: { toFrameSnapshot: (value: FrameSnapshot) => value },
              onIntent,
            }
          : { onChange })}
      />,
    ),
  );
  const svg = container.querySelector('svg')!;
  svg.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      toJSON() {},
    }) as DOMRect;
  svg.setPointerCapture = vi.fn();
  svg.hasPointerCapture = () => false;
  const fire = async (
    target: EventTarget,
    type: string,
    x: number,
    y: number,
    modifiers: MouseEventInit & { pointerId?: number } = {},
  ) => {
    await act(async () => {
      const { pointerId = 1, ...init } = modifiers;
      const button = init.button ?? 0;
      const event = new MouseEvent(type, {
        bubbles: true,
        button,
        buttons:
          type === 'pointerdown' || type === 'pointermove'
            ? button === 1
              ? 4
              : button === 2
                ? 2
                : 1
            : 0,
        clientX: x,
        clientY: y,
        ...init,
      });
      Object.defineProperty(event, 'pointerId', { value: pointerId });
      target.dispatchEvent(event);
    });
  };
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return {
    container,
    controller,
    svg,
    fire,
    onChange,
    onIntent,
    release: () => release({ status: 'rejected' }),
  };
};

describe('Frame shell interactions', () => {
  it('activates the enclosing shell without moving its title or content, and keeps child selections inactive', async () => {
    const test = await mount(),
      runtime = test.controller.current!.runtime;
    const shell = test.container.querySelector(
      '[data-cell-id="nested"] [data-frame-shell]',
    )!;
    const title = test.container.querySelector(
      '[data-frame-title-id="nested"] foreignObject',
    )!;
    const placement = test.container.querySelector(
      '[data-frame-content-id="nested"]',
    )!;
    const before = {
      x: title.getAttribute('x'),
      y: title.getAttribute('y'),
      transform: placement.getAttribute('transform'),
    };
    expect(shell.getAttribute('data-frame-active')).toBe('false');
    await act(async () => runtime.select({ focus: ['root'], ids: ['nested'] }));
    expect(shell.getAttribute('data-frame-active')).toBe('true');
    expect({
      x: title.getAttribute('x'),
      y: title.getAttribute('y'),
      transform: placement.getAttribute('transform'),
    }).toEqual(before);
    await act(async () =>
      runtime.select({ focus: ['root', 'nested'], ids: ['leaf'] }),
    );
    expect(shell.getAttribute('data-frame-active')).toBe('false');
  });
  it.each(['shell', 'title'] as const)(
    'moves the %s only after the threshold, commits once and leaves canonical descendants untouched',
    async (handle) => {
      const test = await mount();
      const runtime = test.controller.current!.runtime,
        original = runtime.store;
      const target = test.container.querySelector(
        handle === 'shell'
          ? '[data-cell-id="nested"] > rect'
          : '[data-frame-title-id="nested"] > rect',
      )!;
      await test.fire(target, 'pointerdown', 120, 160);
      expect(test.svg.setPointerCapture).not.toHaveBeenCalled();
      await test.fire(test.svg, 'pointermove', 121, 161);
      expect(test.svg.setPointerCapture).not.toHaveBeenCalled();
      await test.fire(test.svg, 'pointermove', 163.6, 187.3);
      expect(test.svg.setPointerCapture).toHaveBeenCalledOnce();
      expect(test.onChange).not.toHaveBeenCalled();
      expect(runtime.store).toBe(original);
      await test.fire(test.svg, 'pointerup', 163.6, 187.3);
      expect(test.onChange).toHaveBeenCalledOnce();
      expect((runtime.store.cells.nested as NodeCell).geometry).toMatchObject({
        x: 144,
        y: 148,
      });
      expect(runtime.store.cells.leaf).toEqual(original.cells.leaf);
      expect(runtime.history.undos).toHaveLength(1);
      await act(async () => test.controller.current!.undo());
      expect(runtime.store).toEqual(original);
      await act(async () => test.controller.current!.redo());
      expect((runtime.store.cells.nested as NodeCell).geometry).toMatchObject({
        x: 144,
        y: 148,
      });
    },
  );

  it.each(['selection', 'group'] as const)(
    'moves every selected Frame content transform with its %s preview',
    async (mode) => {
      const test = await mount(),
        runtime = test.controller.current!.runtime;
      await act(async () => {
        await test.controller.current!.dispatch({
          id: 'second',
          operations: [
            {
              type: 'insert_cell',
              parentId: 'root',
              cell: {
                ...createFrameCell('second'),
                geometry: { x: 500.7, y: 200.2, width: 240, height: 180 },
                content: { label: 'Second' },
              },
            },
            {
              type: 'insert_cell',
              parentId: 'second',
              cell: { ...runtime.store.cells.leaf, id: 'second-leaf' },
            },
          ],
        });
        if (mode === 'group')
          await test.controller.current!.dispatch({
            id: 'group',
            operations: groupCells(
              runtime.store,
              'root',
              ['nested', 'second'],
              'group',
            ),
          });
        runtime.select({
          focus: ['root'],
          ids: mode === 'group' ? ['group'] : ['nested', 'second'],
        });
      });
      const original = runtime.store,
        history = runtime.history.undos.length;
      test.onChange.mockClear();
      const transform = (id: string) =>
        test.container
          .querySelector(`[data-frame-content-id="${id}"]`)!
          .getAttribute('transform')!
          .match(/translate\(([^ ]+) ([^)]+)\)/)!
          .slice(1)
          .map(Number);
      const before = new Map(
        ['nested', 'second'].map((id) => [id, transform(id)]),
      );
      await test.fire(
        test.container.querySelector('[data-frame-title-id="nested"] > rect')!,
        'pointerdown',
        120,
        100,
      );
      await test.fire(test.svg, 'pointermove', 163.6, 127.3);
      for (const id of ['nested', 'second']) {
        const geometry = (original.cells[id] as NodeCell).geometry;
        const after = transform(id),
          old = before.get(id)!;
        expect(after[0] - old[0]).toBeCloseTo(
          Math.round(geometry.x + 43.6) - geometry.x,
        );
        expect(after[1] - old[1]).toBeCloseTo(
          Math.round(geometry.y + 27.3) - geometry.y,
        );
      }
      const previews = new Map(
        ['nested', 'second'].map((id) => [id, transform(id)]),
      );
      expect(test.onChange).not.toHaveBeenCalled();
      await test.fire(test.svg, 'pointerup', 163.6, 127.3);
      expect(test.onChange).toHaveBeenCalledOnce();
      expect(runtime.history.undos).toHaveLength(history + 1);
      expect(runtime.store.cells.leaf).toEqual(original.cells.leaf);
      expect(runtime.store.cells['second-leaf']).toEqual(
        original.cells['second-leaf'],
      );
      for (const id of ['nested', 'second'])
        expect(transform(id)).toEqual(previews.get(id));
      await act(async () => test.controller.current!.undo());
      expect(runtime.store).toEqual(original);
    },
  );

  it('cancels a Frame move without publishing or recording history', async () => {
    const test = await mount(),
      runtime = test.controller.current!.runtime;
    const original = runtime.store;
    await test.fire(
      test.container.querySelector('[data-frame-title-id] > rect')!,
      'pointerdown',
      120,
      100,
    );
    await test.fire(test.svg, 'pointermove', 160, 130);
    await test.fire(test.svg, 'pointercancel', 160, 130);
    await test.fire(test.svg, 'pointerup', 160, 130);
    expect(runtime.store).toBe(original);
    expect(test.onChange).not.toHaveBeenCalled();
    expect(runtime.history.undos).toHaveLength(0);
  });

  it('resizes an owned Frame shell without changing descendant coordinates', async () => {
    const test = await mount(),
      runtime = test.controller.current!.runtime;
    const original = runtime.store;
    await act(async () => runtime.select({ focus: ['root'], ids: ['nested'] }));
    const handle = test.container.querySelector(
      '[data-handle-cell="nested"][data-resize-handle="se"]',
    )!;
    expect(handle).not.toBeNull();
    await test.fire(handle, 'pointerdown', 420.4, 360.7);
    await test.fire(test.svg, 'pointermove', 460.8, 391.4);
    const preview = test.container.querySelector(
      '[data-cell-id="nested"] > rect',
    )!;
    expect(preview.getAttribute('width')).toBe('360');
    expect(preview.getAttribute('height')).toBe('271');
    await test.fire(test.svg, 'pointerup', 460.8, 391.4);
    expect(test.onChange).toHaveBeenCalledOnce();
    expect((runtime.store.cells.nested as NodeCell).geometry).toMatchObject({
      width: 360,
      height: 271,
    });
    expect(runtime.store.cells.leaf).toEqual(original.cells.leaf);
    await act(async () => test.controller.current!.undo());
    expect(runtime.store).toEqual(original);
  });

  it.each(['readonly', 'pending'] as const)(
    'blocks Frame rename and movement while %s',
    async (mode) => {
      const test = await mount({ [mode]: true }),
        runtime = test.controller.current!.runtime;
      const original = runtime.store;
      let request: Promise<unknown> | undefined;
      if (mode === 'pending') {
        await act(async () => {
          request = test.controller.current!.dispatch({
            id: 'pending',
            operations: [
              {
                type: 'replace_cell',
                cell: {
                  ...runtime.store.cells.leaf,
                  content: { label: 'Awaiting host' },
                },
              },
            ],
          });
        });
        expect(test.onIntent).toHaveBeenCalledOnce();
      }
      await act(async () => test.controller.current!.editText('nested'));
      expect(document.querySelector('[data-frame-title-editor]')).toBeNull();
      for (const selector of [
        '[data-frame-title-id] > rect',
        '[data-cell-id="nested"] > rect',
      ]) {
        await test.fire(
          test.container.querySelector(selector)!,
          'pointerdown',
          120,
          100,
        );
        await test.fire(test.svg, 'pointermove', 160, 130);
        await test.fire(test.svg, 'pointerup', 160, 130);
      }
      expect(runtime.store).toBe(original);
      expect(test.svg.setPointerCapture).not.toHaveBeenCalled();
      expect(runtime.history.undos).toHaveLength(0);
      if (mode === 'pending') {
        await act(async () => {
          test.release();
          await request;
        });
        expect(test.onIntent).toHaveBeenCalledOnce();
      } else expect(test.onChange).not.toHaveBeenCalled();
    },
  );
});

const freeFixture = (): FrameSnapshot => ({
  store: applyCellOperations(createCellStore(createFrameCell('root')), [
    ...['a', 'b', 'c', 'd'].map((id, i) => ({
      type: 'insert_cell' as const,
      parentId: 'root',
      cell: {
        id,
        kind: 'geometry',
        cellType: 'node' as const,
        geometry: { x: i * 100, y: 100, width: 40, height: 20 },
        content: { label: id },
      },
    })),
    {
      type: 'insert_cell',
      parentId: 'root',
      cell: {
        id: 'free-edge',
        kind: 'arrow',
        cellType: 'edge',
        source: { point: [0, 140] },
        target: { point: [40, 140] },
        route: {
          mode: 'fixed',
          points: [
            [0, 140],
            [40, 140],
          ],
        },
      } as EdgeCell,
    },
  ]),
});

const groupedFixture = () => {
  let value = freeFixture();
  value = {
    store: applyCellOperations(
      value.store,
      groupCells(value.store, 'root', ['a', 'b', 'free-edge'], 'inner'),
    ),
  };
  value = {
    store: applyCellOperations(
      value.store,
      groupCells(value.store, 'root', ['inner', 'c'], 'outer'),
    ),
  };
  return value;
};

describe('arrangement and group interaction', () => {
  it('fits the selected nodes in one transaction and preserves geometry on host rejection', async () => {
    const value = freeFixture();
    const test = await mount({ value });
    await act(async () =>
      test.controller.current!.runtime.select({
        focus: ['root'],
        ids: ['a', 'b'],
      }),
    );
    expect(
      test.controller.current!.selectionCommandState({ type: 'fit-content' })
        .enabled,
    ).toBe(true);
    await act(async () => {
      await test.controller.current!.executeSelectionCommand({
        type: 'fit-content',
      });
    });
    expect(test.onChange).toHaveBeenCalledTimes(1);
    const a = test.controller.current!.runtime.store.cells.a as NodeCell;
    expect(a.geometry.x).toBe((value.store.cells.a as NodeCell).geometry.x);
    expect(a.geometry.y).toBe((value.store.cells.a as NodeCell).geometry.y);
    await act(async () => test.controller.current!.undo());
    expect(test.controller.current!.runtime.store.cells.a).toEqual(
      value.store.cells.a,
    );
    const host = await mount({ value, pending: true });
    await act(async () =>
      host.controller.current!.runtime.select({
        focus: ['root'],
        ids: ['a', 'b'],
      }),
    );
    let promise!: ReturnType<FrameCanvasController['executeSelectionCommand']>;
    await act(async () => {
      promise = host.controller.current!.executeSelectionCommand({
        type: 'fit-content',
      });
    });
    expect(
      host.controller.current!.selectionCommandState({ type: 'fit-content' })
        .enabled,
    ).toBe(false);
    expect(host.controller.current!.runtime.store).toEqual(value.store);
    await act(async () => {
      host.release();
      expect((await promise).status).toBe('rejected');
    });
    expect(host.controller.current!.runtime.store).toEqual(value.store);
  });

  it('selects the outer group, drills down, exits with Esc, and regroups inside its focus', async () => {
    const test = await mount({ value: groupedFixture() });
    const node = test.container.querySelector('[data-cell-id="a"]')!;
    await test.fire(node, 'pointerdown', 20, 110);
    await test.fire(test.svg, 'pointerup', 20, 110);
    expect(test.controller.current!.runtime.selection.ids).toEqual(['outer']);
    await test.fire(node, 'dblclick', 20, 110);
    expect(test.controller.current!.runtime.selection).toEqual({
      focus: ['root', 'outer'],
      ids: ['inner'],
    });
    await test.fire(node, 'dblclick', 20, 110);
    expect(test.controller.current!.runtime.selection).toEqual({
      focus: ['root', 'outer', 'inner'],
      ids: ['a'],
    });
    await act(async () =>
      test.svg.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(test.controller.current!.runtime.selection).toEqual({
      focus: ['root', 'outer'],
      ids: ['inner'],
    });
    await act(async () => {
      await test.controller.current!.executeSelectionCommand({
        type: 'ungroup',
      });
    });
    expect(test.controller.current!.runtime.selection).toEqual({
      focus: ['root', 'outer'],
      ids: ['a', 'b', 'free-edge'],
    });
    await act(async () => {
      await test.controller.current!.executeSelectionCommand({ type: 'group' });
    });
    const id = test.controller.current!.runtime.selection.ids[0];
    expect(
      (test.controller.current!.runtime.store.cells[id] as GroupCell).members,
    ).toEqual(['a', 'b', 'free-edge']);
    expect(test.controller.current!.runtime.selection.focus).toEqual([
      'root',
      'outer',
    ]);
  });

  it('previews every nested group leaf and free route before one undoable commit', async () => {
    const value = groupedFixture(),
      test = await mount({ value });
    await test.fire(
      test.container.querySelector('[data-cell-id="a"]')!,
      'pointerdown',
      20,
      110,
    );
    await test.fire(test.svg, 'pointermove', 33, 127, { altKey: true });
    expect(
      test.container
        .querySelector('[data-cell-id="b"] path')
        ?.getAttribute('d'),
    ).toContain('113');
    expect(
      test.container
        .querySelector('[data-cell-id="free-edge"] path')
        ?.getAttribute('d'),
    ).toContain('157');
    expect(
      (test.controller.current!.runtime.store.cells.b as NodeCell).geometry.x,
    ).toBe(100);
    await test.fire(test.svg, 'pointerup', 33, 127, { altKey: true });
    expect(
      (test.controller.current!.runtime.store.cells.b as NodeCell).geometry.x,
    ).toBe(113);
    expect(
      (test.controller.current!.runtime.store.cells['free-edge'] as EdgeCell)
        .source,
    ).toEqual({ point: [13, 157] });
    expect(test.onChange).toHaveBeenCalledTimes(1);
    await act(async () => test.controller.current!.undo());
    expect(test.controller.current!.runtime.store).toEqual(value.store);
  });

  it('shows temporary guides, snaps the committed coordinates, and supports Alt bypass', async () => {
    const test = await mount({ value: freeFixture() });
    await test.fire(
      test.container.querySelector('[data-cell-id="a"]')!,
      'pointerdown',
      20,
      110,
    );
    await test.fire(test.svg, 'pointermove', 117, 112);
    expect(
      test.container.querySelector('[data-alignment-guides]'),
    ).not.toBeNull();
    await test.fire(test.svg, 'pointerup', 117, 112);
    expect(
      (test.controller.current!.runtime.store.cells.a as NodeCell).geometry,
    ).toMatchObject({ x: 100, y: 100 });
    expect(test.container.querySelector('[data-alignment-guides]')).toBeNull();
    await act(async () => test.controller.current!.undo());
    await test.fire(
      test.container.querySelector('[data-cell-id="a"]')!,
      'pointerdown',
      20,
      110,
    );
    await test.fire(test.svg, 'pointermove', 117, 112, { altKey: true });
    expect(test.container.querySelector('[data-alignment-guides]')).toBeNull();
    await test.fire(test.svg, 'pointerup', 117, 112, { altKey: true });
    expect(
      (test.controller.current!.runtime.store.cells.a as NodeCell).geometry,
    ).toMatchObject({ x: 97, y: 102 });
  });

  it('shares keyboard grouping with commands and leaves locked group members unchanged', async () => {
    const test = await mount({ value: freeFixture() });
    const runtime = test.controller.current!.runtime;
    await act(async () => runtime.select({ focus: ['root'], ids: ['a', 'b'] }));
    await act(async () =>
      test.svg.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'g',
          ctrlKey: true,
          bubbles: true,
        }),
      ),
    );
    const id = runtime.selection.ids[0];
    expect(runtime.store.cells[id].cellType).toBe('group');
    await act(async () => {
      await test.controller.current!.executeSelectionCommand({ type: 'lock' });
    });
    expect(
      test.controller.current!.selectionCommandState({ type: 'ungroup' })
        .enabled,
    ).toBe(false);
    await test.fire(
      test.container.querySelector('[data-cell-id="a"]')!,
      'dblclick',
      20,
      110,
    );
    expect(runtime.selection.focus).toEqual(['root']);
    await act(async () => {
      await test.controller.current!.executeSelectionCommand({
        type: 'unlock',
      });
    });
    await act(async () =>
      test.svg.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'G',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      ),
    );
    expect(runtime.store.cells[id]).toBeUndefined();
    expect(runtime.selection.ids).toEqual(['a', 'b']);
  });

  it('can enter an unlocked group with a locked leaf to unlock that leaf', async () => {
    let value = freeFixture();
    value = {
      store: applyCellOperations(
        value.store,
        groupCells(value.store, 'root', ['a', 'b'], 'group'),
      ),
    };
    value = {
      store: applyCellOperations(value.store, [
        {
          type: 'replace_cell',
          cell: { ...value.store.cells.a, locked: true },
        },
      ]),
    };
    const test = await mount({ value });
    const a = test.container.querySelector('[data-cell-id="a"]')!;
    await test.fire(a, 'pointerdown', 20, 110);
    await test.fire(test.svg, 'pointerup', 20, 110);
    await test.fire(a, 'dblclick', 20, 110);
    expect(test.controller.current!.runtime.selection).toEqual({
      focus: ['root', 'group'],
      ids: ['a'],
    });
    await act(async () => {
      await test.controller.current!.executeSelectionCommand({
        type: 'unlock',
      });
    });
    expect(test.controller.current!.runtime.store.cells.a.locked).toBe(false);
  });

  it('cancels guides without committing positions and prevents pending command overlap', async () => {
    const test = await mount({ value: freeFixture() });
    await test.fire(
      test.container.querySelector('[data-cell-id="a"]')!,
      'pointerdown',
      20,
      110,
    );
    await test.fire(test.svg, 'pointermove', 117, 112);
    expect(
      test.container.querySelector('[data-alignment-guides]'),
    ).not.toBeNull();
    await test.fire(test.svg, 'pointercancel', 117, 112);
    expect(test.container.querySelector('[data-alignment-guides]')).toBeNull();
    expect(test.onChange).not.toHaveBeenCalled();
    const pending = await mount({ value: freeFixture(), pending: true });
    await act(async () =>
      pending.controller.current!.runtime.select({
        focus: ['root'],
        ids: ['a', 'b'],
      }),
    );
    let promise!: ReturnType<FrameCanvasController['executeSelectionCommand']>;
    await act(async () => {
      promise = pending.controller.current!.executeSelectionCommand({
        type: 'group',
      });
    });
    expect(
      pending.controller.current!.selectionCommandState({ type: 'group' })
        .enabled,
    ).toBe(false);
    expect(pending.controller.current!.runtime.store).toEqual(
      freeFixture().store,
    );
    await act(async () => {
      pending.release();
      await promise;
    });
    expect(pending.controller.current!.runtime.store).toEqual(
      freeFixture().store,
    );
  });

  it('moves a whole group when a free connector member is dragged', async () => {
    const value = groupedFixture(),
      test = await mount({ value });
    await test.fire(
      test.container.querySelector('[data-cell-id="free-edge"]')!,
      'pointerdown',
      20,
      140,
    );
    await test.fire(test.svg, 'pointermove', 33, 157, { altKey: true });
    await test.fire(test.svg, 'pointerup', 33, 157, { altKey: true });
    expect(
      (test.controller.current!.runtime.store.cells.b as NodeCell).geometry.x,
    ).toBe(113);
    expect(
      (test.controller.current!.runtime.store.cells['free-edge'] as EdgeCell)
        .source,
    ).toEqual({ point: [13, 157] });
  });
});

it('a locked containing group makes an opened member Frame read-only', async () => {
  let store = fixture().store;
  store = applyCellOperations(store, [
    {
      type: 'insert_cell',
      parentId: 'root',
      cell: {
        id: 'sibling',
        cellType: 'node',
        kind: 'geometry',
        geometry: { x: 500, y: 0, width: 40, height: 20 },
      },
    },
  ]);
  store = applyCellOperations(
    store,
    groupCells(store, 'root', ['nested', 'sibling'], 'group'),
  );
  store = applyCellOperations(store, [
    { type: 'replace_cell', cell: { ...store.cells.group, locked: true } },
  ]);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container),
    controller = createRef<FrameCanvasController>(),
    onChange = vi.fn();
  await act(async () =>
    root.render(
      <FrameCanvas
        ref={controller}
        value={{ store }}
        frameId="nested"
        autoFit={false}
        onChange={onChange}
      />,
    ),
  );
  await act(async () =>
    controller.current!.runtime.select({ focus: ['nested'], ids: ['leaf'] }),
  );
  expect(
    controller.current!.selectionCommandState({ type: 'lock' }).enabled,
  ).toBe(false);
  await act(async () => {
    const result = await controller.current!.dispatch({
      id: 'edit',
      operations: [
        { type: 'replace_cell', cell: { ...store.cells.leaf, hidden: true } },
      ],
    });
    expect(result.status).toBe('rejected');
  });
  expect(onChange).not.toHaveBeenCalled();
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
});

describe('released pointer button state', () => {
  const worldTransform = (svg: SVGSVGElement) =>
    svg.querySelector('[data-frame-world]')!.getAttribute('transform');
  const shapePath = (container: HTMLElement, id: string) =>
    container.querySelector(`[data-cell-id="${id}"] path`)!.getAttribute('d');
  const paint = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

  it('keeps the node and canvas still when a left click follows a released right click', async () => {
    const onCanvasContextMenu = vi.fn();
    const test = await mount({
      value: freeFixture(),
      onCanvasContextMenu,
    });
    const runtime = test.controller.current!.runtime,
      original = runtime.store;
    const node = test.container.querySelector('[data-cell-id="a"]')!;
    const camera = worldTransform(test.svg),
      outline = shapePath(test.container, 'a');
    await test.fire(node, 'pointerdown', 20, 110, { button: 2 });
    await test.fire(node, 'contextmenu', 20, 110, { button: 2 });
    await test.fire(test.svg, 'pointerup', 20, 110, { button: 2 });
    await test.fire(test.svg, 'pointermove', 30, 115, { buttons: 0 });
    await test.fire(test.svg, 'pointermove', 36, 118, { buttons: 0 });
    await test.fire(node, 'pointerdown', 36, 118);
    await test.fire(test.svg, 'pointerup', 36, 118);
    await test.fire(test.svg, 'pointermove', 39, 119, { buttons: 0 });
    await test.fire(test.svg, 'pointermove', 30, 112, { buttons: 0 });
    await paint();
    expect(runtime.selection.ids).toEqual(['a']);
    expect(shapePath(test.container, 'a')).toBe(outline);
    expect(worldTransform(test.svg)).toBe(camera);
    expect(runtime.store).toBe(original);
    expect(runtime.history.undos).toHaveLength(0);
    expect(test.onChange).not.toHaveBeenCalled();
    expect(onCanvasContextMenu).toHaveBeenCalledTimes(1);
    expect(onCanvasContextMenu).toHaveBeenLastCalledWith([20, 110]);
  });

  it('ignores a right-drag candidate whose release never arrived, and drops a node drag once the button is up', async () => {
    const test = await mount({ value: freeFixture() });
    const runtime = test.controller.current!.runtime,
      original = runtime.store;
    const camera = worldTransform(test.svg),
      outline = shapePath(test.container, 'a');
    await test.fire(test.svg, 'pointerdown', 500, 400, { button: 2 });
    await test.fire(test.svg, 'pointermove', 540, 430, { buttons: 0 });
    await test.fire(test.svg, 'pointermove', 560, 440, { buttons: 0 });
    await paint();
    expect(worldTransform(test.svg)).toBe(camera);
    const node = test.container.querySelector('[data-cell-id="a"]')!;
    await test.fire(node, 'pointerdown', 20, 110);
    await test.fire(test.svg, 'pointermove', 26, 114, { buttons: 0 });
    expect(shapePath(test.container, 'a')).toBe(outline);
    await test.fire(test.svg, 'pointermove', 40, 118, { buttons: 0 });
    await test.fire(test.svg, 'pointerup', 40, 118);
    await paint();
    expect(shapePath(test.container, 'a')).toBe(outline);
    expect(worldTransform(test.svg)).toBe(camera);
    expect(runtime.store).toBe(original);
    expect(test.onChange).not.toHaveBeenCalled();
    expect(runtime.history.undos).toHaveLength(0);
  });

  it('lets only the owning pointer start a right-pan or end a node drag', async () => {
    const test = await mount({ value: freeFixture() });
    const runtime = test.controller.current!.runtime;
    const camera = worldTransform(test.svg);
    await test.fire(test.svg, 'pointerdown', 500, 400, { button: 2 });
    await test.fire(test.svg, 'pointermove', 560, 440, {
      buttons: 2,
      pointerId: 2,
    });
    await test.fire(test.svg, 'pointermove', 570, 450, {
      buttons: 2,
      pointerId: 2,
    });
    await paint();
    expect(worldTransform(test.svg)).toBe(camera);
    await test.fire(test.svg, 'pointermove', 510, 410, { button: 2 });
    await test.fire(test.svg, 'pointermove', 530, 420, { button: 2 });
    await paint();
    expect(worldTransform(test.svg)).toBe('scale(1) translate(20 10)');
    await test.fire(test.svg, 'pointerup', 530, 420, { button: 2 });
    const node = test.container.querySelector('[data-cell-id="a"]')!;
    const outline = shapePath(test.container, 'a');
    await test.fire(node, 'pointerdown', 20, 110);
    await test.fire(test.svg, 'pointermove', 30, 115, { altKey: true });
    const dragged = shapePath(test.container, 'a');
    expect(dragged).not.toBe(outline);
    await test.fire(test.svg, 'pointerup', 30, 115, { pointerId: 2 });
    await test.fire(test.svg, 'pointermove', 32, 116, {
      buttons: 0,
      pointerId: 2,
    });
    expect(shapePath(test.container, 'a')).toBe(dragged);
    await test.fire(test.svg, 'pointerup', 32, 116);
    expect(test.onChange).toHaveBeenCalledOnce();
    expect((runtime.store.cells.a as NodeCell).geometry).toMatchObject({
      x: 10,
      y: 105,
    });
  });

  it('keeps the node still after a cancelled drag, however the pointer moves', async () => {
    const test = await mount({ value: freeFixture() });
    const runtime = test.controller.current!.runtime,
      original = runtime.store;
    const node = test.container.querySelector('[data-cell-id="a"]')!;
    const outline = shapePath(test.container, 'a');
    await test.fire(node, 'pointerdown', 20, 110);
    await test.fire(test.svg, 'pointermove', 30, 115, { altKey: true });
    expect(shapePath(test.container, 'a')).not.toBe(outline);
    await test.fire(test.svg, 'pointercancel', 30, 115);
    await test.fire(test.svg, 'pointermove', 40, 120, { buttons: 0 });
    await test.fire(test.svg, 'pointermove', 45, 125);
    await test.fire(test.svg, 'pointerup', 45, 125);
    expect(shapePath(test.container, 'a')).toBe(outline);
    expect(runtime.store).toBe(original);
    expect(test.onChange).not.toHaveBeenCalled();
    expect(runtime.history.undos).toHaveLength(0);
  });

  it('still pans the canvas on a real right-button drag after a plain right-click', async () => {
    const test = await mount({ value: freeFixture() });
    const camera = worldTransform(test.svg);
    await test.fire(test.svg, 'pointerdown', 500, 400, { button: 2 });
    await test.fire(test.svg, 'pointerup', 500, 400, { button: 2 });
    expect(worldTransform(test.svg)).toBe(camera);
    await test.fire(test.svg, 'pointerdown', 500, 400, { button: 2 });
    await test.fire(test.svg, 'pointermove', 510, 410, { button: 2 });
    expect(worldTransform(test.svg)).toBe(camera);
    await test.fire(test.svg, 'pointermove', 530, 420, { button: 2 });
    await test.fire(test.svg, 'pointerup', 530, 420, { button: 2 });
    expect(worldTransform(test.svg)).toBe('scale(1) translate(20 10)');
    expect(test.onChange).not.toHaveBeenCalled();
  });
});
