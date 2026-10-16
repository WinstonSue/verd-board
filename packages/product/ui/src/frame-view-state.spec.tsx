import React, {
  act,
  forwardRef,
  type ComponentProps,
  type RefObject,
} from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInlineText } from '@sue/board-common';
import {
  createCellStore,
  createFrameCell,
  deleteCells,
  type FrameSnapshot,
} from '@sue/board-core';
import type {
  FrameCanvasController,
  FrameCanvasProps,
  FrameCanvasViewState,
  FrameRichTextField,
} from '@sue/board-react';
import { I18nProvider } from './i18n';
import { VerdFrame } from './verd-frame';
import { createFrameViewStateStore } from './frame-view-state';

const renders = vi.hoisted(() => ({ canvas: vi.fn(), field: vi.fn() }));
vi.mock('@sue/board-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sue/board-react')>();
  return {
    ...actual,
    FrameCanvas: forwardRef<FrameCanvasController, FrameCanvasProps>(
      function FrameCanvasProbe(props, ref) {
        renders.canvas(props, ref);
        return <actual.FrameCanvas {...props} ref={ref} />;
      },
    ),
    FrameRichTextField: (props: ComponentProps<typeof FrameRichTextField>) => {
      renders.field(props);
      return <actual.FrameRichTextField {...props} />;
    },
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const view = (
  extra: Partial<FrameCanvasViewState> = {},
): FrameCanvasViewState => ({
  canUndo: false,
  canRedo: false,
  pending: false,
  readonly: false,
  dragging: false,
  zoom: 1,
  selectionScreenBounds: null,
  ...extra,
});
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  renders.canvas.mockClear();
  renders.field.mockClear();
});

async function mount({
  narrow = false,
  language = 'zh',
  changeValue,
  autoCommit = false,
  mindDefaultWidth,
}: {
  narrow?: boolean;
  language?: 'zh' | 'en';
  changeValue?(value: FrameSnapshot): void;
  autoCommit?: boolean;
  mindDefaultWidth?: number;
} = {}) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: narrow,
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
  vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 900,
    height: 640,
    right: 900,
    bottom: 640,
    toJSON() {},
  });
  const frame = createFrameCell('root');
  frame.children = ['node'];
  let value: FrameSnapshot = {
    store: {
      ...createCellStore(frame),
      cells: {
        root: frame,
        node: {
          id: 'node',
          kind: 'geometry',
          cellType: 'node',
          geometry: {
            x: 100,
            y: 100,
            width: 120,
            height: 60,
            outline: 'rectangle',
          },
          content: {
            label: 'Keep this editor',
            text: createInlineText('Keep this editor'),
          },
        },
      },
    },
  };
  const container = document.createElement('div');
  changeValue?.(value);
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const render = () =>
    root.render(
      <I18nProvider defaultLanguage={language} persistLanguage={false}>
        <VerdFrame
          value={value}
          mindDefaultWidth={mindDefaultWidth}
          frameId="root"
          onChange={(change) => {
            if (autoCommit) {
              value = change.snapshot;
              render();
            }
          }}
          onOpenFrame={() => {}}
        />
      </I18nProvider>,
    );
  await act(async () => render());
  const props = () => renders.canvas.mock.lastCall![0] as FrameCanvasProps;
  const controller = renders.canvas.mock
    .lastCall![1] as RefObject<FrameCanvasController>;
  const publish = async (next: FrameCanvasViewState) => {
    await act(async () => props().onViewStateChange!(next));
  };
  const select = async (ids: string[]) => {
    await act(async () =>
      controller.current!.runtime.select({ focus: ['root'], ids }),
    );
    await act(async () =>
      props().onSelectionChange!(controller.current!.runtime.selection),
    );
  };
  await select(['node']);
  await publish(
    view({ selectionScreenBounds: { x: 400, y: 300, width: 120, height: 60 } }),
  );
  return { container, props, controller, publish, select };
}

