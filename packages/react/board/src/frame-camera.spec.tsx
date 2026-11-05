import { createInlineText } from '@sue/board-common';
import * as Core from '@sue/board-core';
import {
  createCellStore,
  createFrameCell,
  type FrameSnapshot,
} from '@sue/board-core';
import React, { act, createRef, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestFramePluginSet } from '../../../../tests/fixtures/plugins/ui';
import {
  FrameCanvas,
  type FrameCanvasController,
  type FrameCanvasInteractionSettings,
  type FrameCanvasViewState,
  type FrameRenderExtension,
} from './frame-canvas';
const testFramePluginSet = createTestFramePluginSet();

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const sample = (): FrameSnapshot => {
  const root = createFrameCell('root');
  root.children = ['a'];
  return {
    store: {
      ...createCellStore(root),
      cells: {
        root,
        a: {
          id: 'a',
          kind: 'geometry',
          cellType: 'node',
          geometry: { x: 10, y: 10, width: 100, height: 50 },
          content: { label: 'Node' },
        },
      },
    },
  };
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const mount = async (
  value = sample(),
  options: {
    interactionSettings?: FrameCanvasInteractionSettings;
    autoFit?: boolean;
    readonly?: boolean;
    viewportInsets?: React.ComponentProps<typeof FrameCanvas>['viewportInsets'];
    tool?: 'select' | 'hand';
    inputMode?: 'edit' | 'present';
    onPresentTap?: (cellId: string | null) => void;
    host?: boolean;
    extensions?: readonly FrameRenderExtension[];
    onViewStateChange?: (state: FrameCanvasViewState) => void;
    onSelectionChange?: React.ComponentProps<
      typeof FrameCanvas
    >['onSelectionChange'];
  } = {},
) => {
  vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
    toJSON() {},
  } as DOMRect);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container),
    controller = createRef<FrameCanvasController>();
  const onChange = vi.fn(),
    onIntent = vi.fn(() => ({ status: 'accepted' as const })),
    layout = vi.fn(() => new Map());
  const extensions = [{ layout }, ...(options.extensions ?? [])];
  let renderedValue = value;
  const render = (
    frameId = 'root',
    initialFocusCellId?: string,
    nextValue = renderedValue,
  ) => {
    renderedValue = nextValue;
    root.render(
      <FrameCanvas
        pluginSet={testFramePluginSet}
        ref={controller}
        value={renderedValue}
        frameId={frameId}
        initialFocusCellId={initialFocusCellId}
        interactionSettings={options.interactionSettings}
        autoFit={options.autoFit ?? false}
        readonly={options.readonly}
        inputMode={options.inputMode}
        onPresentTap={options.onPresentTap}
        viewportInsets={options.viewportInsets}
        extensions={extensions}
        onViewStateChange={options.onViewStateChange}
        onSelectionChange={options.onSelectionChange}
        tool={{ mode: options.tool ?? 'select' }}
        {...(options.host
          ? {
              adapter: { toFrameSnapshot: (value: FrameSnapshot) => value },
              onIntent,
            }
          : { onChange })}
      />,
    );
  };
  await act(async () => render());
  const svg = container.querySelector('svg')!;
  svg.setPointerCapture = vi.fn();
  svg.hasPointerCapture = () => false;
  const fire = (
    type: string,
    x: number,
    y: number,
    button = 0,
    pointerId = 1,
    target: Element = svg,
  ) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
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
    });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    target.dispatchEvent(event);
    return event;
  };
  const paint = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  const transform = () =>
    svg.querySelector('[data-frame-world]')!.getAttribute('transform');
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return {
    controller,
    svg,
    fire,
    paint,
    transform,
    render,
    onChange,
    onIntent,
    layout,
    container,
  };
};
const controlledFrames = () => {
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callbacks.set(++id, callback);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frame) => {
    callbacks.delete(frame);
  });
  return {
    callbacks,
    paint: async () => {
      await act(async () => {
        const pending = [...callbacks.values()];
        callbacks.clear();
        pending.forEach((callback) => callback(performance.now()));
      });
    },
  };
};
const viewport = (transform: string | null) => {
  const [zoom, x, y] = transform!
    .match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/g)!
    .map(Number);
  return { zoom, origin: [-x, -y] };
};
describe('memory-only canvas camera', () => {
  it('measures once per wheel burst, preserves accumulated anchors and invalidates only for host motion', async () => {
    const frames = controlledFrames();
    const test = await mount();
    const rect = vi.mocked(SVGSVGElement.prototype.getBoundingClientRect);
    const original = rect.mock.results.at(-1)!.value as DOMRect;
    const time = vi.spyOn(performance, 'now').mockReturnValue(100);
    const wheel = () =>
      test.svg.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY: -6,
          clientX: 300,
          clientY: 200,
        }),
      );
    rect.mockClear();
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        wheel();
        wheel();
      });
      await frames.paint();
    }
    expect(rect).toHaveBeenCalledTimes(1);
    const camera = test.controller.current!.getCamera()!;
    expect(camera.zoom).toBeCloseTo(Math.exp(1.2));
    expect(camera.origination![0]).toBeCloseTo(300 - 300 / camera.zoom!);
    expect(camera.origination![1]).toBeCloseTo(200 - 200 / camera.zoom!);
    // A document scrolling inside this canvas cannot move the root viewport.
    await act(async () =>
      test.svg
        .querySelector('[data-frame-world]')!
        .dispatchEvent(new Event('scroll')),
    );
    expect(rect).toHaveBeenCalledTimes(1);
    rect.mockReturnValue({ ...original, left: 100, top: 40 } as DOMRect);
    await act(async () => {
      test.container.style.marginLeft = '100px';
    });
    await act(async () => {
      wheel();
    });
    expect(rect).toHaveBeenCalledTimes(2);
    await act(async () => test.container.dispatchEvent(new Event('scroll')));
    expect(rect).toHaveBeenCalledTimes(3);
    await act(async () => {
      wheel();
    });
    expect(rect).toHaveBeenCalledTimes(3);
    time.mockReturnValue(1100);
    await act(async () => {
      wheel();
    });
    expect(rect).toHaveBeenCalledTimes(4);
    time.mockRestore();
  });
  it('keeps measuring input coordinates while an ancestor animates', async () => {
    const frames = controlledFrames();
    const test = await mount();
    Object.defineProperty(test.container, 'getAnimations', {
      value: () => [{ playState: 'running' }],
      configurable: true,
    });
    const rect = vi.mocked(SVGSVGElement.prototype.getBoundingClientRect);
    rect.mockClear();
    for (let i = 0; i < 3; i++) {
      await act(async () =>
        test.svg.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            deltaY: -6,
            clientX: 300,
            clientY: 200,
          }),
        ),
      );
      await frames.paint();
    }
    expect(rect).toHaveBeenCalledTimes(3);
  });
  it('uses fresh coordinates for hand input on an already animated host', async () => {
    const frames = controlledFrames();
    const test = await mount(sample(), { tool: 'hand' });
    Object.defineProperty(test.container, 'getAnimations', {
      value: () => [{ playState: 'running' }],
      configurable: true,
    });
    await act(async () => {
      test.fire('pointerdown', 100, 100);
    });
    const rect = vi.mocked(SVGSVGElement.prototype.getBoundingClientRect);
    const original = rect.mock.results.at(-1)!.value as DOMRect;
    rect.mockClear();
    rect.mockReturnValue({ ...original, left: 50 } as DOMRect);
    await act(async () => {
      test.fire('pointermove', 200, 100);
    });
    await frames.paint();
    expect(rect).toHaveBeenCalledTimes(1);
    expect(test.controller.current!.getCamera().origination[0]).toBe(-50);
    await act(async () => {
      test.fire('pointerup', 200, 100);
    });
  });
  it.each([false, true])(
    'cancels native text selection only when an ordinary shape move is allowed (readonly=%s)',
    async (readonly) => {
      const test = await mount(sample(), { readonly });
      const node = test.svg.querySelector('[data-cell-id="a"]')!;
      let prevented: boolean | undefined;
      await act(async () => {
        prevented = test.fire(
          'pointerdown',
          40,
          30,
          0,
          1,
          node,
        ).defaultPrevented;
      });
      expect(prevented).toBe(!readonly);
      const label = node.querySelector<HTMLElement>('[data-frame-rich-text]')!;
      expect(label.style.userSelect).toBe('none');
      await act(async () => test.fire('pointerup', 40, 30));
      if (!readonly) {
        await act(async () =>
          node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
        );
        expect(
          test.svg.querySelector('[data-frame-text-editor]'),
        ).not.toBeNull();
      }
    },
  );
  it('cancels native title selection when starting an allowed Frame move', async () => {
    const value = sample();
    (value.store.cells.root as Core.FrameCell).children.push('nested');
    value.store.cells.nested = createFrameCell('nested');
    const test = await mount(value);
    const title = test.svg.querySelector('[data-frame-title-id="nested"]')!;
    let prevented: boolean | undefined;
    await act(async () => {
      prevented = test.fire(
        'pointerdown',
        40,
        30,
        0,
        1,
        title,
      ).defaultPrevented;
    });
    expect(prevented).toBe(true);
    await act(async () => test.fire('pointerup', 40, 30));
  });
  it('reports primary present taps without changing the document or selection', async () => {
    const tap = vi.fn();
    const test = await mount(sample(), {
      inputMode: 'present',
      onPresentTap: tap,
    });
    const selection = test.controller.current!.runtime.selection;
    const cell = test.svg.querySelector('[data-cell-id="a"]')!;
    await act(async () => {
      test.fire('pointerdown', 50, 50, 0, 1, cell);
      test.fire('pointerup', 52, 50);
    });
    expect(tap).toHaveBeenLastCalledWith('a');
    await act(async () => {
      test.fire('pointerdown', 400, 400);
      test.fire('pointerup', 400, 400);
    });
    expect(tap).toHaveBeenLastCalledWith(null);
    expect(test.controller.current!.runtime.selection).toEqual(selection);
    await act(async () => {
      test.svg.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
      );
    });
    expect(test.controller.current!.runtime.store.cells.a).toBeDefined();
    expect(test.onChange).not.toHaveBeenCalled();
  });

  it('keeps present drags as camera motion and cancels taps on excursion, pinch, middle click and cancel', async () => {
    const tap = vi.fn();
    const test = await mount(sample(), {
      inputMode: 'present',
      onPresentTap: tap,
    });
    const original = test.transform();
    await act(async () => {
      test.fire('pointerdown', 100, 100);
      test.fire('pointermove', 200, 160);
      test.fire('pointerup', 200, 160);
    });
    expect(test.transform()).not.toBe(original);
    await act(async () => {
      test.fire('pointerdown', 100, 100);
      test.fire('pointermove', 110, 100);
      test.fire('pointermove', 100, 100);
      test.fire('pointerup', 100, 100);
      test.fire('pointerdown', 100, 100, 1);
      test.fire('pointerup', 100, 100, 1);
      test.fire('pointerdown', 100, 100);
      test.fire('pointercancel', 100, 100);
      test.fire('pointerup', 100, 100);
      test.fire('pointerdown', 100, 100, 0, 1);
      test.fire('pointerdown', 200, 100, 0, 2);
      test.fire('pointerup', 100, 100, 0, 1);
      test.fire('pointerup', 200, 100, 0, 2);
    });
    expect(tap).not.toHaveBeenCalled();
    expect(test.onChange).not.toHaveBeenCalled();
  });

  it('allows a present tap to start an animated fit after the pan is settled', async () => {
    const frames = controlledFrames();
    const tap = vi.fn();
    const test = await mount(sample(), {
      inputMode: 'present',
      onPresentTap: tap,
    });
    tap.mockImplementation((id) =>
      test.controller.current!.fitCells([id], { maxZoom: 2 }),
    );
    const cell = test.svg.querySelector('[data-cell-id="a"]')!;
    await act(async () => {
      test.fire('pointerdown', 50, 50, 0, 1, cell);
      test.fire('pointerup', 50, 50);
    });
    expect(tap).toHaveBeenCalledWith('a');
    await act(async () => {
      const pending = [...frames.callbacks.values()];
      frames.callbacks.clear();
      pending.forEach((callback) => callback(performance.now() + 300));
    });
    expect(viewport(test.transform()).zoom).toBe(2);
    expect(test.onChange).not.toHaveBeenCalled();
  });

  it('fits visible cells with a zoom cap without selecting and rejects missing or hidden targets', async () => {
    const test = await mount(sample(), { inputMode: 'present' });
    const selection = test.controller.current!.runtime.selection;
    await act(async () => {
      expect(
        test.controller.current!.fitCells(['a'], {
          animate: false,
          maxZoom: 2,
          insets: { top: 48, right: 48, bottom: 48, left: 48 },
        }),
      ).toBe(true);
    });
    expect(viewport(test.transform()).zoom).toBe(2);
    expect(test.controller.current!.runtime.selection).toEqual(selection);
    expect(test.controller.current!.fitCells(['absent'])).toBe(false);
    const hidden = sample();
    hidden.store.cells.a.hidden = true;
    await act(async () => test.render('root', undefined, hidden));
    expect(test.controller.current!.fitCells(['a'])).toBe(false);
    expect(test.onChange).not.toHaveBeenCalled();
  });

  it('keeps a large presentation below editor minimum zoom during pan, wheel and pinch', async () => {
    const test = await mount(sample(), { inputMode: 'present' });
    await act(async () =>
      test.controller.current!.fitBounds(
        { x: 0, y: 0, width: 40000, height: 30000 },
        { animate: false },
      ),
    );
    expect(viewport(test.transform()).zoom).toBeCloseTo(0.02);
    await act(async () => {
      test.fire('pointerdown', 50, 50);
      test.fire('pointermove', 80, 80);
      test.fire('pointerup', 80, 80);
      test.svg.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: 30,
        }),
      );
    });
    await test.paint();
    expect(viewport(test.transform()).zoom).toBeCloseTo(0.02);
    await act(async () => {
      test.fire('pointerdown', 100, 100, 0, 1);
      test.fire('pointerdown', 200, 100, 0, 2);
      test.fire('pointermove', 180, 100, 0, 2);
      test.fire('pointerup', 100, 100, 0, 1);
      test.fire('pointerup', 180, 100, 0, 2);
    });
    expect(viewport(test.transform()).zoom).toBeCloseTo(0.016);
    expect(test.onChange).not.toHaveBeenCalled();
  });

  it('updates only old/new hover leaves without rebuilding the scene or layouts', async () => {
    const value = sample();
    (
      value.store.cells.root as ReturnType<typeof createFrameCell>
    ).children.push('b');
    value.store.cells.b = { ...value.store.cells.a, id: 'b' };
    const controls = vi.fn((context) => (
      <circle
        data-hover-id={context.cell.id}
        data-hover={String(context.hovered)}
      />
    ));
    const shape = vi.spyOn(Core, 'nodeShapeSpec');
    const test = await mount(value, {
      extensions: [{ kind: 'geometry', renderControls: controls }],
    });
    const layouts = test.layout.mock.calls.length,
      shapes = shape.mock.calls.length;
    const fire = async (id: string, type: string, related?: Element) =>
      act(async () => {
        test.svg
          .querySelector(`[data-cell-id="${id}"]`)!
          .dispatchEvent(
            new MouseEvent(type, { bubbles: true, relatedTarget: related }),
          );
      });
    await fire('a', 'pointerover');
    expect(
      test.svg.querySelector('[data-hover-id="a"]')!.getAttribute('data-hover'),
    ).toBe('true');
    expect(
      test.svg.querySelector('[data-hover-id="b"]')!.getAttribute('data-hover'),
    ).toBe('false');
    const b = test.svg.querySelector('[data-cell-id="b"]')!;
    await fire('a', 'pointerout', b);
    expect(
      test.svg.querySelector('[data-hover-id="a"]')!.getAttribute('data-hover'),
    ).toBe('false');
    expect(
      test.svg.querySelector('[data-hover-id="b"]')!.getAttribute('data-hover'),
    ).toBe('true');
    expect(test.layout).toHaveBeenCalledTimes(layouts);
    expect(shape).toHaveBeenCalledTimes(shapes);
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it('highlights a hovered connector and its endpoints without rebuilding routes, and omits the highlight from export', async () => {
    const value = sample();
    const frame = value.store.cells.root as Core.FrameCell;
    value.store.cells.b = {
      ...value.store.cells.a,
      id: 'b',
      geometry: { x: 300, y: 200, width: 100, height: 50 },
    } as Core.NodeCell;
    value.store.cells.edge = {
      id: 'edge',
      cellType: 'edge',
      kind: 'arrow',
      source: { cellId: 'a' },
      target: { cellId: 'b' },
      route: { mode: 'auto' },
    };
    frame.children.push('b', 'edge');
    const routing = vi.spyOn(Core, 'routeOrthogonalAvoiding');
    const test = await mount(value);
    const builds = test.layout.mock.calls.length,
      searches = routing.mock.calls.length;
    const edge = test.svg.querySelector('[data-cell-id="edge"]')!;
    const visiblePath = edge
      .querySelector('[data-edge-display]')!
      .getAttribute('d');
    const hitPath = edge.querySelector('[data-edge-hit]')!.getAttribute('d');
    await act(async () => {
      edge.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    });
    expect(
      test.svg.querySelectorAll('[data-relation-highlight="edge"]'),
    ).toHaveLength(1);
    expect(
      test.svg.querySelectorAll('[data-relation-highlight="node"]'),
    ).toHaveLength(2);
    const outline = test.svg.querySelector('[data-relation-highlight="node"]')!;
    expect(outline.getAttribute('stroke-width')).toBe('2');
    expect(outline.getAttribute('opacity')).toBeNull();
    expect(outline.getAttribute('vector-effect')).toBeNull();
    expect(
      outline.querySelector('path,rect')!.getAttribute('d') ??
        outline.querySelector('rect')!.getAttribute('x'),
    ).toBeTruthy();
    const relatedLine = test.svg.querySelector(
      '[data-relation-highlight="edge"]',
    )!;
    expect(relatedLine.getAttribute('opacity')).toBeNull();
    expect(relatedLine.getAttribute('stroke-width')).toBe('2');
    const select = async (ids: string[]) =>
      act(async () => {
        test.controller.current!.runtime.select({ focus: ['root'], ids });
      });
    await select(['a']);
    const selectedOutline = test.svg.querySelector(
      '[data-node-highlight="a"][data-interaction-stroke="selected"]',
    )!;
    expect(selectedOutline.getAttribute('stroke-width')).toBe('3');
    expect(selectedOutline.getAttribute('vector-effect')).toBeNull();
    expect(
      selectedOutline.compareDocumentPosition(
        test.svg.querySelector('[data-selection-handles="a"]')!,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(selectedOutline.getAttribute('stroke')).toBe(
      outline.getAttribute('stroke'),
    );
    expect(
      test.svg
        .querySelector('[data-selection-handles="a"]')!
        .getAttribute('stroke-width'),
    ).toBe('1');
    expect(
      test.svg.querySelectorAll('[data-relation-highlight="node"]'),
    ).toHaveLength(1);
    expect(
      test.svg
        .querySelector('[data-relation-highlight="node"]')!
        .getAttribute('data-node-highlight'),
    ).toBe('b');
    await select(['a', 'b']);
    expect(
      test.svg.querySelectorAll('[data-relation-highlight="node"]'),
    ).toHaveLength(0);
    await select(['edge']);
    expect(
      test.svg.querySelectorAll('[data-relation-highlight="edge"]'),
    ).toHaveLength(0);
    expect(
      test.svg.querySelectorAll('[data-relation-highlight="node"]'),
    ).toHaveLength(2);
    await select([]);
    const { cloneFrameImageSvg } = await import('./frame-export');
    expect(
      cloneFrameImageSvg(test.svg).querySelectorAll(
        '[data-relation-highlight]',
      ),
    ).toHaveLength(0);
    expect(edge.querySelector('[data-edge-display]')!.getAttribute('d')).toBe(
      visiblePath,
    );
    expect(edge.querySelector('[data-edge-hit]')!.getAttribute('d')).toBe(
      hitPath,
    );
    const node = test.svg.querySelector('[data-cell-id="a"]')!;
    await act(async () => {
      edge.dispatchEvent(
        new MouseEvent('pointerout', { bubbles: true, relatedTarget: node }),
      );
    });
    expect(
      test.svg.querySelectorAll('[data-relation-highlight="edge"]'),
    ).toHaveLength(1);
    expect(
      test.svg.querySelectorAll('[data-relation-highlight="node"]'),
    ).toHaveLength(1);
    expect(test.layout).toHaveBeenCalledTimes(builds);
    expect(routing).toHaveBeenCalledTimes(searches);
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it.each(
    [0, 1, 1.5, 2, 8].flatMap((width) =>
      ['#000000', '#6366f1'].flatMap((color) =>
        [1, 0.15].map((opacity) => ({
          width,
          color,
          opacity,
          mode:
            width === 2
              ? ('orthogonal' as const)
              : width === 8
                ? ('curve' as const)
                : ('straight' as const),
        })),
      ),
    ),
  )(
    'scales replacement strokes while keeping shadows screen-sized ($mode, $width px, $color, opacity=$opacity)',
    async ({ width, color, mode, opacity }) => {
      const frames = controlledFrames();
      const value = sample(),
        frame = value.store.cells.root as Core.FrameCell;
      const appearance = {
        strokeColor: color,
        strokeWidth: width,
        opacity,
        shadow: 'lg',
        strokeStyle: 'dashed' as const,
      };
      (value.store.cells.a as Core.NodeCell).appearance = appearance;
      value.store.cells.b = {
        ...value.store.cells.a,
        id: 'b',
        geometry: { x: 300, y: 10, width: 100, height: 50 },
      } as Core.NodeCell;
      value.store.cells.edge = {
        id: 'edge',
        cellType: 'edge',
        kind: 'arrow',
        source: { cellId: 'a' },
        target: { cellId: 'b' },
        route: { mode },
        appearance,
        data: { targetMarker: 'solid-triangle' },
        labels: [{ text: 'Label' }],
      };
      frame.children.push('b', 'edge');
      const original = JSON.stringify(value);
      const routing = vi.spyOn(Core, 'routeOrthogonalAvoiding');
      const test = await mount(value);
      const layouts = test.layout.mock.calls.length,
        routes = routing.mock.calls.length;
      const select = async (ids: string[]) =>
        act(async () => {
          test.controller.current!.runtime.select({ focus: ['root'], ids });
        });
      const edge = test.svg.querySelector('[data-cell-id="edge"]')!;
      const display = edge.querySelector('[data-edge-display]')!;
      const path = display.getAttribute('d');
      const hit = edge.querySelector('[data-edge-hit]')!;
      const hitPath = hit.getAttribute('d');
      const normal = display.parentElement!.parentElement!;
      const normalFilter = normal.getAttribute('filter');
      expect(normal.getAttribute('opacity')).toBe(String(opacity));
      expect(normal.querySelector('[data-edge-label]')).not.toBeNull();
      await act(async () =>
        edge.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })),
      );
      const related = edge.querySelector(
        '[data-interaction-stroke="related"]',
      )!;
      expect(related.getAttribute('stroke-width')).toBe(String(width));
      expect(related.closest('[opacity]')).toBeNull();
      expect(related.parentElement!.closest('[filter]')).toBeNull();
      expect(related.querySelector('foreignObject')).toBeNull();
      await select(['a', 'edge']);
      expect(edge.querySelector('[data-relation-highlight]')).toBeNull();
      const selectedEdge = edge.querySelector(
        '[data-interaction-stroke="selected"]',
      )!;
      const selectedNode = test.svg.querySelector(
        '[data-node-highlight="a"][data-interaction-stroke="selected"]',
      )!;
      for (const zoom of [0.5, 1, 2]) {
        await act(async () =>
          test.controller.current!.executeAction('canvas.view.set-zoom', {
            zoom,
          }),
        );
        await frames.paint();
        for (const outline of [selectedEdge, selectedNode]) {
          expect(outline.getAttribute('stroke')).toBe('#6366f1');
          expect(outline.getAttribute('stroke-width')).toBe(String(width + 1));
          expect(outline.getAttribute('stroke-dasharray')).toBe(
            outline === selectedEdge ? '8 4' : 'none',
          );
          expect(outline.closest('[opacity]')).toBeNull();
          const filter = test.svg.querySelector(
            `[id="${outline.getAttribute('filter')!.slice(5, -1)}"]`,
          )!;
          const blurs = filter.querySelectorAll('feGaussianBlur');
          expect(Number(blurs[0].getAttribute('stdDeviation')) * zoom).toBe(
            2.25,
          );
          expect(Number(blurs[1].getAttribute('stdDeviation')) * zoom).toBe(
            1.25,
          );
          const spread = filter.querySelector('feMorphology')!;
          expect(spread.getAttribute('operator')).toBe('dilate');
          expect(Number(spread.getAttribute('radius')) * zoom).toBe(0.75);
          expect(filter.getAttribute('filterUnits')).toBe('userSpaceOnUse');
          expect(Number(filter.getAttribute('height'))).toBeGreaterThan(0);
        }
        for (const part of selectedEdge.querySelectorAll('path'))
          expect(part.getAttribute('vector-effect')).toBeNull();
        expect(selectedNode.getAttribute('vector-effect')).toBeNull();
        expect(display.getAttribute('d')).toBe(path);
        expect(hit.getAttribute('d')).toBe(hitPath);
      }
      expect(display.getAttribute('stroke-width')).toBe(String(width));
      expect(display.getAttribute('stroke')).toBe(color);
      expect(normal.getAttribute('filter')).toBe(normalFilter);
      expect(hit.closest('[filter]')).toBeNull();
      expect(selectedNode.parentElement!.closest('[filter]')).toBeNull();
      const { cloneFrameImageSvg } = await import('./frame-export');
      const exported = cloneFrameImageSvg(test.svg);
      expect(exported.querySelector('[data-interaction-stroke]')).toBeNull();
      expect(
        exported.querySelector('filter[id^="frame-interaction-"]'),
      ).toBeNull();
      expect(
        exported
          .querySelector('[data-edge-display]')!
          .getAttribute('stroke-width'),
      ).toBe(String(width));
      expect(
        exported
          .querySelector('[data-edge-display]')!
          .parentElement!.parentElement!.getAttribute('filter'),
      ).toBe(normalFilter);
      await select([]);
      await act(async () =>
        edge.dispatchEvent(new MouseEvent('pointerout', { bubbles: true })),
      );
      expect(test.svg.querySelector('[data-interaction-stroke]')).toBeNull();
      expect(JSON.stringify(value)).toBe(original);
      expect(test.layout).toHaveBeenCalledTimes(layouts);
      expect(routing).toHaveBeenCalledTimes(routes);
      expect(test.onChange).not.toHaveBeenCalled();
    },
  );
  it.each([
    'geometry',
    'frame',
    'frame-reference',
    'document-frame',
    'document-reference',
  ] as const)(
    'highlights an isolated %s itself, restores its authored paint and exports without interaction state',
    async (kind) => {
      const value = sample();
      const geometry = { x: 10, y: 10, width: 300, height: 180 };
      const appearance = {
        strokeColor: '#000000',
        strokeWidth: 1.5,
        fill: '#dbeafe',
        opacity: 0.2,
      };
      const create = () => {
        if (kind === 'frame') return Core.createFrameCell('a', geometry);
        if (kind === 'frame-reference')
          return Core.createFrameReferenceCell('a', 'missing', geometry);
        if (kind === 'document-frame')
          return Core.createDocumentFrameCell('a', 'document', geometry);
        if (kind === 'document-reference')
          return Core.createDocumentReferenceCell('a', 'document', geometry);
        return { ...value.store.cells.a, geometry } as Core.NodeCell;
      };
      value.store.cells.a = { ...create(), appearance };
      const original = JSON.stringify(value);
      const test = await mount(value);
      const node = test.svg.querySelector('[data-cell-id="a"]')!;
      const hover = async (type: string) =>
        act(async () =>
          node.dispatchEvent(new MouseEvent(type, { bubbles: true })),
        );
      await hover('pointerover');
      const secondary = test.svg.querySelector('[data-node-highlight="a"]')!;
      expect(secondary.getAttribute('data-interaction-stroke')).toBe('related');
      expect(secondary.getAttribute('stroke-width')).toBe('1.5');
      const authored = node.querySelector<SVGElement>(
        '[data-frame-original-stroke-opacity]',
      )!;
      expect(authored).not.toBeNull();
      expect(authored.style.strokeOpacity).toBe('0');
      expect(
        secondary.querySelector('[stroke="#6366f1"]')!.getAttribute('fill'),
      ).toBe('none');
      const { cloneFrameImageSvg } = await import('./frame-export');
      const cloned = cloneFrameImageSvg(test.svg);
      expect(cloned.querySelector('[data-node-highlight]')).toBeNull();
      expect(
        cloned.querySelector('[data-frame-original-stroke-opacity]'),
      ).toBeNull();
      const restored = cloned.querySelector<SVGElement>(
        '[data-cell-id="a"] [data-frame-node-outline]',
      );
      expect(restored).not.toBeNull();
      await act(async () =>
        test.controller.current!.runtime.select({
          focus: ['root'],
          ids: ['a'],
        }),
      );
      const primary = test.svg.querySelector('[data-node-highlight="a"]')!;
      expect(primary.getAttribute('data-interaction-stroke')).toBe('selected');
      expect(primary.getAttribute('stroke-width')).toBe('2.5');
      expect(
        test.svg.querySelectorAll('[data-node-highlight="a"]'),
      ).toHaveLength(1);
      await hover('pointerout');
      expect(primary.getAttribute('data-interaction-stroke')).toBe('selected');
      await act(async () =>
        test.controller.current!.runtime.select({ focus: ['root'], ids: [] }),
      );
      expect(test.svg.querySelector('[data-node-highlight="a"]')).toBeNull();
      expect(
        node.querySelector('[data-frame-original-stroke-opacity]'),
      ).toBeNull();
      expect(authored.style.strokeOpacity).toBe('');
      expect(JSON.stringify(value)).toBe(original);
      expect(test.onChange).not.toHaveBeenCalled();
    },
  );
  it.each([
    { marker: 'solid-triangle', fill: '#6366f1', authored: '#000000' },
    { marker: 'hollow-triangle', fill: '#fff', authored: '#fff' },
    { marker: 'arrow', fill: 'none', authored: 'none' },
  ])(
    'replaces $marker arrow paint without changing its fill meaning or dash semantics',
    async ({ marker, fill, authored }) => {
      const value = sample();
      (value.store.cells.root as Core.FrameCell).children.push('edge');
      value.store.cells.edge = {
        id: 'edge',
        kind: 'arrow',
        cellType: 'edge',
        source: { point: [0, 100] },
        target: { point: [300, 100] },
        route: { mode: 'straight' },
        appearance: {
          strokeColor: '#000000',
          strokeWidth: 8,
          strokeStyle: 'dashed',
        },
        data: { targetMarker: marker },
      };
      const test = await mount(value);
      await act(async () =>
        test.controller.current!.runtime.select({
          focus: ['root'],
          ids: ['edge'],
        }),
      );
      const edge = test.svg.querySelector('[data-cell-id="edge"]')!;
      const overlay = edge.querySelector(
        '[data-interaction-stroke="selected"]',
      )!;
      expect(overlay.getAttribute('stroke-width')).toBe('9');
      expect(overlay.getAttribute('stroke-dasharray')).toBe('8 4');
      const arrow = overlay.querySelectorAll('path')[1];
      expect(arrow.getAttribute('fill')).toBe(fill);
      expect(arrow.getAttribute('stroke-dasharray')).toBe('none');
      expect(
        edge
          .querySelector('[data-frame-original-opacity]')!
          .getAttribute('opacity'),
      ).toBe('0');
      const { cloneFrameImageSvg } = await import('./frame-export');
      const exported = cloneFrameImageSvg(test.svg);
      expect(
        exported.querySelector('[data-arrow-marker]')!.getAttribute('fill'),
      ).toBe(authored);
      expect(
        exported
          .querySelector('[data-edge-display]')!
          .getAttribute('stroke-width'),
      ).toBe('8');
      expect(exported.querySelector('[data-interaction-stroke]')).toBeNull();
    },
  );
  it('replaces explicit custom contours while preserving fill, internal dividers and text through export', async () => {
    const value = sample();
    (value.store.cells.a as Core.NodeCell).geometry.rotation = Math.PI / 4;
    const test = await mount(value, {
      extensions: [
        {
          kind: 'geometry',
          renderShape: ({ geometry: bounds }) => (
            <g>
              <rect
                data-custom-outline
                x={bounds!.x}
                y={bounds!.y}
                width={bounds!.width}
                height={bounds!.height}
                stroke="#000000"
                strokeWidth={8}
                fill="#abcdee"
              />
              <path
                data-frame-interaction-ignore
                data-divider
                d="M10 30 H110"
                stroke="#333333"
              />
              <text fill="#111111" stroke="none">
                Original text
              </text>
            </g>
          ),
        },
      ],
    });
    const node = test.svg.querySelector('[data-cell-id="a"]')!;
    const paths = node.innerHTML;
    await act(async () =>
      node.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })),
    );
    const overlay = test.svg.querySelector('[data-node-highlight="a"]')!;
    expect(overlay.getAttribute('stroke-width')).toBe('8');
    expect(overlay.querySelector('rect')!.getAttribute('stroke')).toBe(
      '#6366f1',
    );
    expect(overlay.querySelector('rect')!.getAttribute('stroke-width')).toBe(
      '8',
    );
    expect(overlay.querySelector('text')).toBeNull();
    expect(overlay.querySelector('[data-divider]')).toBeNull();
    const outline = node.querySelector<SVGElement>('[data-custom-outline]')!;
    expect(outline.getAttribute('fill')).toBe('#abcdee');
    expect(outline.getAttribute('stroke')).toBe('#000000');
    expect(outline.style.strokeOpacity).toBe('0');
    const divider = node.querySelector<SVGElement>('[data-divider]')!;
    expect(divider.style.strokeOpacity).toBe('');
    expect(divider.getAttribute('stroke')).toBe('#333333');
    const { cloneFrameImageSvg } = await import('./frame-export');
    const clone = cloneFrameImageSvg(test.svg);
    expect(
      clone.querySelector<SVGElement>('[data-custom-outline]')!.style
        .strokeOpacity,
    ).toBe('1');
    expect(
      clone
        .querySelector('[data-custom-outline]')!
        .getAttribute('stroke-width'),
    ).toBe('8');
    expect(clone.querySelector('[data-node-highlight]')).toBeNull();
    await act(async () =>
      node.dispatchEvent(new MouseEvent('pointerout', { bubbles: true })),
    );
    expect(node.innerHTML).toBe(paths);
  });
  it('suppresses relationship outlines on an actively edited node even when canvas selection is cleared', async () => {
    const value = sample(),
      frame = value.store.cells.root as Core.FrameCell;
    value.store.cells.b = {
      ...value.store.cells.a,
      id: 'b',
      geometry: { x: 300, y: 200, width: 100, height: 50 },
    } as Core.NodeCell;
    value.store.cells.edge = {
      id: 'edge',
      cellType: 'edge',
      kind: 'arrow',
      source: { cellId: 'a' },
      target: { cellId: 'b' },
      route: { mode: 'auto' },
    };
    frame.children.push('b', 'edge');
    const test = await mount(value);
    await act(async () =>
      test.controller.current!.executeAction('canvas.selection.edit', {
        cellId: 'a',
      }),
    );
    await act(async () =>
      test.controller.current!.runtime.select({ focus: ['root'], ids: [] }),
    );
    expect(test.svg.querySelector('[data-frame-text-editor]')).not.toBeNull();
    await act(async () =>
      test.svg
        .querySelector('[data-cell-id="edge"]')!
        .dispatchEvent(new MouseEvent('pointerover', { bubbles: true })),
    );
    const outlines = test.svg.querySelectorAll(
      '[data-relation-highlight="node"]',
    );
    expect(outlines).toHaveLength(1);
    expect(outlines[0].getAttribute('data-node-highlight')).toBe('b');
  });
  it.each([false, true])(
    'reuses actual shape geometry after text updates (derived=%s) while extensions receive the latest store',
    async (derived) => {
      const frames = controlledFrames();
      const shape = vi.spyOn(Core, 'nodeShapeSpec');
      const stores: Core.CellStore[] = [];
      const test = await mount(sample(), {
        extensions: [
          {
            layout: (store) => {
              stores.push(store);
              return derived
                ? new Map([
                    [
                      'a',
                      {
                        ...(store.cells.a as Core.NodeCell).geometry,
                        derived: true,
                      },
                    ],
                  ])
                : new Map();
            },
          },
        ],
      });
      const initial = shape.mock.calls.length;
      for (let at = 0; at < 5; at++)
        await act(async () => {
          const cell = test.controller.current!.runtime.store.cells
            .a as Core.NodeCell;
          await test.controller.current!.dispatch({
            id: `typing-${at}`,
            operations: [
              {
                type: 'replace_cell',
                cell: { ...cell, content: { label: `Text ${at}` } },
              },
            ],
          });
        });
      expect(shape).toHaveBeenCalledTimes(initial);
      expect((stores.at(-1)!.cells.a as Core.NodeCell).content?.label).toBe(
        'Text 4',
      );
      expect(test.svg.textContent).toContain('Text 4');
      await frames.paint();
    },
  );

  it('defaults shared Frame outlines to a scaling 1px border and respects explicit appearances', async () => {
    const value = sample();
    const nested = createFrameCell('nested');
    (
      value.store.cells.root as ReturnType<typeof createFrameCell>
    ).children.push('nested');
    value.store.cells.nested = nested;
    const test = await mount(value);
    const plate = () => test.svg.querySelector('[data-frame-outline]')!;
    expect(plate().getAttribute('stroke')).toBe('#cbd5e1');
    expect(plate().getAttribute('stroke-width')).toBe('1');
    expect(plate().hasAttribute('vector-effect')).toBe(false);
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 2,
      }),
    );
    await test.paint();
    expect(test.transform()).toContain('scale(2)');
    expect(plate().getAttribute('stroke-width')).toBe('1');
    for (const appearance of [
      { strokeColor: '#123456', strokeWidth: 3 },
      { strokeColor: 'none', strokeWidth: 0 },
    ]) {
      await act(async () =>
        test.render('root', undefined, {
          store: {
            ...value.store,
            cells: { ...value.store.cells, nested: { ...nested, appearance } },
          },
        }),
      );
      expect(plate().getAttribute('stroke')).toBe(appearance.strokeColor);
      expect(plate().getAttribute('stroke-width')).toBe(
        String(appearance.strokeWidth),
      );
    }
    await act(async () =>
      test.controller.current!.runtime.select({
        focus: ['root'],
        ids: ['nested'],
      }),
    );
    expect(plate().getAttribute('stroke')).toBe('none');
    const interaction = test.svg.querySelector(
      '[data-node-highlight="nested"][data-interaction-stroke="selected"]',
    )!;
    expect(interaction.getAttribute('stroke')).toBe('#6366f1');
    expect(interaction.getAttribute('stroke-width')).toBe('1');
  });
  it.each([
    { host: false, readonly: false },
    { host: true, readonly: true },
  ])(
    'centers selection at the latest zoom inside the usable viewport without document changes (%o)',
    async (mode) => {
      const frames = controlledFrames();
      const onSelectionChange = vi.fn();
      const test = await mount(sample(), {
        ...mode,
        onSelectionChange,
        viewportInsets: { top: 112, right: 292, bottom: 64, left: 64 },
      });
      const runtime = test.controller.current!.runtime;
      await act(async () => runtime.select({ focus: ['root'], ids: ['a'] }));
      const selection = runtime.selection,
        revision = runtime.revision,
        history = runtime.history;
      await act(async () => {
        test.controller.current!.executeAction('canvas.view.set-zoom', {
          zoom: 2,
        });
        expect(frames.callbacks.size).toBe(1);
        test.controller.current!.executeAction('canvas.view.center');
      });
      expect(test.transform()).toBe('scale(2) translate(83 127)');
      expect(frames.callbacks.size).toBe(0);
      expect(runtime.selection).toBe(selection);
      expect(runtime.revision).toBe(revision);
      expect(runtime.history).toBe(history);
      expect(test.onChange).not.toHaveBeenCalled();
      expect(test.onIntent).not.toHaveBeenCalled();
      expect(onSelectionChange).not.toHaveBeenCalled();
    },
  );
  it('centers the union of group nodes, rotated geometry and frame titles, ignoring edges', async () => {
    const value = sample(),
      root = value.store.cells.root as ReturnType<typeof createFrameCell>;
    const a = value.store.cells.a as Core.NodeCell;
    a.geometry.rotation = Math.PI / 2;
    value.store.cells.b = {
      ...a,
      id: 'b',
      geometry: { x: 300, y: 150, width: 80, height: 20 },
    };
    value.store.cells.shell = createFrameCell('shell', {
      x: 600,
      y: 200,
      width: 100,
      height: 80,
    });
    value.store.cells.edge = {
      id: 'edge',
      cellType: 'edge',
      kind: 'arrow',
      source: { point: [-10000, -10000] },
      target: { point: [-9000, -9000] },
      route: { mode: 'straight' },
    };
    value.store.cells.pair = {
      id: 'pair',
      cellType: 'group',
      kind: 'group',
      members: ['a', 'b'],
    };
    root.children = ['a', 'b', 'shell', 'edge'];
    root.groups = ['pair'];
    const test = await mount(value);
    await act(async () =>
      test.controller.current!.runtime.select({
        focus: ['root'],
        ids: ['pair', 'shell', 'edge'],
      }),
    );
    const initialBounds = test.controller.current!.selectionScreenBounds()!;
    expect(initialBounds.x).toBeCloseTo(35);
    expect(initialBounds.y).toBeCloseTo(-15);
    expect(initialBounds.width).toBeCloseTo(665);
    expect(initialBounds.height).toBeCloseTo(295);
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.center'),
    );
    const camera = viewport(test.transform());
    expect(camera.zoom).toBe(1);
    expect(camera.origin[0]).toBeCloseTo(-32.5);
    expect(camera.origin[1]).toBeCloseTo(-167.5);
    const screen = test.controller.current!.selectionScreenBounds()!;
    expect(screen.x + screen.width / 2).toBeCloseTo(400);
    expect(screen.y + screen.height / 2).toBeCloseTo(300);
  });
  it('ignores hidden and unrendered nodes, edge-only selection and targets deleted after selection', async () => {
    const value = sample(),
      root = value.store.cells.root as ReturnType<typeof createFrameCell>,
      a = value.store.cells.a as Core.NodeCell;
    value.store.cells.hidden = {
      ...a,
      id: 'hidden',
      hidden: true,
      geometry: { x: 10000, y: 10000, width: 100, height: 50 },
    };
    value.store.cells.collapsed = {
      ...a,
      id: 'collapsed',
      geometry: { x: -10000, y: -10000, width: 100, height: 50 },
    };
    value.store.cells.edge = {
      id: 'edge',
      cellType: 'edge',
      kind: 'arrow',
      source: { point: [10000, 10000] },
      target: { point: [20000, 20000] },
      route: { mode: 'straight' },
    };
    root.children.push('hidden', 'collapsed', 'edge');
    const test = await mount(value, {
      extensions: [
        { kind: 'geometry', visible: ({ cell }) => cell.id !== 'collapsed' },
      ],
    });
    const runtime = test.controller.current!.runtime;
    for (const ids of [[], ['edge'], ['hidden', 'collapsed']]) {
      await act(async () => runtime.select({ focus: ['root'], ids }));
      const camera = test.transform();
      await act(async () =>
        test.controller.current!.executeAction('canvas.view.center'),
      );
      expect(test.transform()).toBe(camera);
      expect(test.controller.current!.selectionScreenBounds()).toBeNull();
    }
    await act(async () =>
      runtime.select({
        focus: ['root'],
        ids: ['a', 'hidden', 'collapsed', 'edge'],
      }),
    );
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.center'),
    );
    expect(test.transform()).toBe('scale(1) translate(340 265)');
    await act(async () =>
      test.controller.current!.dispatch({
        id: 'remove-selected',
        operations: [{ type: 'remove_cell', cellId: 'a' }],
      }),
    );
    const camera = test.transform(),
      revision = runtime.revision,
      changes = test.onChange.mock.calls.length;
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.center'),
    );
    expect(test.transform()).toBe(camera);
    expect(runtime.revision).toBe(revision);
    expect(test.onChange).toHaveBeenCalledTimes(changes);
  });
  it('uses every nested frame placement and derived geometry without SVG matrices', async () => {
    const frames = controlledFrames();
    const onViewStateChange = vi.fn();
    const value = sample(),
      root = value.store.cells.root as ReturnType<typeof createFrameCell>,
      a = value.store.cells.a as Core.NodeCell;
    root.children = ['outer'];
    const outer = createFrameCell('outer', {
      x: 100,
      y: 200,
      width: 300,
      height: 200,
    });
    const inner = createFrameCell('inner', {
      x: 20,
      y: 40,
      width: 150,
      height: 100,
    });
    outer.children = ['inner', 'sibling'];
    inner.children = ['target', 'other'];
    Object.assign(value.store.cells, {
      outer,
      inner,
      target: {
        ...a,
        id: 'target',
        geometry: { x: 10, y: 20, width: 200, height: 100 },
      },
      other: {
        ...a,
        id: 'other',
        geometry: { x: 500, y: 200, width: 100, height: 100 },
      },
      sibling: {
        ...a,
        id: 'sibling',
        geometry: { x: 300, y: 0, width: 100, height: 100 },
      },
    });
    delete value.store.cells.a;
    const test = await mount(value, {
      onViewStateChange,
      extensions: [
        {
          layout: (_store, frameId) =>
            new Map(
              frameId === 'root'
                ? [['outer', { x: 500, y: 400, width: 600, height: 300 }]]
                : frameId === 'outer'
                  ? [['inner', { x: 40, y: 60, width: 180, height: 120 }]]
                  : [['target', { x: 100, y: 50, width: 200, height: 100 }]],
            ),
        },
      ],
    });
    await act(async () =>
      test.controller.current!.runtime.select({
        focus: ['root', 'outer', 'inner'],
        ids: ['target'],
      }),
    );
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.center'),
    );
    const camera = viewport(test.transform());
    expect(camera.zoom).toBe(1);
    // Inner content scales to 56 / 250; outer content remains at 1:1.
    // The selected center becomes (96.4, 119.2), then (676.4, 595.2).
    expect(camera.origin[0]).toBeCloseTo(276.4);
    expect(camera.origin[1]).toBeCloseTo(295.2);
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 2,
      }),
    );
    await frames.paint();
    const bounds = onViewStateChange.mock.lastCall![0].selectionScreenBounds;
    expect(bounds.x).toBeCloseTo(755.2);
    expect(bounds.y).toBeCloseTo(577.6);
    expect(bounds.width).toBeCloseTo(89.6);
    expect(bounds.height).toBeCloseTo(44.8);
  });
  it('uses the mounted SVG matrix before geometry fallback', async () => {
    const test = await mount();
    const element =
        test.svg.querySelector<SVGGraphicsElement>('[data-cell-id="a"]')!,
      world = test.svg.querySelector<SVGGElement>('[data-frame-world]')!;
    element.getScreenCTM = vi.fn(
      () => ({ a: 0, b: 2, c: -2, d: 0, e: 1010, f: 420 }) as DOMMatrix,
    );
    world.getScreenCTM = vi.fn(
      () =>
        ({
          inverse: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: -5, f: -10 }),
        }) as DOMMatrix,
    );
    await act(async () =>
      test.controller.current!.runtime.select({ focus: ['root'], ids: ['a'] }),
    );
    await act(async () => {
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 2,
      });
      test.controller.current!.executeAction('canvas.view.center');
    });
    expect(test.transform()).toBe('scale(2) translate(-265 -110)');
  });
  it('does not center during a pan, then centers at the retained zoom after release', async () => {
    const test = await mount(sample(), { tool: 'hand' });
    await act(async () =>
      test.controller.current!.runtime.select({ focus: ['root'], ids: ['a'] }),
    );
    await act(async () => {
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 2,
      });
      test.fire('pointerdown', 100, 100);
      test.fire('pointermove', 200, 100);
    });
    await test.paint();
    const camera = test.transform();
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.center'),
    );
    expect(test.transform()).toBe(camera);
    await act(async () => {
      test.fire('pointerup', 200, 100);
      test.controller.current!.executeAction('canvas.view.center');
    });
    // The public handle receives the finished gesture's view on the next commit.
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.center'),
    );
    expect(test.transform()).toBe('scale(2) translate(140 115)');
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it('publishes pinch dragging until release, then allows centering the retained selection', async () => {
    const onViewStateChange = vi.fn();
    const test = await mount(sample(), { tool: 'hand', onViewStateChange });
    await act(async () =>
      test.controller.current!.runtime.select({ focus: ['root'], ids: ['a'] }),
    );
    await act(async () => {
      test.fire('pointerdown', 100, 100, 0, 1);
      test.fire('pointerdown', 200, 100, 0, 2);
    });
    expect(onViewStateChange.mock.lastCall![0].dragging).toBe(true);
    await act(async () => test.fire('pointermove', 300, 100, 0, 2));
    await test.paint();
    const camera = test.transform();
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.center'),
    );
    expect(test.transform()).toBe(camera);
    await act(async () => {
      test.fire('pointerup', 300, 100, 0, 2);
      test.fire('pointerup', 100, 100, 0, 1);
    });
    expect(onViewStateChange.mock.lastCall![0].dragging).toBe(false);
    expect(test.controller.current!.runtime.selection.ids).toEqual(['a']);
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.center'),
    );
    expect(test.transform()).toBe('scale(2) translate(140 115)');
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it.each([
    { mode: 'orthogonal', segmentCursors: ['ns-resize', 'ew-resize'] },
    { mode: 'fixed', segmentCursors: ['move', 'move'] },
  ] as const)(
    'shows drag cursors for $mode edge handles',
    async ({ mode, segmentCursors }) => {
      const value = sample();
      const root = value.store.cells.root as ReturnType<typeof createFrameCell>;
      value.store.cells.edge = {
        id: 'edge',
        cellType: 'edge',
        kind: 'arrow',
        source: { point: [150, 100] },
        target: { point: [250, 180] },
        route: {
          mode,
          points: [
            [150, 100],
            [250, 100],
            [250, 180],
          ],
        },
      };
      root.children.push('edge');
      const test = await mount(value);
      await act(async () =>
        test.controller.current!.runtime.select({
          focus: ['root'],
          ids: ['edge'],
        }),
      );
      const cursors = (selector: string) =>
        Array.from(
          test.svg.querySelectorAll<SVGElement>(selector),
          (handle) => handle.style.cursor,
        );
      expect(cursors('[data-edge-endpoint]')).toEqual(['move', 'move']);
      expect(cursors('[data-edge-route-point]')).toEqual(['move']);
      expect(cursors('[data-edge-segment]')).toEqual(segmentCursors);
    },
  );
  it('publishes edge-handle dragging and clears it on cancellation for mixed selection', async () => {
    const value = sample(),
      root = value.store.cells.root as ReturnType<typeof createFrameCell>;
    value.store.cells.edge = {
      id: 'edge',
      cellType: 'edge',
      kind: 'arrow',
      source: { point: [150, 100] },
      target: { point: [250, 100] },
      route: { mode: 'straight' },
    };
    root.children.push('edge');
    const onViewStateChange = vi.fn();
    const test = await mount(value, { onViewStateChange });
    await act(async () =>
      test.controller.current!.runtime.select({
        focus: ['root'],
        ids: ['a', 'edge'],
      }),
    );
    const handle = test.svg.querySelector('[data-edge-endpoint="source"]')!;
    await act(async () => {
      const event = new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        buttons: 1,
        clientX: 150,
        clientY: 100,
      });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      handle.dispatchEvent(event);
    });
    expect(onViewStateChange.mock.lastCall![0].dragging).toBe(true);
    const camera = test.transform();
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.center'),
    );
    expect(test.transform()).toBe(camera);
    await act(async () => test.fire('pointercancel', 150, 100));
    expect(onViewStateChange.mock.lastCall![0].dragging).toBe(false);
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.center'),
    );
    expect(test.transform()).toBe('scale(1) translate(340 265)');
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it('retains the latest camera when input arrives during a scene commit', async () => {
    const frames = controlledFrames();
    const onViewStateChange = vi.fn();
    function WheelDuringCommit({ selected }: { selected: boolean }) {
      useLayoutEffect(() => {
        if (selected)
          document
            .querySelector('svg[aria-label="Frame canvas"]')!
            .dispatchEvent(
              new WheelEvent('wheel', {
                bubbles: true,
                deltaX: 10,
                deltaY: 20,
              }),
            );
      }, [selected]);
      return <rect width={100} height={50} />;
    }
    const test = await mount(sample(), {
      onViewStateChange,
      extensions: [
        {
          kind: 'geometry',
          renderShape: ({ selected }) => (
            <WheelDuringCommit selected={selected} />
          ),
        },
      ],
    });
    await act(async () =>
      test.controller.current!.runtime.select({ focus: ['root'], ids: ['a'] }),
    );
    expect(frames.callbacks.size).toBe(1);
    expect(test.transform()).toBe('scale(1) translate(-10 -20)');
    expect(onViewStateChange.mock.lastCall![0]).toMatchObject({
      zoom: 1,
      selectionScreenBounds: { x: 0, y: -10, width: 100, height: 50 },
    });
    await frames.paint();
    expect(test.transform()).toBe('scale(1) translate(-10 -20)');
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it('projects the committed selection through camera paints without DOM measurements', async () => {
    const frames = controlledFrames();
    const onViewStateChange = vi.fn();
    const test = await mount(sample(), { onViewStateChange });
    const element =
      test.svg.querySelector<SVGGraphicsElement>('[data-cell-id="a"]')!;
    const world = test.svg.querySelector<SVGGElement>('[data-frame-world]')!;
    const elementMatrix = (element.getScreenCTM = vi.fn(
      () => ({ a: 1, b: 0, c: 0, d: 1, e: 400, f: 200 }) as DOMMatrix,
    ));
    const worldMatrix = (world.getScreenCTM = vi.fn(
      () =>
        ({
          inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        }) as DOMMatrix,
    ));
    await act(async () =>
      test.controller.current!.runtime.select({ focus: ['root'], ids: ['a'] }),
    );
    expect(onViewStateChange.mock.lastCall![0].selectionScreenBounds).toEqual({
      x: 410,
      y: 210,
      width: 100,
      height: 50,
    });
    const viewportRect = vi.mocked(
      SVGSVGElement.prototype.getBoundingClientRect,
    );
    const before = [
      elementMatrix.mock.calls.length,
      worldMatrix.mock.calls.length,
      viewportRect.mock.calls.length,
    ];
    const query = vi.spyOn(test.svg, 'querySelectorAll');
    for (const zoom of [2, 3, 0.75]) {
      await act(async () =>
        test.controller.current!.executeAction('canvas.view.set-zoom', {
          zoom: zoom,
        }),
      );
      await frames.paint();
      expect(onViewStateChange.mock.lastCall![0]).toMatchObject({
        zoom,
        selectionScreenBounds: {
          x: 410 * zoom,
          y: 210 * zoom,
          width: 100 * zoom,
          height: 50 * zoom,
        },
      });
      expect([
        elementMatrix.mock.calls.length,
        worldMatrix.mock.calls.length,
        viewportRect.mock.calls.length,
      ]).toEqual(before);
    }
    await act(async () =>
      test.svg.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          deltaX: 30,
          deltaY: 15,
        }),
      ),
    );
    const afterInputReads = viewportRect.mock.calls.length;
    expect(afterInputReads).toBe(before[2]);
    await frames.paint();
    expect(viewportRect.mock.calls.length).toBe(afterInputReads);
    expect(query).not.toHaveBeenCalled();
    expect(elementMatrix).toHaveBeenCalledTimes(before[0]);
    expect(worldMatrix).toHaveBeenCalledTimes(before[1]);
    expect(onViewStateChange.mock.lastCall![0].selectionScreenBounds).toEqual({
      x: 410 * 0.75 - 30,
      y: 210 * 0.75 - 15,
      width: 75,
      height: 37.5,
    });
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it('refreshes cached world geometry on document and selection commits', async () => {
    const frames = controlledFrames();
    const onViewStateChange = vi.fn();
    const value = sample();
    const root = value.store.cells.root as ReturnType<typeof createFrameCell>;
    root.children.push('b');
    value.store.cells.b = {
      ...value.store.cells.a,
      id: 'b',
      geometry: { x: 300, y: 200, width: 40, height: 20 },
    };
    const test = await mount(value, { onViewStateChange });
    await act(async () =>
      test.controller.current!.runtime.select({ focus: ['root'], ids: ['a'] }),
    );
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 2,
      }),
    );
    await frames.paint();
    expect(onViewStateChange.mock.lastCall![0].selectionScreenBounds).toEqual({
      x: 20,
      y: 20,
      width: 200,
      height: 100,
    });
    const moved: FrameSnapshot = {
      ...value,
      store: {
        ...value.store,
        cells: {
          ...value.store.cells,
          a: {
            ...(value.store.cells.a as Core.NodeCell),
            geometry: { x: 240, y: 80, width: 120, height: 90 },
          },
        },
      },
    };
    await act(async () => test.render('root', undefined, moved));
    expect(onViewStateChange.mock.lastCall![0].selectionScreenBounds).toEqual({
      x: 480,
      y: 160,
      width: 240,
      height: 180,
    });
    await act(async () =>
      test.controller.current!.runtime.select({ focus: ['root'], ids: ['b'] }),
    );
    expect(onViewStateChange.mock.lastCall![0].selectionScreenBounds).toEqual({
      x: 600,
      y: 400,
      width: 80,
      height: 40,
    });
    const removed: FrameSnapshot = {
      ...moved,
      store: {
        ...moved.store,
        cells: {
          ...moved.store.cells,
          root: { ...root, children: ['a'] },
        },
      },
    };
    delete removed.store.cells.b;
    await act(async () => test.render('root', undefined, removed));
    expect(
      onViewStateChange.mock.lastCall![0].selectionScreenBounds,
    ).toBeNull();
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it('refreshes viewport position on scroll, resize and observation without measuring the scene', async () => {
    let resize: ResizeObserverCallback;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const frames = controlledFrames();
    const onViewStateChange = vi.fn();
    const test = await mount(sample(), { onViewStateChange });
    await act(async () =>
      test.controller.current!.runtime.select({ focus: ['root'], ids: ['a'] }),
    );
    const rect = vi.mocked(SVGSVGElement.prototype.getBoundingClientRect);
    const original = rect.mock.results.at(-1)!.value as DOMRect;
    const query = vi.spyOn(test.svg, 'querySelectorAll');
    const events = [
      () => test.container.dispatchEvent(new Event('scroll')),
      () => window.dispatchEvent(new Event('resize')),
      () => resize([], {} as ResizeObserver),
    ];
    for (const [index, fire] of events.entries()) {
      const left = (index + 1) * 100,
        top = (index + 1) * 40;
      rect.mockReturnValue({ ...original, left, top } as DOMRect);
      await act(async () => fire());
      expect(onViewStateChange.mock.lastCall![0].selectionScreenBounds).toEqual(
        {
          x: left + 10,
          y: top + 10,
          width: 100,
          height: 50,
        },
      );
    }
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 2,
      }),
    );
    const reads = rect.mock.calls.length;
    await frames.paint();
    expect(rect.mock.calls.length).toBe(reads);
    expect(onViewStateChange.mock.lastCall![0].selectionScreenBounds).toEqual({
      x: 320,
      y: 140,
      width: 200,
      height: 100,
    });
    expect(query).not.toHaveBeenCalled();
    rect.mockReturnValue({ ...original, left: 400, top: 160 } as DOMRect);
    await act(async () => test.render());
    expect(onViewStateChange.mock.lastCall![0].selectionScreenBounds).toEqual({
      x: 420,
      y: 180,
      width: 200,
      height: 100,
    });
    expect(query).not.toHaveBeenCalled();
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it('keeps public selection bounds fresh and backfills the camera projection cache', async () => {
    const frames = controlledFrames();
    const onViewStateChange = vi.fn();
    const test = await mount(sample(), { onViewStateChange });
    await act(async () =>
      test.controller.current!.runtime.select({ focus: ['root'], ids: ['a'] }),
    );
    const element =
      test.svg.querySelector<SVGGraphicsElement>('[data-cell-id="a"]')!;
    const world = test.svg.querySelector<SVGGElement>('[data-frame-world]')!;
    const elementMatrix = (element.getScreenCTM = vi.fn(
      () => ({ a: 1, b: 0, c: 0, d: 1, e: 700, f: 300 }) as DOMMatrix,
    ));
    const worldMatrix = (world.getScreenCTM = vi.fn(
      () =>
        ({
          inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        }) as DOMMatrix,
    ));
    const rect = vi.mocked(SVGSVGElement.prototype.getBoundingClientRect);
    rect.mockReturnValue({
      ...rect.mock.results.at(-1)!.value,
      left: 100,
      top: 40,
    } as DOMRect);
    expect(test.controller.current!.selectionScreenBounds()).toEqual({
      x: 810,
      y: 350,
      width: 100,
      height: 50,
    });
    expect(elementMatrix).toHaveBeenCalledTimes(1);
    expect(worldMatrix).toHaveBeenCalledTimes(1);
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 2,
      }),
    );
    // Public queries retain immediate-input semantics while the producer stays painted.
    expect(test.controller.current!.selectionScreenBounds()).toEqual({
      x: 1520,
      y: 660,
      width: 200,
      height: 100,
    });
    await act(async () => window.dispatchEvent(new Event('resize')));
    expect(onViewStateChange.mock.lastCall![0]).toMatchObject({
      zoom: 1,
      selectionScreenBounds: { x: 810, y: 350, width: 100, height: 50 },
    });
    const reads = rect.mock.calls.length;
    await frames.paint();
    expect(onViewStateChange.mock.lastCall![0].selectionScreenBounds).toEqual({
      x: 1520,
      y: 660,
      width: 200,
      height: 100,
    });
    expect(elementMatrix).toHaveBeenCalledTimes(2);
    expect(worldMatrix).toHaveBeenCalledTimes(2);
    expect(rect.mock.calls.length).toBe(reads);
  });
  it('clears selection projection and pending paints when navigating between frames', async () => {
    const frames = controlledFrames();
    const value = sample();
    const nested = createFrameCell('nested');
    nested.children = ['b'];
    (
      value.store.cells.root as ReturnType<typeof createFrameCell>
    ).children.push('nested');
    value.store.cells.nested = nested;
    value.store.cells.b = {
      ...value.store.cells.a,
      id: 'b',
      geometry: { x: 200, y: 50, width: 120, height: 60 },
    };
    const onViewStateChange = vi.fn();
    const test = await mount(value, { onViewStateChange });
    await act(async () =>
      test.controller.current!.runtime.select({ focus: ['root'], ids: ['a'] }),
    );
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 2,
      }),
    );
    await frames.paint();
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 3,
      }),
    );
    expect(frames.callbacks.size).toBe(1);
    onViewStateChange.mockClear();
    await act(async () => test.render('nested'));
    expect(frames.callbacks.size).toBe(0);
    expect(onViewStateChange.mock.lastCall![0]).toMatchObject({
      zoom: 1,
      selectionScreenBounds: null,
    });
    expect(
      onViewStateChange.mock.calls.every(([state]) => state.zoom === 1),
    ).toBe(true);
    await act(async () =>
      test.controller.current!.runtime.select({
        focus: ['nested'],
        ids: ['b'],
      }),
    );
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 4,
      }),
    );
    await frames.paint();
    expect(onViewStateChange.mock.lastCall![0].selectionScreenBounds).toEqual({
      x: 800,
      y: 200,
      width: 480,
      height: 240,
    });
    await act(async () => test.render());
    expect(onViewStateChange.mock.lastCall![0]).toMatchObject({
      zoom: 1,
      selectionScreenBounds: null,
    });
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it('refreshes selection bounds after scale visibility changes without another input', async () => {
    const frames = controlledFrames();
    const onViewStateChange = vi.fn();
    const test = await mount(sample(), {
      onViewStateChange,
      extensions: [{ kind: 'geometry', visible: ({ scale }) => scale < 2 }],
    });
    await act(async () =>
      test.controller.current!.runtime.select({ focus: ['root'], ids: ['a'] }),
    );
    expect(
      onViewStateChange.mock.lastCall![0].selectionScreenBounds,
    ).not.toBeNull();
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 3,
      }),
    );
    await frames.paint();
    expect(test.svg.querySelector('[data-cell-id="a"]')).toBeNull();
    expect(
      onViewStateChange.mock.lastCall![0].selectionScreenBounds,
    ).toBeNull();
    expect(onViewStateChange.mock.lastCall![0].zoom).toBe(3);
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 1,
      }),
    );
    await frames.paint();
    expect(test.svg.querySelector('[data-cell-id="a"]')).not.toBeNull();
    expect(
      onViewStateChange.mock.lastCall![0].selectionScreenBounds,
    ).not.toBeNull();
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it('keeps a painted pan through theme and zoom renders, with the grid aligned', async () => {
    const frames = controlledFrames();
    const test = await mount();
    await act(async () =>
      test.svg.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          deltaX: 40,
          deltaY: 80,
        }),
      ),
    );
    await frames.paint();
    const camera = test.transform();
    const root = test.controller.current!.runtime.store.cells
      .root as ReturnType<typeof createFrameCell>;
    await act(async () =>
      test.controller.current!.dispatch({
        id: 'grid',
        operations: [
          {
            type: 'replace_cell',
            cell: {
              ...root,
              view: { theme: { gridEnabled: true, gridSize: 30 } },
            },
          },
        ],
      }),
    );
    expect(test.transform()).toBe(camera);
    expect(test.svg.style.backgroundPosition).toBe('-40px -80px');
    expect(test.svg.style.backgroundSize).toBe('30px 30px');
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 1.5,
      }),
    );
    await frames.paint();
    expect(test.transform()).toBe('scale(1.5) translate(-40 -80)');
    expect(test.svg.style.backgroundPosition).toBe('-60px -120px');
    expect(test.svg.style.backgroundSize).toBe('45px 45px');
    expect(test.onChange).toHaveBeenCalledTimes(1);
  });
  it('cancels a queued camera when entering another frame', async () => {
    const frames = controlledFrames();
    const value = sample();
    value.store.cells.nested = createFrameCell('nested');
    (
      value.store.cells.root as ReturnType<typeof createFrameCell>
    ).children.push('nested');
    const test = await mount(value);
    await act(async () =>
      test.svg.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          deltaX: 100,
          deltaY: 200,
        }),
      ),
    );
    expect(frames.callbacks.size).toBe(1);
    await act(async () => test.render('nested'));
    expect(frames.callbacks.size).toBe(0);
    await frames.paint();
    expect(test.transform()).toBe('scale(1) translate(0 0)');
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it('starts newly mounted frame extensions with the new frame camera', async () => {
    const frames = controlledFrames();
    const value = sample();
    const nested = createFrameCell('nested');
    nested.children = ['b'];
    (
      value.store.cells.root as ReturnType<typeof createFrameCell>
    ).children.push('nested');
    value.store.cells.nested = nested;
    value.store.cells.b = { ...value.store.cells.a, id: 'b' };
    function InitialScale({ scale }: { scale: number }) {
      const [initialScale] = useState(scale);
      return (
        <rect data-initial-scale={initialScale} data-current-scale={scale} />
      );
    }
    const test = await mount(value, {
      extensions: [
        {
          kind: 'geometry',
          renderShape: ({ scale }) => <InitialScale scale={scale} />,
        },
      ],
    });
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 2,
      }),
    );
    await frames.paint();
    await act(async () => test.render('nested'));
    const shape = test.container.querySelector('[data-initial-scale]')!;
    expect(shape.getAttribute('data-current-scale')).toBe('1');
    expect(shape.getAttribute('data-initial-scale')).toBe('1');
    expect(test.transform()).toBe('scale(1) translate(0 0)');
  });
  it.each(['wheel', 'hand'] as const)(
    'paints %s in the scheduled frame without rendering the scene again',
    async (input) => {
      const frames = controlledFrames();
      const renderShape = vi.fn<
        NonNullable<FrameRenderExtension['renderShape']>
      >(({ geometry }) => <rect {...geometry} />);
      const textBounds = vi.fn<NonNullable<FrameRenderExtension['textBounds']>>(
        ({ geometry }) => geometry!,
      );
      const onViewStateChange = vi.fn();
      const test = await mount(sample(), {
        tool: 'hand',
        extensions: [{ kind: 'geometry', renderShape, textBounds }],
        onViewStateChange,
      });
      await act(async () =>
        test.controller.current!.runtime.select({
          focus: ['root'],
          ids: ['a'],
        }),
      );
      if (input === 'hand') {
        await act(async () => test.fire('pointerdown', 200, 200));
        await frames.paint();
      }
      const renders = renderShape.mock.calls.length;
      const textCalls = textBounds.mock.calls.length;
      const layouts = test.layout.mock.calls.length;
      for (let batch = 1; batch <= 4; batch++) {
        await act(async () => {
          for (let n = 1; n <= 10; n++) {
            if (input === 'wheel')
              test.svg.dispatchEvent(
                new WheelEvent('wheel', {
                  bubbles: true,
                  deltaX: 1,
                  deltaY: 2,
                }),
              );
            else test.fire('pointermove', 200 + (batch - 1) * 10 + n, 220);
          }
        });
        expect(frames.callbacks.size).toBe(1);
        // Read inside rAF, before React can commit any queued state updates.
        let immediate: string | null = null;
        window.requestAnimationFrame(() => {
          immediate = test.transform();
        });
        await frames.paint();
        expect(immediate).toBe(
          input === 'wheel'
            ? `scale(1) translate(${-batch * 10} ${-batch * 20})`
            : `scale(1) translate(${batch * 10} 20)`,
        );
      }
      expect(renderShape).toHaveBeenCalledTimes(renders);
      expect(textBounds).toHaveBeenCalledTimes(textCalls);
      expect(test.layout).toHaveBeenCalledTimes(layouts);
      expect(test.onChange).not.toHaveBeenCalled();
      if (input === 'wheel')
        expect(
          onViewStateChange.mock.lastCall![0].selectionScreenBounds,
        ).toMatchObject({ x: -30, y: -70 });
      else await act(async () => test.fire('pointerup', 240, 220));
      expect(frames.callbacks.size).toBe(0);
    },
  );
  it.each(['ctrlKey', 'metaKey'] as const)(
    'uses faster anchored %s zoom and never pans at a zoom limit',
    async (modifier) => {
      const frames = controlledFrames();
      const test = await mount();
      await act(async () =>
        test.svg.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            [modifier]: true,
            deltaY: -100,
            clientX: 400,
            clientY: 300,
          }),
        ),
      );
      await frames.paint();
      const camera = viewport(test.transform());
      expect(camera.zoom).toBeCloseTo(Math.exp(1));
      expect(camera.origin[0] + 400 / camera.zoom).toBeCloseTo(400);
      expect(camera.origin[1] + 300 / camera.zoom).toBeCloseTo(300);
      for (const [limit, deltaY] of [
        [8, -100],
        [0.1, 100],
      ]) {
        await act(async () =>
          test.controller.current!.executeAction('canvas.view.set-zoom', {
            zoom: limit,
          }),
        );
        await frames.paint();
        const before = test.transform();
        await act(async () =>
          test.svg.dispatchEvent(
            new WheelEvent('wheel', {
              bubbles: true,
              [modifier]: true,
              deltaX: 12,
              deltaY,
            }),
          ),
        );
        await frames.paint();
        expect(test.transform()).toBe(before);
      }
      expect(test.onChange).not.toHaveBeenCalled();
    },
  );
  it('reuses native scene geometry, nested placement and text DOM through zoom bursts', async () => {
    const frames = controlledFrames();
    const shape = vi.spyOn(Core, 'nodeShapeSpec');
    const geometry = vi.spyOn(Core, 'nodeShapeGeometry');
    const placement = vi.spyOn(Core, 'fitFrameContent');
    const value = sample();
    const nested = createFrameCell('nested', {
      x: 200,
      y: 100,
      width: 300,
      height: 200,
    });
    nested.children = ['b'];
    (
      value.store.cells.root as ReturnType<typeof createFrameCell>
    ).children.push('nested');
    value.store.cells.nested = nested;
    value.store.cells.b = {
      ...value.store.cells.a,
      id: 'b',
      content: { label: 'Nested' },
    };
    const onViewStateChange = vi.fn();
    const test = await mount(value, { onViewStateChange });
    await act(async () =>
      test.controller.current!.runtime.select({ focus: ['root'], ids: ['a'] }),
    );
    const text = test.container.querySelector(
      '[data-cell-id="a"] foreignObject',
    );
    const before = [
      shape.mock.calls.length,
      geometry.mock.calls.length,
      placement.mock.calls.length,
      test.layout.mock.calls.length,
    ];
    const runtime = test.controller.current!.runtime,
      store = runtime.store,
      revision = runtime.revision;
    let expected = 1;
    for (let batch = 0; batch < 6; batch++) {
      await act(async () => {
        for (let n = 0; n < 10; n++) {
          test.svg.dispatchEvent(
            new WheelEvent('wheel', {
              bubbles: true,
              ctrlKey: true,
              deltaY: -1,
              clientX: 400,
              clientY: 300,
            }),
          );
          expected *= Math.exp(0.01);
        }
      });
      expect(frames.callbacks.size).toBe(1);
      await frames.paint();
      const camera = viewport(test.transform());
      expect(camera.zoom).toBeCloseTo(expected);
      expect(camera.origin[0] + 400 / camera.zoom).toBeCloseTo(400);
      expect(onViewStateChange.mock.lastCall![0].zoom).toBeCloseTo(expected);
      expect(
        Number(
          test.container
            .querySelector('[data-handle-cell="a"]')!
            .getAttribute('width'),
        ),
      ).toBeCloseTo(8 / expected);
      expect(
        test.container.querySelector('[data-cell-id="a"] foreignObject'),
      ).toBe(text);
    }
    expect([
      shape.mock.calls.length,
      geometry.mock.calls.length,
      placement.mock.calls.length,
      test.layout.mock.calls.length,
    ]).toEqual(before);
    expect(runtime.store).toBe(store);
    expect(runtime.revision).toBe(revision);
    expect(runtime.history.undos).toHaveLength(0);
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it('updates every extension scale callback without rebuilding native geometry', async () => {
    const frames = controlledFrames();
    const shape = vi.spyOn(Core, 'nodeShapeSpec');
    const render = vi.fn<NonNullable<FrameRenderExtension['render']>>(
      () => null,
    );
    const renderShape = vi.fn<NonNullable<FrameRenderExtension['renderShape']>>(
      ({ scale, geometry }) => (
        <rect {...geometry} data-extension-scale={scale} />
      ),
    );
    const textBounds = vi.fn<NonNullable<FrameRenderExtension['textBounds']>>(
      ({ scale, geometry }) => ({
        ...geometry!,
        width: geometry!.width * scale,
      }),
    );
    const presentation = vi.fn<
      NonNullable<FrameRenderExtension['presentation']>
    >(({ scale }) => ({
      fill: scale >= 2 ? '#ff0000' : '#ffffff',
      color: scale >= 2 ? '#0000ff' : '#000000',
    }));
    const renderControls = vi.fn<
      NonNullable<FrameRenderExtension['renderControls']>
    >(({ scale }) => <circle data-extension-control r={5 / scale} />);
    const visible = vi.fn<NonNullable<FrameRenderExtension['visible']>>(
      ({ scale }) => scale < 3,
    );
    const test = await mount(sample(), {
      extensions: [
        {
          kind: 'geometry',
          render,
          renderShape,
          textBounds,
          presentation,
          renderControls,
          visible,
        },
      ],
    });
    const shapes = shape.mock.calls.length;
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 2,
      }),
    );
    // Unpublished input must not leak into the React scene before its frame.
    expect(renderShape.mock.lastCall![0].scale).toBe(1);
    await frames.paint();
    for (const callback of [
      render,
      renderShape,
      textBounds,
      presentation,
      renderControls,
      visible,
    ])
      expect(callback.mock.lastCall![0].scale).toBe(2);
    const node = test.container.querySelector('[data-cell-id="a"]')!;
    expect(node.getAttribute('fill')).toBe('#ff0000');
    expect(node.querySelector('foreignObject')!.getAttribute('width')).toBe(
      '184',
    );
    expect(
      test.container
        .querySelector('[data-extension-control]')!
        .getAttribute('r'),
    ).toBe('2.5');
    expect(shape).toHaveBeenCalledTimes(shapes);
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 3,
      }),
    );
    await frames.paint();
    expect(test.container.querySelector('[data-cell-id="a"]')).toBeNull();
    expect(test.container.querySelector('[data-extension-control]')).toBeNull();
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 1,
      }),
    );
    await frames.paint();
    expect(
      test.container
        .querySelector('[data-extension-scale]')!
        .getAttribute('data-extension-scale'),
    ).toBe('1');
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'reuses unrelated geometry outlines during a node drag only with an explicit cache key (cached=%s)',
    async (cached) => {
      const frames = controlledFrames();
      const value = sample();
      (value.store.cells.root as Core.FrameCell).children.push('b');
      value.store.cells.b = {
        ...value.store.cells.a,
        id: 'b',
        geometry: { x: 200, y: 10, width: 100, height: 50 },
      } as Core.NodeCell;
      const renderShape = vi.fn<
        NonNullable<FrameRenderExtension['renderShape']>
      >(({ cell, geometry, selected }) => (
        <rect
          x={geometry?.x}
          y={geometry?.y}
          width={geometry?.width}
          height={geometry?.height}
          data-cached-outline={cell.id}
          data-outline-selected={String(selected)}
        />
      ));
      const test = await mount(value, {
        extensions: [
          {
            kind: 'geometry',
            renderShape,
            ...(cached
              ? {
                  renderShapeCacheKey: ({
                    cell,
                    geometry,
                    selected,
                  }: Parameters<
                    NonNullable<FrameRenderExtension['renderShape']>
                  >[0]) => [cell, geometry, selected],
                }
              : {}),
          },
        ],
      });
      const otherRenders = () =>
        renderShape.mock.calls.filter(([context]) => context.cell.id === 'b')
          .length;
      const initial = otherRenders();
      const a = test.svg.querySelector('[data-cell-id="a"]')!;
      await act(async () => test.fire('pointerdown', 40, 30, 0, 1, a));
      for (const x of [60, 80, 100]) {
        await act(async () => test.fire('pointermove', x, 30));
        await frames.paint();
      }
      await act(async () => test.fire('pointerup', 100, 30));
      if (cached) expect(otherRenders()).toBe(initial);
      else expect(otherRenders()).toBeGreaterThan(initial);
      expect(test.controller.current!.runtime.store.cells.a).toMatchObject({
        geometry: { x: 70, y: 10 },
      });
      await act(async () =>
        test.controller.current!.runtime.select({
          focus: ['root'],
          ids: ['b'],
        }),
      );
      expect(
        test.svg
          .querySelector('[data-cached-outline="b"]')!
          .getAttribute('data-outline-selected'),
      ).toBe('true');
      expect(otherRenders()).toBeGreaterThan(initial);
    },
  );
  it('refreshes cached shape content, geometry, native hit events and camera subscriptions', async () => {
    const frames = controlledFrames();
    const renderShape = vi.fn<NonNullable<FrameRenderExtension['renderShape']>>(
      ({ cell, geometry, scale, hovered }) => (
        <rect
          x={geometry?.x}
          y={geometry?.y}
          width={geometry?.width}
          height={geometry?.height}
          data-cached-scale={scale}
          data-cached-hover={String(hovered)}
          data-cached-label={(cell as Core.NodeCell).content?.label}
        />
      ),
    );
    const test = await mount(sample(), {
      extensions: [
        {
          kind: 'geometry',
          renderShape,
          renderShapeCacheKey: ({
            cell,
            geometry,
            selected,
            scale,
            hovered,
          }) => [cell, geometry, selected, scale, hovered],
        },
      ],
    });
    const node = test.svg.querySelector('[data-cell-id="a"]')!;
    await act(async () =>
      node.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })),
    );
    expect(
      test.svg
        .querySelector('[data-cached-hover]')!
        .getAttribute('data-cached-hover'),
    ).toBe('true');
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 2,
      }),
    );
    await frames.paint();
    expect(
      test.svg
        .querySelector('[data-cached-scale]')!
        .getAttribute('data-cached-scale'),
    ).toBe('2');
    await act(async () => {
      const cell = test.controller.current!.runtime.store.cells
        .a as Core.NodeCell;
      await test.controller.current!.dispatch({
        id: 'update-shape',
        operations: [
          {
            type: 'replace_cell',
            cell: {
              ...cell,
              content: { label: 'Latest' },
              geometry: { ...cell.geometry, x: 120, width: 150 },
            },
          },
        ],
      });
    });
    const shape = test.svg.querySelector('[data-cached-label]')!;
    expect(shape.getAttribute('data-cached-label')).toBe('Latest');
    expect(shape.getAttribute('x')).toBe('120');
    expect(shape.getAttribute('width')).toBe('150');
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 1,
      }),
    );
    await frames.paint();
    await act(async () => test.fire('pointerdown', 140, 30, 0, 1, node));
    await act(async () => test.fire('pointermove', 160, 30));
    await act(async () => test.fire('pointerup', 160, 30));
    expect(test.controller.current!.runtime.store.cells.a).toMatchObject({
      geometry: { x: 140, width: 150 },
    });
  });
  it('keeps native edge hit strokes fixed across zoom and nested frame transforms', async () => {
    const frames = controlledFrames();
    const value = sample();
    const outer = createFrameCell('outer', {
      x: 200,
      y: 100,
      width: 200,
      height: 120,
    });
    const inner = createFrameCell('inner', {
      x: 20,
      y: 30,
      width: 400,
      height: 300,
    });
    const edge: Core.EdgeCell = {
      id: 'edge',
      cellType: 'edge',
      kind: 'arrow',
      source: { point: [50, 100] },
      target: { point: [250, 100] },
      route: { mode: 'straight' },
      appearance: { strokeWidth: 3, strokeStyle: 'dashed' },
    };
    outer.children = ['inner'];
    inner.children = ['deep', 'deep-edge'];
    (
      value.store.cells.root as ReturnType<typeof createFrameCell>
    ).children.push('edge', 'outer');
    Object.assign(value.store.cells, {
      edge,
      outer,
      inner,
      deep: {
        ...value.store.cells.a,
        id: 'deep',
        geometry: { x: 10, y: 20, width: 1000, height: 800 },
      },
      'deep-edge': { ...edge, id: 'deep-edge' },
    });
    const outerPlacement = Core.fitFrameContent(
      outer,
      Core.frameContentBounds(value.store, 'outer'),
    );
    const innerPlacement = Core.fitFrameContent(
      inner,
      Core.frameContentBounds(value.store, 'inner'),
    );
    const nestedScale = outerPlacement.scale * innerPlacement.scale;
    expect(outerPlacement.scale).toBeLessThan(1);
    expect(innerPlacement.scale).toBeLessThan(1);
    const test = await mount(value);
    const nestedHit = test.svg.querySelector('[data-edge-hit="deep-edge"]')!;
    await act(async () =>
      nestedHit.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          button: 0,
          buttons: 1,
        }),
      ),
    );
    expect(test.controller.current!.runtime.selection).toMatchObject({
      focus: ['root', 'outer', 'inner'],
      ids: ['deep-edge'],
    });
    const hits = ['edge', 'deep-edge'].map((id) =>
      test.svg.querySelector(`[data-edge-hit="${id}"]`)!,
    );
    const setAttribute = vi.spyOn(SVGElement.prototype, 'setAttribute');
    for (const zoom of [0.1, 2, 8, 0.75]) {
      await act(async () =>
        test.controller.current!.executeAction('canvas.view.set-zoom', {
          zoom: zoom,
        }),
      );
      await frames.paint();
      for (const [index, id] of ['edge', 'deep-edge'].entries()) {
        const hit = test.svg.querySelector(`[data-edge-hit="${id}"]`)!;
        expect(hit).toBe(hits[index]);
        expect(hit.getAttribute('stroke-width')).toBe('12');
        expect(hit.getAttribute('vector-effect')).toBe('non-scaling-stroke');
        expect(hit.getAttribute('stroke')).toBe('transparent');
        const visible = test.svg.querySelector(`[data-edge-display="${id}"]`)!;
        expect(visible.getAttribute('stroke-width')).toBe('3');
        expect(visible.getAttribute('stroke-dasharray')).toBe('8 4');
        expect(visible.getAttribute('vector-effect')).toBeNull();
      }
      const highlight = test.svg.querySelector(
        '[data-cell-id="deep-edge"] [data-interaction-stroke="selected"]',
      )!;
      expect(highlight.getAttribute('stroke-width')).toBe('4');
      expect(highlight.getAttribute('vector-effect')).toBeNull();
      const filter = test.svg.querySelector(
        `[id="${highlight.getAttribute('filter')!.slice(5, -1)}"]`,
      )!;
      expect(
        Number(
          filter.querySelector('feGaussianBlur')!.getAttribute('stdDeviation'),
        ) *
          zoom *
          nestedScale,
      ).toBeCloseTo(2.25);
      expect(
        Number(
          test.svg
            .querySelector(
              '[data-edge-controls="deep-edge"] [data-edge-endpoint="source"]',
            )!
            .getAttribute('r'),
        ),
      ).toBeCloseTo(6 / Math.max(0.02, zoom * nestedScale));
    }
    expect(
      setAttribute.mock.instances.filter((element) => hits.includes(element)),
    ).toHaveLength(0);
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it('publishes the full nested scale to extensions and selection handles', async () => {
    const frames = controlledFrames();
    const value = sample();
    const outer = createFrameCell('outer', {
      x: 200,
      y: 100,
      width: 200,
      height: 120,
    });
    const inner = createFrameCell('inner', {
      x: 20,
      y: 30,
      width: 400,
      height: 300,
    });
    outer.children = ['inner'];
    inner.children = ['deep'];
    (
      value.store.cells.root as ReturnType<typeof createFrameCell>
    ).children.push('outer');
    Object.assign(value.store.cells, {
      outer,
      inner,
      deep: {
        ...value.store.cells.a,
        id: 'deep',
        geometry: { x: 10, y: 20, width: 1000, height: 800 },
      },
    });
    const outerPlacement = Core.fitFrameContent(
      outer,
      Core.frameContentBounds(value.store, 'outer'),
    );
    const innerPlacement = Core.fitFrameContent(
      inner,
      Core.frameContentBounds(value.store, 'inner'),
    );
    const nestedScale = outerPlacement.scale * innerPlacement.scale;
    expect(outerPlacement.scale).toBeLessThan(1);
    expect(innerPlacement.scale).toBeLessThan(1);
    const renderShape = vi.fn<NonNullable<FrameRenderExtension['renderShape']>>(
      ({ cell, geometry, scale }) => (
        <rect
          {...geometry}
          data-nested-scale={cell.id === 'deep' ? scale : undefined}
        />
      ),
    );
    const textBounds = vi.fn<NonNullable<FrameRenderExtension['textBounds']>>(
      ({ geometry, scale }) => ({
        ...geometry!,
        width: geometry!.width + scale,
      }),
    );
    const visible = vi.fn<NonNullable<FrameRenderExtension['visible']>>(
      () => true,
    );
    const test = await mount(value, {
      extensions: [{ kind: 'geometry', renderShape, textBounds, visible }],
    });
    await act(async () =>
      test.controller.current!.runtime.select({
        focus: ['root', 'outer', 'inner'],
        ids: ['deep'],
      }),
    );
    for (const zoom of [2, 4, 0.75]) {
      await act(async () =>
        test.controller.current!.executeAction('canvas.view.set-zoom', {
          zoom: zoom,
        }),
      );
      await frames.paint();
      const scale = zoom * nestedScale;
      expect(
        Number(
          test.container
            .querySelector('[data-nested-scale]')!
            .getAttribute('data-nested-scale'),
        ),
      ).toBeCloseTo(scale);
      for (const callback of [textBounds, visible]) {
        const call = callback.mock.calls
          .filter(([context]) => context.cell.id === 'deep')
          .at(-1)!;
        expect(call[0].scale).toBeCloseTo(scale);
      }
      expect(
        Number(
          test.container
            .querySelector('[data-handle-cell="deep"]')!
            .getAttribute('width'),
        ),
      ).toBeCloseTo(8 / scale);
    }
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it('preserves the active text editor and selection when scale-sensitive appearance changes', async () => {
    const frames = controlledFrames();
    const value = sample();
    value.store.cells.a = {
      ...value.store.cells.a,
      content: {
        label: 'Keep my selection',
        text: createInlineText('Keep my selection'),
      },
    };
    const test = await mount(value, {
      extensions: [
        {
          kind: 'geometry',
          textBounds: ({ geometry, scale }) => ({
            ...geometry!,
            width: geometry!.width * scale,
          }),
          presentation: ({ scale }) => ({
            color: scale >= 2 ? '#ff0000' : '#000000',
          }),
        },
      ],
    });
    await act(async () =>
      test.controller.current!.executeAction('canvas.selection.edit', {
        cellId: 'a',
      }),
    );
    const editor = test.container.querySelector<HTMLElement>(
      '[data-frame-text-editor] [contenteditable="true"]',
    )!;
    expect(editor).not.toBeNull();
    const shell = editor.closest('[data-frame-text-editor]');
    const text = editor.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 7);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    for (const zoom of [1.5, 2, 0.8]) {
      await act(async () =>
        test.controller.current!.executeAction('canvas.view.set-zoom', {
          zoom: zoom,
        }),
      );
      await frames.paint();
      expect(test.container.querySelector('[data-frame-text-editor]')).toBe(
        shell,
      );
      expect(
        test.container.querySelector(
          '[data-frame-text-editor] [contenteditable="true"]',
        ),
      ).toBe(editor);
      expect(editor.textContent).toBe('Keep my selection');
      expect(selection.anchorNode).toBe(text);
      expect(selection.anchorOffset).toBe(2);
      expect(selection.focusNode).toBe(text);
      expect(selection.focusOffset).toBe(7);
    }
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it('reuses label previews across zoom and keeps cached scene events current', async () => {
    const frames = controlledFrames();
    const first = vi.fn(),
      latest = vi.fn();
    const options = { onSelectionChange: first };
    const test = await mount(sample(), options);
    const createElement = vi.spyOn(document, 'createElement');
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 2,
      }),
    );
    await frames.paint();
    expect(
      createElement.mock.calls.filter(([tag]) => tag === 'div'),
    ).toHaveLength(0);
    options.onSelectionChange = latest;
    await act(async () => test.render());
    const node = test.container.querySelector('[data-cell-id="a"]')!;
    await act(async () =>
      node.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: 50,
          clientY: 40,
        }),
      ),
    );
    expect(latest).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
    await act(async () =>
      test.controller.current!.dispatch({
        id: 'rename',
        operations: [
          {
            type: 'replace_cell',
            cell: {
              ...test.controller.current!.runtime.store.cells.a,
              content: { label: 'Changed' },
            },
          },
        ],
      }),
    );
    expect(
      test.container.querySelector('[data-frame-rich-text]')!.textContent,
    ).toBe('Changed');
    expect(createElement.mock.calls.some(([tag]) => tag === 'div')).toBe(true);
  });
  it.each([false, true])(
    'accumulates wheel bursts and never publishes a document (host=%s)',
    async (host) => {
      const test = await mount(sample(), { host });
      const runtime = test.controller.current!.runtime,
        store = runtime.store,
        revision = runtime.revision,
        layouts = test.layout.mock.calls.length;
      await act(async () => {
        for (let i = 0; i < 100; i++)
          test.svg.dispatchEvent(
            new WheelEvent('wheel', { bubbles: true, deltaX: 1, deltaY: 2 }),
          );
      });
      await test.paint();
      expect(test.transform()).toBe('scale(1) translate(-100 -200)');
      expect(runtime.store).toBe(store);
      expect(runtime.revision).toBe(revision);
      expect(runtime.history.undos).toHaveLength(0);
      expect(test.onChange).not.toHaveBeenCalled();
      expect(test.onIntent).not.toHaveBeenCalled();
      expect(test.layout).toHaveBeenCalledTimes(layouts);
    },
  );
  it('keeps pan and zoom outside editing history, including fit and cancellation', async () => {
    const test = await mount(sample(), { tool: 'hand' });
    const runtime = test.controller.current!.runtime,
      revision = runtime.revision;
    await act(async () => {
      test.fire('pointerdown', 100, 100);
      for (let i = 0; i < 100; i++) test.fire('pointermove', 101 + i, 120);
      test.fire('pointerup', 200, 120);
    });
    expect(test.transform()).toBe('scale(1) translate(100 20)');
    expect(runtime.revision).toBe(revision);
    expect(test.onChange).not.toHaveBeenCalled();
    await act(async () =>
      test.controller.current!.dispatch({
        id: 'edit',
        operations: [
          {
            type: 'replace_cell',
            cell: { ...runtime.store.cells.a, content: { label: 'Edited' } },
          },
        ],
      }),
    );
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 2,
      }),
    );
    await test.paint();
    const camera = test.transform();
    await act(async () =>
      test.controller.current!.executeAction('canvas.history.undo'),
    );
    expect(runtime.store.cells.a).toMatchObject({ content: { label: 'Node' } });
    expect(test.transform()).toBe(camera);
    const changes = test.onChange.mock.calls.length,
      documentRevision = runtime.revision;
    await act(async () =>
      test.controller.current!.executeAction('canvas.view.fit'),
    );
    expect(test.transform()).toContain('scale(1)');
    expect(test.onChange).toHaveBeenCalledTimes(changes);
    expect(runtime.revision).toBe(documentRevision);
  });
  it('starts a pan from the latest camera even before its scheduled frame paints', async () => {
    const test = await mount(sample(), { tool: 'hand' });
    await act(async () => {
      test.controller.current!.executeAction('canvas.view.set-zoom', {
        zoom: 2,
      });
      test.fire('pointerdown', 100, 100);
      test.fire('pointermove', 200, 100);
      test.fire('pointerup', 200, 100);
    });
    expect(test.transform()).toBe('scale(2) translate(50 0)');
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it('ignores legacy cameras and fits the returning frame shell once', async () => {
    const value = sample(),
      frame = createFrameCell('nested', {
        x: 700,
        y: 800,
        width: 200,
        height: 100,
      });
    value.store.cells.nested = frame;
    (
      value.store.cells.root as ReturnType<typeof createFrameCell>
    ).children.push('nested');
    Object.assign(value.store.cells.root, {
      view: { viewport: { zoom: 7, origination: [900, 900] } },
    });
    const test = await mount(value, { autoFit: true });
    expect(test.transform()).not.toContain('scale(7)');
    await act(async () => test.render('nested'));
    await act(async () => test.render('root', 'nested'));
    expect(test.transform()).toBe('scale(1) translate(-400 -550)');
    expect(test.onChange).not.toHaveBeenCalled();
    const camera = test.transform();
    await act(async () =>
      test.controller.current!.dispatch({
        id: 'edit',
        operations: [
          {
            type: 'replace_cell',
            cell: { ...value.store.cells.a, content: { label: 'Changed' } },
          },
        ],
      }),
    );
    expect(test.transform()).toBe(camera);
  });
  it.each([false, true])(
    'draws a rectangular marquee in either drag direction (reverse=%s)',
    async (reverse) => {
      const test = await mount();
      const start = reverse ? [130, 80] : [0, 0],
        end = reverse ? [0, 0] : [130, 80];
      await act(async () => {
        test.fire('pointerdown', start[0], start[1]);
        test.fire('pointermove', end[0], end[1]);
      });
      await test.paint();
      const rect = test.container.querySelector('[data-selection-marquee]')!;
      expect(rect.tagName).toBe('rect');
      expect(rect.getAttribute('x')).toBe('0');
      expect(rect.getAttribute('width')).toBe('130');
      expect(rect.getAttribute('height')).toBe('80');
      await act(async () => test.fire('pointerup', end[0], end[1]));
      expect(test.controller.current!.runtime.selection.ids).toEqual(['a']);
      expect(
        test.container.querySelector('[data-selection-marquee]'),
      ).toBeNull();
      await act(async () => {
        test.fire('pointerdown', 0, 0);
        test.fire('pointermove', 200, 100);
        test.svg.dispatchEvent(new Event('pointercancel', { bubbles: true }));
      });
      expect(
        test.container.querySelector('[data-selection-marquee]'),
      ).toBeNull();
      expect(test.onChange).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])(
    'applies live zoom multipliers without document or host intents (host=%s)',
    async (host) => {
      const frames = controlledFrames();
      const options = {
        host,
        interactionSettings: { zoomSensitivity: 0.5, dragPanSpeed: 2 },
      };
      const test = await mount(sample(), options);
      const wheel = (modified: boolean) =>
        test.svg.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            ctrlKey: modified,
            deltaX: 10,
            deltaY: -20,
            clientX: 400,
            clientY: 300,
          }),
        );
      await act(async () => wheel(true));
      await frames.paint();
      let camera = viewport(test.transform());
      expect(camera.zoom).toBeCloseTo(Math.exp(0.1));
      expect(camera.origin[0] + 400 / camera.zoom).toBeCloseTo(400);
      expect(camera.origin[1] + 300 / camera.zoom).toBeCloseTo(300);
      options.interactionSettings.zoomSensitivity = 2;
      await act(async () => test.render());
      await act(async () => wheel(true));
      await frames.paint();
      camera = viewport(test.transform());
      expect(camera.zoom).toBeCloseTo(Math.exp(0.5));
      const before = camera;
      await act(async () => wheel(false));
      await frames.paint();
      camera = viewport(test.transform());
      expect(camera.origin[0] - before.origin[0]).toBeCloseTo(10 / before.zoom);
      expect(camera.origin[1] - before.origin[1]).toBeCloseTo(
        -20 / before.zoom,
      );
      expect(test.onChange).not.toHaveBeenCalled();
      expect(test.onIntent).not.toHaveBeenCalled();
    },
  );
  it.each(['hand', 'space', 'middle', 'right'] as const)(
    'scales %s canvas dragging and keeps its multiplier stable during a gesture',
    async (mode) => {
      const frames = controlledFrames();
      const options = {
        tool: mode === 'hand' ? ('hand' as const) : ('select' as const),
        interactionSettings: { dragPanSpeed: 2 },
      };
      const test = await mount(sample(), options);
      if (mode === 'space')
        await act(async () =>
          test.svg.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: ' ',
              code: 'Space',
              bubbles: true,
            }),
          ),
        );
      const button = mode === 'middle' ? 1 : mode === 'right' ? 2 : 0;
      await act(async () => {
        test.fire('pointerdown', 200, 200, button);
        if (mode === 'right') test.fire('pointermove', 210, 200, button);
      });
      await frames.paint();
      options.interactionSettings = { dragPanSpeed: 0.5 };
      await act(async () => test.render());
      await act(async () =>
        test.fire('pointermove', mode === 'right' ? 230 : 220, 210, button),
      );
      await frames.paint();
      expect(viewport(test.transform()).origin).toEqual([-40, -20]);
      await act(async () =>
        test.fire('pointerup', mode === 'right' ? 230 : 220, 210, button),
      );
      await act(async () => {
        test.fire('pointerdown', 300, 300, button);
        if (mode === 'right') test.fire('pointermove', 310, 300, button);
        test.fire('pointermove', mode === 'right' ? 330 : 320, 320, button);
      });
      await frames.paint();
      expect(viewport(test.transform()).origin).toEqual([-50, -30]);
      await act(async () => test.fire('pointerup', 330, 320, button));
      if (mode === 'space')
        window.dispatchEvent(
          new KeyboardEvent('keyup', { key: ' ', code: 'Space' }),
        );
      expect(test.onChange).not.toHaveBeenCalled();
    },
  );
});

