import { frameSelectionActionId } from './frame-actions';
import {
  applyCellOperations,
  createCellStore,
  createFrameCell,
  groupCells,
  type EdgeCell,
  type FrameSnapshot,
  type GroupCell,
  type NodeCell,
} from '@sue/board-core';
import { act, createRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestCellRegistry as createFixtureRegistry } from '../../../../tests/fixtures/plugins/registry';
import { createTestFramePluginSet } from '../../../../tests/fixtures/plugins/ui';
import { FrameCanvas, type FrameCanvasController } from './frame-canvas';
const testFramePluginSet = createTestFramePluginSet();
const testCellRegistry = createFixtureRegistry();

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});
const fixture = (): FrameSnapshot => ({
  store: applyCellOperations(
    createCellStore(createFrameCell('root')),
    [
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
    ],
    testCellRegistry,
  ),
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
        pluginSet={testFramePluginSet}
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
    if (type === 'pointermove')
      await act(async () => {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
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
      await act(async () =>
        test.controller.current!.executeAction('canvas.history.undo'),
      );
      expect(runtime.store).toEqual(original);
      await act(async () =>
        test.controller.current!.executeAction('canvas.history.redo'),
      );
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
              testCellRegistry,
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
      await act(async () =>
        test.controller.current!.executeAction('canvas.history.undo'),
      );
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
    await act(async () =>
      test.controller.current!.executeAction('canvas.history.undo'),
    );
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
      await act(async () =>
        test.controller.current!.executeAction('canvas.selection.edit', {
          cellId: 'nested',
        }),
      );
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
  store: applyCellOperations(
    createCellStore(createFrameCell('root')),
    [
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
    ],
    testCellRegistry,
  ),
});

const groupedFixture = () => {
  let value = freeFixture();
  value = {
    store: applyCellOperations(
      value.store,
      groupCells(
        value.store,
        'root',
        ['a', 'b', 'free-edge'],
        'inner',
        testCellRegistry,
      ),
      testCellRegistry,
    ),
  };
  value = {
    store: applyCellOperations(
      value.store,
      groupCells(
        value.store,
        'root',
        ['inner', 'c'],
        'outer',
        testCellRegistry,
      ),
      testCellRegistry,
    ),
  };
  return value;
};

describe('arrangement and group interaction', () => {
  it.each([
    'canvas.layout.vertical',
    'canvas.edges.reroute',
    'canvas.edges.optimize',
  ])(
    'cancels a captured %s if empty group focus changes before execution',
    async (id) => {
      const value = groupedFixture();
      const test = await mount({ value });
      const controller = test.controller.current!;
      await act(async () =>
        controller.runtime.select({ focus: ['root', 'outer'], ids: [] }),
      );
      const action = controller
        .actions()
        .find((action) => action.id === id)!
        .capture();
      await act(async () =>
        controller.runtime.select({ focus: ['root'], ids: [] }),
      );
      let status = '';
      await act(async () => {
        status = (await action.execute()).status;
      });
      expect(status).toBe('cancelled');
      expect(controller.runtime.store).toEqual(value.store);
      expect(test.onChange).not.toHaveBeenCalled();
    },
  );

  it('layouts a selected group or an empty focused group without expanding to outside nodes', async () => {
    const value = groupedFixture();
    const test = await mount({ value });
    const runtime = test.controller.current!.runtime;
    await act(async () => runtime.select({ focus: ['root'], ids: ['outer'] }));
    expect(
      test.controller.current!.getActionState('canvas.layout.vertical').enabled,
    ).toBe(true);
    await act(async () => {
      await test.controller.current!.executeAction('canvas.layout.vertical');
    });
    expect(runtime.store.cells.d).toEqual(value.store.cells.d);
    expect((runtime.store.cells.c as NodeCell).geometry.y).toBeGreaterThan(100);
    expect(runtime.history.undos).toHaveLength(1);
    await act(async () => {
      await test.controller.current!.executeAction('canvas.history.undo');
    });
    expect(runtime.store).toEqual(value.store);
    await act(async () =>
      runtime.select({ focus: ['root', 'outer', 'inner'], ids: [] }),
    );
    await act(async () => {
      await test.controller.current!.executeAction('canvas.layout.vertical');
    });
    expect(runtime.store.cells.c).toEqual(value.store.cells.c);
    expect(runtime.store.cells.d).toEqual(value.store.cells.d);
    expect((runtime.store.cells.b as NodeCell).geometry).toMatchObject({
      x: 0,
      y: 152,
    });
    const historySize = runtime.history.undos.length;
    await act(async () => {
      await test.controller.current!.executeAction('canvas.layout.vertical');
    });
    expect(runtime.history.undos).toHaveLength(historySize);
    expect(
      test.controller
        .current!.actions()
        .some((action) => action.id === 'canvas.layout.relationships'),
    ).toBe(true);
  });

  it.each(['canvas.edges.reroute', 'canvas.edges.optimize'])(
    'runs %s in one undo step without moving nodes',
    async (actionId) => {
      const value = groupedFixture();
      const test = await mount({ value });
      const runtime = test.controller.current!.runtime;
      await act(async () =>
        runtime.select({ focus: ['root'], ids: ['outer'] }),
      );
      expect(test.controller.current!.getActionState(actionId).enabled).toBe(
        true,
      );
      await act(async () => {
        await test.controller.current!.executeAction(actionId);
      });
      for (const id of ['a', 'b', 'c', 'd'])
        expect(runtime.store.cells[id]).toEqual(value.store.cells[id]);
      expect(
        (runtime.store.cells['free-edge'] as EdgeCell).route,
      ).toMatchObject(
        actionId === 'canvas.edges.optimize'
          ? { mode: 'orthogonal', points: expect.any(Array) }
          : { mode: 'auto' },
      );
      expect(runtime.history.undos).toHaveLength(1);
      expect(test.controller.current!.getActionState(actionId).enabled).toBe(
        actionId === 'canvas.edges.optimize',
      );
      await act(async () => {
        await test.controller.current!.executeAction(actionId);
      });
      expect(runtime.history.undos).toHaveLength(1);
      await act(async () => {
        await test.controller.current!.executeAction('canvas.history.undo');
      });
      expect(runtime.store).toEqual(value.store);
      await act(async () => {
        await test.controller.current!.executeAction('canvas.history.redo');
      });
      expect(
        (runtime.store.cells['free-edge'] as EdgeCell).route,
      ).toMatchObject(
        actionId === 'canvas.edges.optimize'
          ? { mode: 'orthogonal', points: expect.any(Array) }
          : { mode: 'auto' },
      );
    },
  );

  it.each([
    'canvas.layout.vertical',
    'canvas.edges.reroute',
    'canvas.edges.optimize',
  ])(
    'does not apply %s when the host rejects the transaction',
    async (actionId) => {
      const value = groupedFixture();
      const test = await mount({ value, pending: true });
      const runtime = test.controller.current!.runtime;
      await act(async () =>
        runtime.select({ focus: ['root'], ids: ['outer'] }),
      );
      let result!: ReturnType<FrameCanvasController['executeAction']>;
      await act(async () => {
        result = test.controller.current!.executeAction(actionId);
      });
      expect(test.onIntent).toHaveBeenCalledTimes(1);
      expect(runtime.store).toEqual(value.store);
      await act(async () => {
        test.release();
        await result;
      });
      expect(runtime.store).toEqual(value.store);
      expect(runtime.history.undos).toHaveLength(0);
    },
  );

  it('checks a conflicting layout at execution and never creates a transaction', async () => {
    const value = freeFixture();
    value.store = applyCellOperations(
      value.store,
      [
        {
          type: 'replace_cell',
          cell: {
            ...value.store.cells.b,
            geometry: { x: 500, y: 500, width: 40, height: 20 },
          } as NodeCell,
        },
        {
          type: 'replace_cell',
          cell: {
            ...value.store.cells.c,
            geometry: { x: 80, y: 100, width: 40, height: 20 },
          } as NodeCell,
        },
      ],
      testCellRegistry,
    );
    const test = await mount({ value });
    await act(async () =>
      test.controller.current!.runtime.select({
        focus: ['root'],
        ids: ['a', 'b'],
      }),
    );
    expect(
      test.controller.current!.getActionState('canvas.layout.horizontal'),
    ).toMatchObject({ enabled: true });
    await act(async () => {
      await test.controller.current!.executeAction('canvas.layout.horizontal');
    });
    expect(test.onChange).not.toHaveBeenCalled();
    expect(test.controller.current!.runtime.store).toEqual(value.store);
  });

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
      test.controller.current!.getActionState(
        frameSelectionActionId({ type: 'fit-content' }),
      ).enabled,
    ).toBe(true);
    await act(async () => {
      await test.controller.current!.executeAction(
        frameSelectionActionId({
          type: 'fit-content',
        }),
      );
    });
    expect(test.onChange).toHaveBeenCalledTimes(1);
    const a = test.controller.current!.runtime.store.cells.a as NodeCell;
    expect(a.geometry.x).toBe((value.store.cells.a as NodeCell).geometry.x);
    expect(a.geometry.y).toBe((value.store.cells.a as NodeCell).geometry.y);
    await act(async () =>
      test.controller.current!.executeAction('canvas.history.undo'),
    );
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
    let promise!: ReturnType<FrameCanvasController['executeAction']>;
    await act(async () => {
      promise = host.controller.current!.executeAction(
        frameSelectionActionId({
          type: 'fit-content',
        }),
      );
    });
    expect(
      host.controller.current!.getActionState(
        frameSelectionActionId({ type: 'fit-content' }),
      ).enabled,
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
      await test.controller.current!.executeAction(
        frameSelectionActionId({
          type: 'ungroup',
        }),
      );
    });
    expect(test.controller.current!.runtime.selection).toEqual({
      focus: ['root', 'outer'],
      ids: ['a', 'b', 'free-edge'],
    });
    await act(async () => {
      await test.controller.current!.executeAction(
        frameSelectionActionId({ type: 'group' }),
      );
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
    await act(async () =>
      test.controller.current!.executeAction('canvas.history.undo'),
    );
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
    await act(async () =>
      test.controller.current!.executeAction('canvas.history.undo'),
    );
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
      await test.controller.current!.executeAction(
        frameSelectionActionId({ type: 'lock' }),
      );
    });
    expect(
      test.controller.current!.getActionState(
        frameSelectionActionId({ type: 'ungroup' }),
      ).enabled,
    ).toBe(false);
    await test.fire(
      test.container.querySelector('[data-cell-id="a"]')!,
      'dblclick',
      20,
      110,
    );
    expect(runtime.selection.focus).toEqual(['root']);
    await act(async () => {
      await test.controller.current!.executeAction(
        frameSelectionActionId({
          type: 'unlock',
        }),
      );
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
        groupCells(value.store, 'root', ['a', 'b'], 'group', testCellRegistry),
        testCellRegistry,
      ),
    };
    value = {
      store: applyCellOperations(
        value.store,
        [
          {
            type: 'replace_cell',
            cell: { ...value.store.cells.a, locked: true },
          },
        ],
        testCellRegistry,
      ),
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
      await test.controller.current!.executeAction(
        frameSelectionActionId({
          type: 'unlock',
        }),
      );
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
    let promise!: ReturnType<FrameCanvasController['executeAction']>;
    await act(async () => {
      promise = pending.controller.current!.executeAction(
        frameSelectionActionId({
          type: 'group',
        }),
      );
    });
    expect(
      pending.controller.current!.getActionState(
        frameSelectionActionId({ type: 'group' }),
      ).enabled,
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
  store = applyCellOperations(
    store,
    [
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
    ],
    testCellRegistry,
  );
  store = applyCellOperations(
    store,
    groupCells(store, 'root', ['nested', 'sibling'], 'group', testCellRegistry),
    testCellRegistry,
  );
  store = applyCellOperations(
    store,
    [{ type: 'replace_cell', cell: { ...store.cells.group, locked: true } }],
    testCellRegistry,
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container),
    controller = createRef<FrameCanvasController>(),
    onChange = vi.fn();
  await act(async () =>
    root.render(
      <FrameCanvas
        pluginSet={testFramePluginSet}
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
    controller.current!.getActionState(frameSelectionActionId({ type: 'lock' }))
      .enabled,
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

  it.each(['press', 'release', 'absent'] as const)(
    'opens a right-click menu only on release when contextmenu is %s',
    async (timing) => {
      const onCanvasContextMenu = vi.fn();
      const test = await mount({ onCanvasContextMenu });
      await test.fire(test.svg, 'pointerdown', 500, 400, { button: 2 });
      if (timing === 'press')
        await test.fire(test.svg, 'contextmenu', 500, 400, { button: 2 });
      await test.fire(test.svg, 'pointermove', 503, 404, { button: 2 });
      expect(onCanvasContextMenu).not.toHaveBeenCalled();
      await test.fire(test.svg, 'pointerup', 503, 404, { button: 2 });
      expect(onCanvasContextMenu).toHaveBeenCalledExactlyOnceWith([503, 404]);
      if (timing === 'release')
        await test.fire(test.svg, 'contextmenu', 503, 404, { button: 2 });
      expect(onCanvasContextMenu).toHaveBeenCalledExactlyOnceWith([503, 404]);
    },
  );

  it.each(['press', 'release'] as const)(
    'pans without opening a menu when contextmenu fires on %s',
    async (timing) => {
      const onCanvasContextMenu = vi.fn();
      const test = await mount({ onCanvasContextMenu });
      const original = test.controller.current!.runtime.store;
      await test.fire(test.svg, 'pointerdown', 500, 400, { button: 2 });
      if (timing === 'press')
        await test.fire(test.svg, 'contextmenu', 500, 400, { button: 2 });
      expect(onCanvasContextMenu).not.toHaveBeenCalled();
      await test.fire(test.svg, 'pointermove', 510, 410, { button: 2 });
      await test.fire(test.svg, 'pointermove', 530, 420, { button: 2 });
      // Returning to the press point still counts as a drag.
      await test.fire(test.svg, 'pointermove', 500, 400, { button: 2 });
      await test.fire(test.svg, 'pointerup', 500, 400, { button: 2 });
      if (timing === 'release')
        await test.fire(test.svg, 'contextmenu', 500, 400, { button: 2 });
      expect(onCanvasContextMenu).toHaveBeenCalledExactlyOnceWith(null);
      expect(worldTransform(test.svg)).toBe('scale(1) translate(-10 -10)');
      expect(test.controller.current!.runtime.store).toBe(original);
      expect(test.onChange).not.toHaveBeenCalled();
    },
  );

  it.each(['pointercancel', 'lostpointercapture'])(
    'does not open a right-click menu after %s',
    async (type) => {
      const onCanvasContextMenu = vi.fn();
      const test = await mount({ onCanvasContextMenu });
      await test.fire(test.svg, 'pointerdown', 500, 400, { button: 2 });
      await test.fire(test.svg, type, 500, 400, { button: 2 });
      await test.fire(test.svg, 'pointerup', 500, 400, { button: 2 });
      await test.fire(test.svg, 'contextmenu', 500, 400, { button: 2 });
      expect(onCanvasContextMenu).not.toHaveBeenCalled();
    },
  );

  it('opens only for the owning pointer and rejects a release beyond the click threshold', async () => {
    const onCanvasContextMenu = vi.fn();
    const test = await mount({ onCanvasContextMenu });
    await test.fire(test.svg, 'pointerdown', 500, 400, { button: 2 });
    await test.fire(test.svg, 'pointerup', 500, 400, {
      button: 2,
      pointerId: 2,
    });
    expect(onCanvasContextMenu).not.toHaveBeenCalled();
    await test.fire(test.svg, 'pointerup', 510, 410, { button: 2 });
    await test.fire(test.svg, 'contextmenu', 510, 410, { button: 2 });
    expect(onCanvasContextMenu).not.toHaveBeenCalled();
    await test.fire(test.svg, 'pointerdown', 500, 400, { button: 2 });
    await test.fire(test.svg, 'pointerup', 500, 400, { button: 2 });
    expect(onCanvasContextMenu).toHaveBeenCalledExactlyOnceWith([500, 400]);
  });

  it('preserves native menus in text inputs and keyboard context menus on the canvas', async () => {
    const onCanvasContextMenu = vi.fn();
    const test = await mount({ onCanvasContextMenu });
    const input = document.createElement('input');
    test.svg.append(input);
    await test.fire(input, 'pointerdown', 500, 400, { button: 2 });
    await test.fire(input, 'contextmenu', 500, 400, { button: 2 });
    await test.fire(input, 'pointerup', 500, 400, { button: 2 });
    expect(onCanvasContextMenu).not.toHaveBeenCalled();
    await test.fire(test.svg, 'contextmenu', 500, 400);
    expect(onCanvasContextMenu).toHaveBeenCalledExactlyOnceWith([500, 400]);
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

describe('explicit and session automatic calculation', () => {
  it('toggles without content writes, captures a stable scope, preserves moves and joins resizing into one undo', async () => {
    const test = await mount({ value: freeFixture() });
    const api = () => test.controller.current!;
    const runtime = api().runtime;
    await act(async () => runtime.select({ focus: ['root'], ids: ['a', 'b'] }));
    api().setAutoLayoutStyle('vertical');
    const original = runtime.store;
    await act(async () => {
      await api().executeAction('canvas.layout.auto.toggle');
    });
    expect(api().getActionState('canvas.layout.auto.toggle').checked).toBe(
      true,
    );
    expect(api().getAutoCalculation().edges).toBeUndefined();
    expect(runtime.store).toBe(original);
    expect(test.onChange).not.toHaveBeenCalled();
    expect(runtime.history.undos).toHaveLength(0);
    await act(async () => runtime.select({ focus: ['root'], ids: ['c'] }));
    const moved = {
      ...(original.cells.a as NodeCell),
      geometry: { ...(original.cells.a as NodeCell).geometry, x: 25 },
    };
    await act(async () => {
      await api().executeAction('canvas.apply-operations', {
        operations: [{ type: 'replace_cell', cell: moved }],
      });
    });
    expect((runtime.store.cells.a as NodeCell).geometry.x).toBe(25);
    expect(runtime.store.cells.b).toBe(original.cells.b);
    const beforeResize = runtime.store;
    await act(async () => {
      await api().executeAction('canvas.apply-operations', {
        operations: [
          {
            type: 'replace_cell',
            cell: { ...moved, geometry: { ...moved.geometry, height: 60 } },
          },
        ],
      });
    });
    expect((runtime.store.cells.b as NodeCell).geometry.x).toBe(25);
    expect(runtime.store.cells.c).toEqual(original.cells.c);
    expect(runtime.history.undos).toHaveLength(2);
    await act(async () => {
      await api().executeAction('canvas.history.undo');
    });
    expect(runtime.store).toEqual(beforeResize);
    await act(async () => {
      await api().executeAction('canvas.history.redo');
    });
    expect((runtime.store.cells.b as NodeCell).geometry.x).toBe(25);
    const changes = test.onChange.mock.calls.length;
    await act(async () => {
      await api().executeAction('canvas.layout.auto.toggle');
    });
    expect(test.onChange).toHaveBeenCalledTimes(changes);
    expect(api().getActionState('canvas.layout.auto.toggle').checked).toBe(
      false,
    );
  });
  it('prepares derived operations for the host but leaves every cell unchanged after rejection', async () => {
    const value = freeFixture(),
      test = await mount({ value, pending: true });
    const api = () => test.controller.current!;
    await act(async () =>
      api().runtime.select({ focus: ['root'], ids: ['a', 'b'] }),
    );
    api().setAutoLayoutStyle('vertical');
    await act(async () => {
      await api().executeAction('canvas.layout.auto.toggle');
    });
    const a = value.store.cells.a as NodeCell;
    let result!: Promise<unknown>;
    await act(async () => {
      result = api().executeAction('canvas.apply-operations', {
        operations: [
          {
            type: 'replace_cell',
            cell: { ...a, geometry: { ...a.geometry, width: 60 } },
          },
        ],
      });
    });
    expect(test.onIntent).toHaveBeenCalledOnce();
    expect(test.onIntent.mock.calls[0][0].operations.length).toBeGreaterThan(1);
    expect(api().runtime.store).toEqual(value.store);
    await act(async () => {
      test.release();
      await result;
    });
    expect(api().runtime.store).toEqual(value.store);
    expect(api().runtime.history.undos).toHaveLength(0);
  });
  it('coalesces pointer preview paints and commits the final position even before the queued frame', async () => {
    const test = await mount({ value: freeFixture() });
    const callbacks = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.set(++sequence, callback);
      return sequence;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      callbacks.delete(id);
    });
    const shape = test.container.querySelector('[data-cell-id="a"] path')!;
    const path = shape.getAttribute('d');
    await test.fire(shape, 'pointerdown', 20, 110);
    const move = (x: number, type = 'pointermove') => {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        buttons: type === 'pointermove' ? 1 : 0,
        clientX: x,
        clientY: 115,
        altKey: true,
      });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      test.svg.dispatchEvent(event);
    };
    await act(async () => {
      move(35);
      move(45);
      move(55);
    });
    expect(callbacks.size).toBe(1);
    expect(
      test.container
        .querySelector('[data-cell-id="a"] path')
        ?.getAttribute('d'),
    ).toBe(path);
    await act(async () => {
      move(55, 'pointerup');
    });
    expect(
      (test.controller.current!.runtime.store.cells.a as NodeCell).geometry.x,
    ).toBe(35);
    expect(test.controller.current!.runtime.history.undos).toHaveLength(1);
    expect(callbacks.size).toBe(0);
  });
});

it('uses the same automatic preparation for accepted host transactions and delayed echoes', async () => {
  const original = freeFixture();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container),
    controller = createRef<FrameCanvasController>();
  const sent: import('@sue/board-core').CellTransaction[] = [];
  let echo!: () => void;
  function Hosted() {
    const [value, setValue] = useState(original);
    return (
      <FrameCanvas
        ref={controller}
        pluginSet={testFramePluginSet}
        value={value}
        adapter={{ toFrameSnapshot: (value: FrameSnapshot) => value }}
        autoFit={false}
        onIntent={async (transaction) => {
          sent.push(transaction);
          echo = () =>
            setValue({
              store: applyCellOperations(
                value.store,
                transaction.operations,
                testCellRegistry,
              ),
            });
          return { status: 'accepted' };
        }}
      />
    );
  }
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  await act(async () => root.render(<Hosted />));
  await act(async () =>
    controller.current!.runtime.select({ focus: ['root'], ids: ['a', 'b'] }),
  );
  controller.current!.setAutoLayoutStyle('vertical');
  await act(async () => {
    await controller.current!.executeAction('canvas.layout.auto.toggle');
  });
  const a = original.store.cells.a as NodeCell;
  let settled = false;
  let result!: Promise<unknown>;
  await act(async () => {
    result = controller
      .current!.executeAction('canvas.apply-operations', {
        operations: [
          {
            type: 'replace_cell',
            cell: { ...a, geometry: { ...a.geometry, width: 60 } },
          },
        ],
      })
      .then((value) => {
        settled = true;
        return value;
      });
  });
  expect(sent).toHaveLength(1);
  expect(sent[0].operations.length).toBeGreaterThan(1);
  expect(settled).toBe(false);
  expect(controller.current!.runtime.store).toEqual(original.store);
  await act(async () => echo());
  await act(async () => {
    await expect(result).resolves.toMatchObject({ status: 'completed' });
  });
  expect(settled).toBe(true);
  expect(controller.current!.runtime.store).toEqual(
    applyCellOperations(original.store, sent[0].operations, testCellRegistry),
  );
  expect(sent).toHaveLength(1);
});

it('does no full optimization while dragging and runs it exactly once on release when enabled', async () => {
  const value = freeFixture();
  value.store = applyCellOperations(
    value.store,
    [
      {
        type: 'insert_cell',
        parentId: 'root',
        cell: {
          id: 'connected',
          kind: 'arrow',
          cellType: 'edge',
          source: { cellId: 'a', anchor: [1, 0.5] },
          target: { cellId: 'b', anchor: [0, 0.5] },
          route: { mode: 'auto' },
        },
      },
    ],
    testCellRegistry,
  );
  const test = await mount({ value });
  const api = () => test.controller.current!;
  await act(async () =>
    api().runtime.select({ focus: ['root'], ids: ['a', 'b'] }),
  );
  await act(async () => {
    await api().executeAction('canvas.edges.auto.toggle');
  });
  await act(async () => api().runtime.select({ focus: ['root'], ids: ['a'] }));
  const optimization =
    await import('../../../engine/core/src/geometry/route-optimization');
  const optimize = vi.spyOn(optimization, 'optimizeFrameRoutes');
  const crossingModule =
    await import('../../../engine/core/src/geometry/edge-crossings');
  const crossings = vi.spyOn(crossingModule, 'frameEdgeCrossingJumps');
  const shape = test.container.querySelector('[data-cell-id="a"] path')!;
  await test.fire(shape, 'pointerdown', 20, 110);
  crossings.mockClear();
  await test.fire(test.svg, 'pointermove', 32, 115, { altKey: true });
  await test.fire(test.svg, 'pointermove', 45, 120, { altKey: true });
  expect(optimize).not.toHaveBeenCalled();
  expect(crossings).not.toHaveBeenCalled();
  expect(api().runtime.history.undos).toHaveLength(0);
  await test.fire(test.svg, 'pointerup', 45, 120, { altKey: true });
  expect(optimize).toHaveBeenCalledTimes(1);
  expect((api().runtime.store.cells.connected as EdgeCell).route).toMatchObject(
    { mode: 'orthogonal', points: expect.any(Array) },
  );
  expect(api().runtime.store.cells.b).toEqual(value.store.cells.b);
  expect(api().runtime.history.undos).toHaveLength(1);
  await act(async () => {
    await api().executeAction('canvas.history.undo');
  });
  expect(api().runtime.store).toEqual(value.store);
  expect(optimize).toHaveBeenCalledTimes(1);
});

it('does not plan node layouts when querying action availability', async () => {
  const test = await mount({ value: freeFixture() });
  const planner = await import('../../../engine/core/src/cell/layout-plan');
  const plan = vi.spyOn(planner, 'planCellLayout');
  for (let i = 0; i < 10; i++) {
    expect(
      test.controller.current!.getActionState('canvas.layout.grid').enabled,
    ).toBe(true);
    expect(
      test.controller.current!.getActionState('canvas.layout.relationships')
        .enabled,
    ).toBe(true);
  }
  expect(plan).not.toHaveBeenCalled();
  await act(async () => {
    await test.controller.current!.executeAction('canvas.layout.grid');
  });
  expect(plan).toHaveBeenCalledTimes(1);
});