describe('local canvas view subscriptions', () => {
  it('edits names in the header, follows history and resets the editor between selections', async () => {
    const test = await mount({
      autoCommit: true,
      changeValue(value) {
        (
          value.store.cells.root as ReturnType<typeof createFrameCell>
        ).children.push('other');
        value.store.cells.other = {
          ...value.store.cells.node,
          id: 'other',
          content: { label: '' },
        };
      },
    });
    const header = () =>
      test.container.querySelector('.frame-inspector__header')!;
    const editor = () =>
      test.container.querySelector('[data-testid="inspector-name"]')!;
    expect(header().contains(editor())).toBe(true);
    expect((editor() as HTMLInputElement).value).toBe('Keep this editor');
    expect(
      test.container.querySelector(
        '.frame-field [data-testid="inspector-name"]',
      ),
    ).toBeNull();
    await act(async () => {
      const input = editor() as HTMLInputElement;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, 'Renamed node');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect((editor() as HTMLInputElement).value).toBe('Renamed node');
    expect(
      (
        test.controller.current!.runtime.store.cells
          .node as import('@sue/board-core').NodeCell
      ).content?.label,
    ).toBe('Keep this editor');
    await act(async () => test.controller.current!.undo());
    expect((editor() as HTMLInputElement).value).toBe('Keep this editor');
    const first = editor();
    await test.select(['other']);
    expect(editor()).not.toBe(first);
    expect((editor() as HTMLInputElement).value).toBe('');
    expect((editor() as HTMLInputElement).placeholder).toBe('形状');
    await test.select(['node']);
    expect((editor() as HTMLInputElement).value).toBe('Keep this editor');
    await test.publish(view({ readonly: true }));
    expect((editor() as HTMLInputElement).disabled).toBe(true);
    await test.select([]);
    expect(header().textContent).toBe('画布设置');
  });
  it('preserves the structural snapshot for camera changes and isolates stores', () => {
    const first = createFrameViewStateStore(),
      second = createFrameViewStateStore();
    first.publish(view());
    const structural = first.getStructuralSnapshot();
    first.publish(
      view({
        zoom: 2,
        selectionScreenBounds: { x: 10, y: 20, width: 30, height: 40 },
      }),
    );
    expect(first.getStructuralSnapshot()).toBe(structural);
    expect(second.getSnapshot()).toBeNull();
    first.publish(view({ zoom: 2, pending: true }));
    expect(first.getStructuralSnapshot()).not.toBe(structural);
    expect(first.getStructuralSnapshot()?.pending).toBe(true);
  });

  it('updates zoom and keeps recenter available without rerendering the page or inspector', async () => {
    const test = await mount();
    const pageRenders = renders.canvas.mock.calls.length;
    const editorRenders = renders.field.mock.calls.length;
    expect(editorRenders).toBe(0);
    const editor = test.container.querySelector(
      '[data-testid="inspector-name"]',
    );
    const recenter = test.container.querySelector(
      '[data-testid="canvas-recenter"]',
    );
    expect(recenter?.textContent).toBe('重新居中');
    expect(test.container.querySelector('.frame-selection-toolbar')).toBeNull();
    for (let i = 1; i <= 12; i++) {
      await test.publish(
        view({
          zoom: 1 + i / 10,
          selectionScreenBounds: {
            x: 400 + i * 5,
            y: 300 + i * 3,
            width: 120,
            height: 60,
          },
        }),
      );
    }
    expect(
      test.container.querySelector('[data-testid="canvas-zoom-label"]')
        ?.textContent,
    ).toBe('220%');
    expect(renders.canvas).toHaveBeenCalledTimes(pageRenders);
    expect(renders.field).toHaveBeenCalledTimes(editorRenders);
    expect(
      test.container.querySelector('[data-testid="canvas-recenter"]'),
    ).toBe(recenter);
    expect(test.container.querySelector('[data-testid="inspector-name"]')).toBe(
      editor,
    );
    const setZoom = vi
      .spyOn(test.controller.current!, 'setZoom')
      .mockImplementation(() => {});
    await act(async () =>
      test.container
        .querySelector<HTMLButtonElement>('[data-testid="canvas-zoom-in"]')!
        .click(),
    );
    expect(setZoom.mock.lastCall![0]).toBeCloseTo(2.3);
    await act(async () =>
      test.container
        .querySelector<HTMLButtonElement>('[data-testid="canvas-zoom-out"]')!
        .click(),
    );
    expect(setZoom.mock.lastCall![0]).toBeCloseTo(2.1);
  });

  it('centers the selection at its current zoom, including offscreen and readonly selections', async () => {
    const test = await mount({ language: 'en' });
    const offscreen = { x: -900, y: -800, width: 120, height: 60 };
    await test.publish(
      view({ zoom: 2, readonly: true, selectionScreenBounds: offscreen }),
    );
    const center = vi.spyOn(test.controller.current!, 'centerSelection');
    const setZoom = vi.spyOn(test.controller.current!, 'setZoom');
    const button = test.container.querySelector<HTMLButtonElement>(
      '[data-testid="canvas-recenter"]',
    )!;
    expect(button.textContent).toBe('Re-center');
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(center).toHaveBeenCalledOnce();
    expect(setZoom).not.toHaveBeenCalled();
    await test.publish(
      view({ dragging: true, selectionScreenBounds: offscreen }),
    );
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(center).toHaveBeenCalledOnce();
    await test.select([]);
    expect(
      test.container.querySelector('[data-testid="canvas-recenter"]'),
    ).toBeNull();
  });

  it('shows recenter for Frame and Group node selections and ignores hidden, deleted and edge-only targets', async () => {
    const test = await mount({
      changeValue(value) {
        const root = value.store.cells.root as ReturnType<
          typeof createFrameCell
        >;
        root.children.push('hidden', 'edge', 'nested');
        root.groups.push('group');
        value.store.cells.nested = createFrameCell('nested', {
          x: 400,
          y: 200,
          width: 200,
          height: 100,
        });
        value.store.cells.hidden = {
          ...value.store.cells.node,
          id: 'hidden',
          hidden: true,
        };
        value.store.cells.edge = {
          id: 'edge',
          kind: 'arrow',
          cellType: 'edge',
          source: { point: [0, 0] },
          target: { point: [100, 100] },
          route: { mode: 'straight' },
        };
        value.store.cells.group = {
          id: 'group',
          kind: 'group',
          cellType: 'group',
          members: ['node', 'hidden', 'edge'],
        };
      },
    });
    const recenter = () =>
      test.container.querySelector('[data-testid="canvas-recenter"]');
    await test.select(['nested']);
    expect(recenter()).not.toBeNull();
    await test.select(['group']);
    expect(recenter()).not.toBeNull();
    await test.select(['hidden']);
    expect(recenter()).toBeNull();
    await test.select(['edge']);
    expect(recenter()).toBeNull();
    await test.select(['node', 'nested', 'edge']);
    expect(recenter()).not.toBeNull();
    await test.select(['node']);
    await act(async () =>
      test.controller.current!.dispatch({
        id: 'delete-target',
        operations: deleteCells(test.controller.current!.runtime.store, [
          'node',
        ]),
      }),
    );
    expect(recenter()).toBeNull();
  });

  it('reserves canvas controls without inspector insets at 800px', async () => {
    let bottomHeight = 90;
    let toolbarHeight = 42;
    const observers: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const height = this.classList.contains('frame-bottom-controls')
          ? bottomHeight
          : this.classList.contains('frame-app-toolbar')
            ? toolbarHeight
            : this.classList.contains('frame-inspector')
              ? 220
              : 0;
        return {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          width: 358,
          height,
          right: 358,
          bottom: height,
          toJSON() {},
        };
      },
    );
    const test = await mount({ narrow: true });
    expect(test.props().viewportInsets?.bottom).toBe(122);
    expect(
      test.container
        .querySelector<HTMLElement>('.verd-frame')
        ?.style.getPropertyValue('--frame-bottom-controls-height'),
    ).toBe('90px');
    await act(async () =>
      test.container
        .querySelector<HTMLButtonElement>('[aria-label="属性"]')!
        .click(),
    );
    expect(test.props().viewportInsets?.bottom).toBe(122);
    bottomHeight = 42;
    await act(async () =>
      observers.forEach((callback) => callback([], {} as ResizeObserver)),
    );
    expect(test.props().viewportInsets?.bottom).toBe(74);
    toolbarHeight = 80;
    await act(async () =>
      observers.forEach((callback) => callback([], {} as ResizeObserver)),
    );
    expect(test.props().viewportInsets?.top).toBe(150);
    expect(
      test.container
        .querySelector<HTMLElement>('.verd-frame')
        ?.style.getPropertyValue('--frame-app-toolbar-height'),
    ).toBe('80px');
  });

  it('still updates history, pending, readonly and dragging consumers', async () => {
    const test = await mount();
    const before = renders.canvas.mock.calls.length;
    await test.publish(
      view({
        canUndo: true,
        canRedo: true,
        pending: true,
        selectionScreenBounds: { x: 400, y: 300, width: 120, height: 60 },
      }),
    );
    expect(renders.canvas.mock.calls.length).toBeGreaterThan(before);
    expect(
      test.container.querySelector<HTMLButtonElement>('[aria-label="撤销"]')
        ?.disabled,
    ).toBe(false);
    expect(
      test.container.querySelector<HTMLButtonElement>('[aria-label="重做"]')
        ?.disabled,
    ).toBe(false);
    await test.publish(view({ readonly: true }));
    expect(
      test.container.querySelector<HTMLButtonElement>('[aria-label="撤销"]')
        ?.disabled,
    ).toBe(true);
    expect(
      test.container.querySelector<HTMLInputElement>(
        '[data-testid="inspector-name"]',
      )!.disabled,
    ).toBe(true);
    expect(test.container.querySelector('.frame-selection-toolbar')).toBeNull();
    await test.publish(
      view({
        dragging: true,
        selectionScreenBounds: { x: 400, y: 300, width: 120, height: 60 },
      }),
    );
    expect(test.container.querySelector('.frame-selection-toolbar')).toBeNull();
  });
});