describe('interactive ports and display paths', () => {
  it('locally reveals ports and clips both edge ends without rebuilding nodes or editing the route', async () => {
    const value = sample();
    const a = value.store.cells.a as Core.NodeCell;
    a.ports = [{ id: 'right', side: 'right', direction: 'both' }];
    value.store.cells.b = {
      ...a,
      id: 'b',
      geometry: { ...a.geometry, x: 240 },
      ports: [{ id: 'left', side: 'left', direction: 'both' }],
    };
    value.store.cells.e = {
      id: 'e',
      kind: 'arrow',
      cellType: 'edge',
      source: { cellId: 'a', portId: 'right' },
      target: { cellId: 'b', portId: 'left' },
      route: { mode: 'straight' },
      appearance: { strokeWidth: 8 },
      data: { sourceMarker: 'arrow', targetMarker: 'arrow' },
    };
    (value.store.cells.root as Core.FrameCell).children.push('b', 'e');
    const shape = vi.spyOn(Core, 'nodeShapeSpec');
    const test = await mount(value);
    const path = () =>
      test.svg.querySelector('[data-cell-id="e"] path')!.getAttribute('d');
    const canonical = path(),
      count = shape.mock.calls.length,
      layouts = test.layout.mock.calls.length;
    expect(test.svg.querySelector('[data-port-id]')).toBeNull();
    await act(async () =>
      test.svg
        .querySelector('[data-cell-id="a"]')!
        .dispatchEvent(new MouseEvent('pointerover', { bubbles: true })),
    );
    expect(
      test.svg.querySelector('[data-cell-id="a"] [data-port-id]'),
    ).not.toBeNull();
    expect(path()).not.toBe(canonical);
    await act(async () => {
      test.controller.current!.runtime.select({
        focus: ['root'],
        ids: ['a', 'b'],
      });
    });
    const ends = [...path()!.matchAll(/[-\d.]+/g)].map((m) => Number(m[0]));
    expect(ends[0]).toBeCloseTo(119.75, 6);
    expect(ends.at(-2)).toBeCloseTo(230.25, 6);
    expect(
      (test.controller.current!.runtime.store.cells.e as Core.EdgeCell).route,
    ).toEqual({ mode: 'straight' });
    // Selection can rebuild its handles; hover alone must leave all scene geometry cached.
    expect(shape.mock.calls.length).toBe(count);
    expect(test.layout.mock.calls.length).toBe(layouts);
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    'hides ports on readonly=%s and locked nodes',
    async (readonly) => {
      const value = sample();
      const a = value.store.cells.a as Core.NodeCell;
      a.ports = [{ id: 'right', side: 'right', direction: 'both' }];
      a.locked = !readonly;
      const test = await mount(value, { readonly });
      await act(async () =>
        test.svg
          .querySelector('[data-cell-id="a"]')!
          .dispatchEvent(new MouseEvent('pointerover', { bubbles: true })),
      );
      expect(test.svg.querySelector('[data-port-id]')).toBeNull();
    },
  );
});

describe('asynchronous target reveal', () => {
  it('waits for layout, keeps content/history unchanged and only applies the latest request', async () => {
    const value = sample(),
      before = JSON.stringify(value);
    const test = await mount(value, { readonly: true });
    let first!: ReturnType<FrameCanvasController['revealTarget']>,
      second!: typeof first;
    await act(async () => {
      first = test.controller.current!.revealTarget({
        cellId: 'a',
        requestId: 1,
      });
      second = test.controller.current!.revealTarget({
        cellId: 'a',
        requestId: 2,
      });
    });
    expect(await first).toMatchObject({ status: 'cancelled' });
    expect(await second).toEqual({ status: 'revealed', cellId: 'a' });
    expect(test.controller.current!.runtime.selection.ids).toEqual(['a']);
    expect(
      test.container.querySelector('[data-reveal-highlight="a"]'),
    ).toBeTruthy();
    expect(JSON.stringify(value)).toBe(before);
    expect(test.onChange).not.toHaveBeenCalled();
    expect(test.controller.current!.runtime.history.undos).toHaveLength(0);
    const abort = new AbortController();
    abort.abort();
    let cancelled!: typeof first;
    await act(async () => {
      cancelled = test.controller.current!.revealTarget({
        cellId: 'a',
        requestId: 3,
        signal: abort.signal,
      });
    });
    expect(await cancelled).toMatchObject({ status: 'cancelled' });
    await act(async () => test.controller.current!.clearRevealOverrides());
    expect(test.container.querySelector('[data-reveal-highlight]')).toBeNull();
  });
  it('locates a group containing only a path and reports hidden and missing targets explicitly', async () => {
    const value = sample();
    value.store.cells.root = {
      ...(value.store.cells.root as Core.FrameCell),
      children: ['a', 'edge', 'edge2'],
      groups: ['paths'],
    };
    value.store.cells.edge = {
      id: 'edge',
      kind: 'arrow',
      cellType: 'edge',
      source: { point: [1500, 900] },
      target: { point: [1800, 1200] },
      route: { mode: 'straight' },
    };
    value.store.cells.edge2 = { ...value.store.cells.edge, id: 'edge2' };
    value.store.cells.paths = {
      id: 'paths',
      kind: 'group',
      cellType: 'group',
      members: ['edge', 'edge2'],
    };
    value.store.cells.a = { ...value.store.cells.a, hidden: true };
    const test = await mount(value);
    let reveal!: ReturnType<FrameCanvasController['revealTarget']>;
    await act(async () => {
      reveal = test.controller.current!.revealTarget({
        cellId: 'paths',
        requestId: 1,
      });
    });
    expect(await reveal).toEqual({ status: 'revealed', cellId: 'paths' });
    expect(test.controller.current!.runtime.selection.ids).toEqual(['paths']);
    expect(viewport(test.transform()).zoom).toBeLessThanOrEqual(1);
    await expect(
      test.controller.current!.revealTarget({ cellId: 'a', requestId: 2 }),
    ).resolves.toEqual({ status: 'unavailable', code: 'hidden' });
    await expect(
      test.controller.current!.revealTarget({ cellId: 'gone', requestId: 3 }),
    ).resolves.toEqual({ status: 'unavailable', code: 'missing-cell' });
  });
});