async function editNumber(
  test: Awaited<ReturnType<typeof mount>>,
  label: string,
  value: string,
) {
  const input = test.container.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
async function numberEnter(input: HTMLInputElement) {
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
  });
}
it('commits a geometry draft once, preserves concurrent fields and has one-step undo/redo', async () => {
  const test = await mount({ autoCommit: true });
  const runtime = () => test.controller.current!.runtime;
  const node = () =>
    runtime().store.cells.node as import('@sue/board-core').NodeCell;
  const input = await editNumber(test, 'x', '240');
  expect(node().geometry.x).toBe(100);
  await act(async () => {
    await test.controller.current!.dispatch({
      id: 'external',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...node(),
            geometry: { ...node().geometry, width: 188 },
            name: 'Concurrent',
          },
        },
      ],
    });
  });
  expect(input.value).toBe('240');
  await numberEnter(input);
  expect(node().geometry).toMatchObject({ x: 240, width: 188 });
  expect(node().name).toBe('Concurrent');
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  await act(async () => test.controller.current!.undo());
  expect(node().geometry).toMatchObject({ x: 100, width: 188 });
  await act(async () => test.controller.current!.redo());
  expect(node().geometry).toMatchObject({ x: 240, width: 188 });
});
it('cancels numeric drafts after locking, readonly, selection changes and deletion', async () => {
  const test = await mount({ autoCommit: true });
  const node = () =>
    test.controller.current!.runtime.store.cells
      .node as import('@sue/board-core').NodeCell;
  await editNumber(test, 'x', '333');
  await test.publish(view({ readonly: true }));
  await test.publish(view({ readonly: false }));
  expect(
    test.container.querySelector<HTMLInputElement>('[aria-label="x"]')!.value,
  ).toBe('100');
  await editNumber(test, 'x', '333');
  await act(async () => {
    await test.controller.current!.dispatch({
      id: 'lock',
      operations: [{ type: 'replace_cell', cell: { ...node(), locked: true } }],
    });
  });
  expect(
    test.container.querySelector<HTMLInputElement>('[aria-label="x"]')!
      .disabled,
  ).toBe(true);
  expect(node().geometry.x).toBe(100);
  await act(async () => test.controller.current!.undo());
  await editNumber(test, 'x', '333');
  await test.select([]);
  await test.select(['node']);
  expect(
    test.container.querySelector<HTMLInputElement>('[aria-label="x"]')!.value,
  ).toBe('100');
  const input = await editNumber(test, 'x', '333');
  await act(async () => {
    await test.controller.current!.dispatch({
      id: 'delete',
      operations: deleteCells(test.controller.current!.runtime.store, ['node']),
    });
  });
  await numberEnter(input);
  expect(node()).toBeUndefined();
});

it('applies mixed appearance numbers in one transaction while preserving latest fields', async () => {
  const test = await mount({
    autoCommit: true,
    changeValue(value) {
      const a = value.store.cells.node as import('@sue/board-core').NodeCell;
      a.appearance = { strokeWidth: 2 };
      (
        value.store.cells.root as ReturnType<typeof createFrameCell>
      ).children.push('other');
      value.store.cells.other = {
        ...a,
        id: 'other',
        appearance: { strokeWidth: 4 },
      };
    },
  });
  await test.select(['node', 'other']);
  const query = () =>
    test.container.querySelector<HTMLInputElement>(
      '[aria-label="Stroke width"]',
    )!;
  expect(query().value).toBe('');
  await act(async () => {
    query().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  const runtime = () => test.controller.current!.runtime;
  const cell = (id: string) =>
    runtime().store.cells[id] as import('@sue/board-core').NodeCell;
  const input = await editNumber(test, 'Stroke width', '3.5');
  await act(async () => {
    await test.controller.current!.dispatch({
      id: 'external-fill',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...cell('node'),
            appearance: { ...cell('node').appearance, fill: '#123456' },
          },
        },
      ],
    });
  });
  await numberEnter(input);
  expect(cell('node').appearance).toMatchObject({
    strokeWidth: 3.5,
    fill: '#123456',
  });
  expect(cell('other').appearance?.strokeWidth).toBe(3.5);
  await act(async () => test.controller.current!.undo());
  expect(cell('node').appearance).toMatchObject({
    strokeWidth: 2,
    fill: '#123456',
  });
  expect(cell('other').appearance?.strokeWidth).toBe(4);
});
it('shows the workspace Mind default and uses it when creating an explicit override', async () => {
  const test = await mount({
    autoCommit: true,
    mindDefaultWidth: 336,
    changeValue(value) {
      const node = value.store.cells.node as import('@sue/board-core').NodeCell;
      node.kind = 'mind-root';
      node.data = {};
    },
  });
  expect(test.container.textContent).toContain('336');
  const mode = test.container.querySelector<HTMLSelectElement>(
    '[data-testid="mind-width-mode"]',
  )!;
  await act(async () => {
    mode.value = 'custom';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(
    test.container.querySelector<HTMLInputElement>(
      '[data-testid="mind-max-width"]',
    )!.value,
  ).toBe('336');
});
