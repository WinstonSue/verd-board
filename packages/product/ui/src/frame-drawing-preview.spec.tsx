import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCellRegistry,
  applyCellOperations,
  createCellStore,
  createFrameCell,
  createDefaultShapeGeometryRegistry,
  isNodeCell,
  isEdgeCell,
  edgePolyline,
  flattenCurve,
  moveEdgeRoutePoint,
  type FrameSnapshot,
  type NodeCell,
  type FrameCell,
  type Point,
  type CellTransaction,
} from '@sue/board-core';
import * as Draw from '@sue/board-draw';
import {
  FrameCanvas,
  type FrameCanvasController,
  type FrameCanvasTool,
  type FrameIntentResult,
} from '@sue/board-react';
import { createMindFrameExtensions } from '@sue/board-react-mind';
import { createWorkflowFrameExtensions } from '@sue/board-react-workflow';
import { createArchitectureFrameExtensions } from '@sue/board-react-architecture';
import { cloneFrameImageSvg } from '../../../react/board/src/frame-export';
import { frameDrawExtensions } from './frame-draw-extension';
import { createFrameDrawingTool } from './frame-drawing-tool';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});
const tool = (
  pointer: string,
  shape = 'rectangle',
  pen: Draw.FreehandCellData['shape'] = 'feltTipPen',
) => createFrameDrawingTool({ pointer, shape, pen });
const empty = (): FrameSnapshot => ({
  store: createCellStore(createFrameCell('root')),
});
const mount = async (
  initialTool = tool('shape'),
  value = empty(),
  host = false,
) => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id);
  });
  vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 1000,
    height: 700,
    right: 1000,
    bottom: 700,
    toJSON() {},
  } as DOMRect);
  const registry = createCellRegistry();
  Draw.registerDrawCells(registry);
  const layout = vi.fn(() => new Map());
  const extensions = [
    ...createMindFrameExtensions(registry),
    ...createWorkflowFrameExtensions(registry),
    ...createArchitectureFrameExtensions(registry),
    ...frameDrawExtensions,
    { layout },
  ];
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container),
    controller = createRef<FrameCanvasController>();
  const onChange = vi.fn(),
    onIntent = vi.fn(
      async (_transaction: CellTransaction): Promise<FrameIntentResult> => ({
        status: 'rejected' as const,
        message: 'Host denied',
      }),
    );
  const adapter = { toFrameSnapshot: (value: FrameSnapshot) => value };
  let currentValue = value;
  const render = (
    drawing: FrameCanvasTool = initialTool,
    frameId = 'root',
    readonly = false,
  ) =>
    root.render(
      <FrameCanvas
        ref={controller}
        value={currentValue}
        frameId={frameId}
        registry={registry}
        extensions={extensions}
        autoFit={false}
        tool={drawing}
        readonly={readonly}
        {...(host ? { adapter, onIntent } : { onChange })}
      />,
    );
  await act(async () => render());
  const svg = container.querySelector('svg')!;
  svg.setPointerCapture = vi.fn();
  svg.hasPointerCapture = () => false;
  const fire = (
    type: string,
    point: Point,
    target: Element = svg,
    pointerId = 1,
  ) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      button: 0,
      clientX: point[0],
      clientY: point[1],
    });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    target.dispatchEvent(event);
  };
  const paint = async () =>
    act(async () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(0));
    });
  const start = async (first: Point = [300, 150], last: Point = [500, 270]) => {
    await act(async () => {
      fire('pointerdown', first);
      fire('pointermove', last);
    });
    await paint();
  };
  const key = async (key: string) =>
    act(async () => {
      svg.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return {
    container,
    svg,
    controller,
    onChange,
    onIntent,
    layout,
    render,
    fire,
    paint,
    start,
    key,
    frames,
    echo: async (next: FrameSnapshot) => {
      currentValue = next;
      await act(async () => render());
    },
  };
};
const paths = (element: Element) =>
  [...element.querySelectorAll('path')]
    .filter(
      (path) =>
        !path.closest(
          '[data-selection-handles], [data-vector-controls], [data-edge-hit], [data-vector-hit], [data-port-id]',
        ),
    )
    .map((path) => ({
      d: path.getAttribute('d'),
      fill: path.getAttribute('fill'),
      // Activation changes the edge selection color, not its formal contour.
      stroke:
        path.getAttribute('stroke') === '#6366f1'
          ? '#64748b'
          : path.getAttribute('stroke'),
      width: path.getAttribute('stroke-width'),
      dash: path.getAttribute('stroke-dasharray'),
    }));

describe('drawing previews and final cells share rendering', () => {
  it.each([
    'rectangle',
    'ellipse',
    'diamond',
    'database',
    'actor',
    'noteCurlyRight',
    'simpleClass',
  ])('%s shows its real contour before committing', async (shape) => {
    const test = await mount(tool('shape', shape));
    const runtime = test.controller.current!.runtime,
      before = runtime.store,
      revision = runtime.revision;
    await test.start();
    const draft = test.svg.querySelector(
      '[data-drawing-preview] [data-draft-cell-id]',
    )!;
    expect(draft).toBeTruthy();
    expect(paths(draft).length).toBeGreaterThan(0);
    expect(draft.getAttribute('data-node-shape')).toBe(shape);
    const id = draft.getAttribute('data-draft-cell-id')!,
      contour = paths(draft);
    expect(runtime.store).toBe(before);
    expect(runtime.revision).toBe(revision);
    expect(runtime.history.undos).toHaveLength(0);
    expect(test.onChange).not.toHaveBeenCalled();
    expect(
      draft.querySelector(
        '[data-port-id], [data-selection-handles], [tabindex], [contenteditable], a',
      ),
    ).toBeNull();
    await act(async () => test.fire('pointerup', [500, 270]));
    expect(test.svg.querySelector('[data-drawing-preview]')).toBeNull();
    expect(paths(test.svg.querySelector(`[data-cell-id="${id}"]`)!)).toEqual(
      contour,
    );
    expect(test.onChange).toHaveBeenCalledOnce();
    expect(runtime.history.undos).toHaveLength(1);
  });
  it('covers every product symbol, including open and multipart paths', async () => {
    const test = await mount();
    const kinds = createDefaultShapeGeometryRegistry()
      .kinds()
      .filter((kind) => !['text', 'underline'].includes(kind));
    for (const shape of kinds) {
      await act(async () => test.render(tool('shape', shape)));
      await test.start([500, 270], [300, 150]);
      const draft = test.svg.querySelector(
        '[data-drawing-preview] [data-shape-renderer]',
      )!;
      expect(draft, shape).toBeTruthy();
      expect(draft.innerHTML, shape).not.toMatch(/NaN|Infinity/);
      expect(draft.querySelectorAll('path').length, shape).toBeGreaterThan(0);
      await test.key('Escape');
    }
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it.each([
    'text',
    'table',
    'swimlane',
    'frame',
    'mind',
    'workflow',
    'architecture',
  ])('%s previews text, grids or initial content', async (pointer) => {
    const test = await mount(tool(pointer));
    await test.start();
    const draft = test.svg.querySelector('[data-drawing-preview]')!;
    expect(draft).toBeTruthy();
    const id = draft
      .querySelector('[data-draft-cell-id]')!
      .getAttribute('data-draft-cell-id')!;
    if (pointer === 'text') expect(draft.textContent).toContain('Text');
    if (pointer === 'table' || pointer === 'swimlane') {
      expect(
        draft.querySelectorAll('[data-table-entry]').length,
      ).toBeGreaterThan(1);
      expect(draft.querySelector('[tabindex]')).toBeNull();
    }
    if (['mind', 'workflow', 'architecture'].includes(pointer))
      expect(
        draft.querySelectorAll('[data-draft-cell-id]').length,
      ).toBeGreaterThan(1);
    const contour = paths(draft);
    await act(async () => test.fire('pointerup', [500, 270]));
    // Text has a selected outline; compare the unselected formal renderer.
    if (pointer === 'text')
      await act(async () =>
        test.controller.current!.runtime.select({ focus: ['root'], ids: [] }),
      );
    expect(paths(test.svg.querySelector(`[data-cell-id="${id}"]`)!)).toEqual(
      contour,
    );
    expect(test.onChange).toHaveBeenCalledOnce();
  });
  it.each([
    'nibPen',
    'feltTipPen',
    'artisticBrush',
    'markerHighlight',
  ] as const)('%s preserves the real stroke width and opacity', async (pen) => {
    const test = await mount(tool('pen', 'rectangle', pen));
    await test.start();
    const draft = test.svg.querySelector(
      '[data-drawing-preview] [data-draft-cell-kind="freehand"]',
    )!;
    const id = draft.getAttribute('data-draft-cell-id')!,
      width = pen === 'markerHighlight' ? 16 : pen === 'artisticBrush' ? 6 : 3;
    expect(draft.getAttribute('stroke-width')).toBe(String(width));
    expect(draft.getAttribute('opacity')).toBe(
      String(pen === 'markerHighlight' ? 0.35 : 1),
    );
    const contour = paths(draft);
    await act(async () => test.fire('pointerup', [500, 270]));
    expect(paths(test.svg.querySelector(`[data-cell-id="${id}"]`)!)).toEqual(
      contour,
    );
  });
  it('uses the final release position and current zoom, and retains click/minimum defaults', async () => {
    const test = await mount();
    await act(async () => test.controller.current!.setZoom(2));
    await test.paint();
    await test.start([500, 270], [300, 150]);
    await act(async () => test.fire('pointerup', [250, 100]));
    const cell = Object.values(
      test.controller.current!.runtime.store.cells,
    ).find((cell) => cell.kind === 'geometry') as NodeCell;
    expect(cell.geometry).toMatchObject({
      x: 125,
      y: 50,
      width: 125,
      height: 85,
    });
    await act(async () => {
      test.fire('pointerdown', [800, 500]);
      test.fire('pointerup', [800, 500]);
    });
    const last = Object.values(test.controller.current!.runtime.store.cells)
      .filter(isNodeCell)
      .filter((cell) => cell.kind === 'geometry')
      .at(-1)!;
    expect(last.geometry).toMatchObject({
      x: 400,
      y: 250,
      width: 160,
      height: 100,
    });
  });
  it('reuses stable IDs, formal shape paths and layouts during a burst of draft updates', async () => {
    const value = empty(),
      frame = value.store.cells.root as FrameCell;
    for (let i = 0; i < 150; i++) {
      const cell = Draw.createGeometryCell(`existing-${i}`, 'rectangle', [
        [i * 5, 400],
      ]);
      value.store.cells[cell.id] = cell;
      frame.children.push(cell.id);
    }
    const renderPaths = vi.spyOn(Draw, 'drawCellShapePaths');
    const test = await mount(tool('shape', 'ellipse'), value),
      layouts = test.layout.mock.calls.length;
    renderPaths.mockClear();
    await act(async () => {
      test.fire('pointerdown', [300, 150]);
      for (let i = 0; i < 100; i++) test.fire('pointermove', [400 + i, 250]);
    });
    expect(test.frames.size).toBe(1);
    await test.paint();
    expect(test.layout).toHaveBeenCalledTimes(layouts);
    expect(
      renderPaths.mock.calls.every(
        ([cell]) => !cell.id.startsWith('existing-'),
      ),
    ).toBe(true);
    const id = test.svg
      .querySelector('[data-drawing-preview] [data-draft-cell-id]')!
      .getAttribute('data-draft-cell-id');
    await act(async () => test.fire('pointermove', [600, 300]));
    await test.paint();
    expect(
      test.svg
        .querySelector('[data-drawing-preview] [data-draft-cell-id]')!
        .getAttribute('data-draft-cell-id'),
    ).toBe(id);
  });
});

describe('cancellation, connection and eraser feedback', () => {
  it.each([
    'Escape',
    'pointercancel',
    'lostpointercapture',
    'tool',
    'config',
    'frame',
    'readonly',
    'pinch',
  ])(
    '%s discards a shape and queued paint without later committing',
    async (reason) => {
      const value = empty();
      const nested = createFrameCell('nested');
      value.store.cells.nested = nested;
      (value.store.cells.root as FrameCell).children.push('nested');
      const test = await mount(tool('shape'), value);
      await test.start();
      if (reason === 'Escape') await test.key('Escape');
      else if (reason === 'tool' || reason === 'config')
        await act(async () =>
          test.render(
            reason === 'tool' ? tool('pen') : tool('shape', 'ellipse'),
          ),
        );
      else if (reason === 'frame')
        await act(async () => test.render(tool('shape'), 'nested'));
      else if (reason === 'readonly')
        await act(async () => test.render(tool('shape'), 'root', true));
      else
        await act(async () =>
          test.fire(
            reason === 'pinch' ? 'pointerdown' : reason,
            [520, 280],
            test.svg,
            reason === 'pinch' ? 2 : 1,
          ),
        );
      await test.paint();
      await act(async () => test.fire('pointerup', [500, 270]));
      expect(test.svg.querySelector('[data-drawing-preview]')).toBeNull();
      expect(test.onChange).not.toHaveBeenCalled();
    },
  );
  it('rerendering a tool with the same stable key keeps the gesture and its original factory', async () => {
    const test = await mount(tool('shape', 'ellipse'));
    await test.start();
    await act(async () => test.render(tool('shape', 'ellipse')));
    expect(test.svg.querySelector('[data-drawing-preview]')).toBeTruthy();
    await act(async () => test.fire('pointerup', [500, 270]));
    expect(test.onChange).toHaveBeenCalledOnce();
  });
  it('Escape cancels a multi-point polyline; Enter commits it once', async () => {
    const test = await mount(tool('vector-line'));
    const click = async (point: Point) =>
      act(async () => {
        test.fire('pointerdown', point);
        test.fire('pointerup', point);
      });
    await click([200, 120]);
    await click([400, 120]);
    await click([400, 240]);
    await test.paint();
    await test.key('Escape');
    expect(test.onChange).not.toHaveBeenCalled();
    await click([200, 120]);
    await click([400, 120]);
    await test.paint();
    await test.key('Enter');
    expect(test.onChange).toHaveBeenCalledOnce();
  });
  it('keeps a rejected host draft out of the document and clears all feedback', async () => {
    const test = await mount(tool('shape'), empty(), true);
    await test.start();
    expect(test.onIntent).not.toHaveBeenCalled();
    await act(async () => test.fire('pointerup', [500, 270]));
    expect(test.onIntent).toHaveBeenCalledOnce();
    expect(test.svg.querySelector('[data-drawing-preview]')).toBeNull();
    expect(Object.keys(test.controller.current!.runtime.store.cells)).toEqual([
      'root',
    ]);
    expect(test.controller.current!.runtime.history.undos).toHaveLength(0);
  });
  it('previews source and target ports, ignores invalid clicks and cancels pending connections', async () => {
    const value = empty(),
      a = Draw.createGeometryCell('a', 'rectangle', [[100, 100]]),
      b = Draw.createGeometryCell('b', 'rectangle', [[400, 100]]);
    (value.store.cells.root as FrameCell).children = ['a', 'b'];
    Object.assign(value.store.cells, { a, b });
    const test = await mount(tool('select'), value);
    await act(async () => {
      test.svg
        .querySelector('[data-cell-id="a"]')!
        .dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    });
    const source = test.svg.querySelector(
      '[data-cell-id="a"] [data-port-id="right"]',
    )!;
    await act(async () => test.fire('pointerdown', [260, 150], source));
    await test.paint();
    expect(source.getAttribute('data-port-active')).toBe('true');
    await act(async () => test.fire('pointermove', [400, 150]));
    await test.paint();
    const target = test.svg.querySelector(
      '[data-cell-id="b"] [data-port-id="left"]',
    )!;
    expect(target.getAttribute('data-port-active')).toBe('true');
    expect(
      test.svg.querySelector('[data-drawing-preview="connection"] path'),
    ).toBeTruthy();
    await act(async () => test.fire('pointerdown', [700, 300]));
    await test.paint();
    expect(test.onChange).not.toHaveBeenCalled();
    expect(
      test.svg.querySelector('[data-drawing-preview="connection"]'),
    ).toBeTruthy();
    await act(async () =>
      test.fire(
        'pointerdown',
        [140, 140],
        test.svg.querySelector('[data-cell-id="a"]')!,
      ),
    );
    expect(test.controller.current!.runtime.selection.ids).toEqual(['a']);
    expect(
      test.svg.querySelector('[data-drawing-preview="connection"]'),
    ).toBeTruthy();
    await act(async () => {
      test.svg
        .querySelector('[data-cell-id="b"]')!
        .dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    });
    await act(async () =>
      test.fire(
        'pointerdown',
        [400, 150],
        test.svg.querySelector('[data-cell-id="b"] [data-port-id="left"]')!,
      ),
    );
    expect(test.onChange).toHaveBeenCalledOnce();
    expect(
      test.svg.querySelector('[data-drawing-preview="connection"]'),
    ).toBeNull();
    await act(async () => test.fire('pointerdown', [260, 150], source));
    await test.paint();
    await test.key('Escape');
    expect(test.svg.querySelector('[data-port-active]')).toBeNull();
  });
  it('a gesture starting at a port honors the bidirectional connector factory in preview and commit', async () => {
    const value = empty(),
      a = Draw.createGeometryCell('a', 'rectangle', [[100, 100]]),
      b = Draw.createGeometryCell('b', 'rectangle', [[400, 100]]);
    (value.store.cells.root as FrameCell).children = ['a', 'b'];
    Object.assign(value.store.cells, { a, b });
    const test = await mount(tool('bidirectional'), value);
    await act(async () =>
      test.svg
        .querySelector('[data-cell-id="a"]')!
        .dispatchEvent(new MouseEvent('pointerover', { bubbles: true })),
    );
    await act(async () =>
      test.fire(
        'pointerdown',
        [260, 150],
        test.svg.querySelector('[data-cell-id="a"] [data-port-id="right"]')!,
      ),
    );
    await act(async () => test.fire('pointermove', [400, 150]));
    await test.paint();
    expect(
      test.svg.querySelectorAll('[data-drawing-preview] [data-arrow-marker]'),
    ).toHaveLength(2);
    await act(async () => test.fire('pointerup', [400, 150]));
    const edge = Object.values(
      test.controller.current!.runtime.store.cells,
    ).find(isEdgeCell)!;
    expect(edge.route).toEqual({ mode: 'straight' });
    expect(edge.data).toEqual({ sourceMarker: 'arrow', targetMarker: 'arrow' });
    expect(edge.source).toEqual({ cellId: 'a', portId: 'right' });
    expect(edge.target).toEqual({ cellId: 'b', portId: 'left' });
  });
  it('marks eraser candidates immediately, cancels safely, and exports undimmed content', async () => {
    const value = empty(),
      cell = Draw.createGeometryCell('shape', 'rectangle', [[100, 100]]);
    value.store.cells.shape = cell;
    (value.store.cells.root as FrameCell).children.push('shape');
    const test = await mount(tool('erase'), value);
    await test.start([150, 150], [200, 150]);
    expect(
      test.svg.querySelector('[data-erase-candidate="shape"]'),
    ).toBeTruthy();
    expect(test.svg.querySelector('[data-eraser-preview]')?.tagName).toBe(
      'circle',
    );
    expect(test.onChange).not.toHaveBeenCalled();
    const clone = cloneFrameImageSvg(test.svg);
    expect(clone.querySelector('[data-eraser-preview]')).toBeNull();
    expect(
      clone.querySelector('[data-erase-dim]')?.getAttribute('opacity'),
    ).toBe('1');
    await test.key('Escape');
    await act(async () => test.fire('pointerup', [200, 150]));
    expect(test.controller.current!.runtime.store.cells.shape).toBe(cell);
    expect(test.onChange).not.toHaveBeenCalled();
    await test.start([150, 150], [200, 150]);
    await act(async () => test.fire('pointerup', [200, 150]));
    expect(test.controller.current!.runtime.store.cells.shape).toBeUndefined();
    expect(test.onChange).toHaveBeenCalledOnce();
  });
  it('exports no draft cells or controls', async () => {
    const test = await mount(tool('table'));
    await test.start();
    const clone = cloneFrameImageSvg(test.svg);
    expect(
      clone.querySelector(
        '[data-drawing-preview], [data-table-id], [data-cell-id]',
      ),
    ).toBeNull();
  });
  it('legacy box tools get a rectangle fallback without calling complete during preview', async () => {
    const complete = vi.fn(() => []);
    const test = await mount({ mode: 'box', complete });
    await test.start();
    expect(test.svg.querySelector('[data-drawing-preview]')!.tagName).toBe(
      'rect',
    );
    expect(complete).not.toHaveBeenCalled();
    await test.key('Escape');
  });
});

describe('curve creation', () => {
  it.each([
    { end: [500, 150] as Point },
    { end: [300, 400] as Point },
    { end: [500, 270] as Point },
    { end: [100, 50] as Point },
  ])(
    'generates a visibly curved editable path toward $end',
    async ({ end }) => {
      const test = await mount(tool('curve'));
      await test.start([300, 150], end);
      const draft = test.svg.querySelector(
        '[data-drawing-preview] [data-draft-cell-id]',
      )!;
      expect(paths(draft)[0].d).toContain(' C');
      expect(draft.querySelector('[data-arrow-marker]')).toBeNull();
      const contour = paths(draft);
      await act(async () => test.fire('pointerup', end));
      const edge = Object.values(
        test.controller.current!.runtime.store.cells,
      ).find(isEdgeCell)!;
      expect(edge.route.points).toHaveLength(3);
      expect(edge.target).toEqual({ point: end });
      expect(
        paths(test.svg.querySelector(`[data-cell-id="${edge.id}"]`)!)[0],
      ).toEqual(contour[0]);
      const points = edgePolyline(test.controller.current!.runtime.store, edge);
      expect(flattenCurve(points)).toHaveLength(49);
      const edited = moveEdgeRoutePoint(edge, points, 1, [350, 450]);
      expect(edited.route.points![1]).toEqual([350, 450]);
    },
  );
  it('does not create a zero-length curve', async () => {
    const test = await mount(tool('curve'));
    await test.start([300, 150], [300, 150]);
    expect(test.svg.querySelector('[data-drawing-preview]')).toBeNull();
    await act(async () => test.fire('pointerup', [300, 150]));
    expect(
      Object.values(test.controller.current!.runtime.store.cells).filter(
        isEdgeCell,
      ),
    ).toHaveLength(0);
    expect(test.onChange).not.toHaveBeenCalled();
  });
});

describe('draft coordinate and endpoint consistency', () => {
  it('uses the mounted Frame coordinates and retains the minimum shape dimensions', async () => {
    const value = empty(),
      nested = createFrameCell('nested', {
        x: 700,
        y: 500,
        width: 200,
        height: 100,
      });
    value.store.cells.nested = nested;
    (value.store.cells.root as FrameCell).children.push('nested');
    const test = await mount(tool('shape', 'ellipse'), value);
    await act(async () => test.render(tool('shape', 'ellipse'), 'nested'));
    await test.start([300, 150], [301, 160]);
    await act(async () => test.fire('pointerup', [301, 160]));
    const runtime = test.controller.current!.runtime;
    const frame = runtime.store.cells.nested as FrameCell;
    const shape = runtime.store.cells[frame.children[0]] as NodeCell;
    expect(shape.geometry).toMatchObject({
      x: 300,
      y: 150,
      width: 8,
      height: 10,
    });
    expect((runtime.store.cells.root as FrameCell).children).toEqual([
      'nested',
    ]);
  });
  it('keeps curves bound to ports while preserving an edited middle point', async () => {
    const value = empty(),
      a = Draw.createGeometryCell('a', 'rectangle', [[100, 100]]),
      b = Draw.createGeometryCell('b', 'rectangle', [[400, 100]]);
    (value.store.cells.root as FrameCell).children = ['a', 'b'];
    Object.assign(value.store.cells, { a, b });
    const test = await mount(tool('curve'), value);
    await test.start([260, 150], [400, 150]);
    const pathsBefore = paths(
      test.svg.querySelector('[data-drawing-preview]')!,
    );
    await act(async () => test.fire('pointerup', [400, 150]));
    const runtime = test.controller.current!.runtime;
    const edge = Object.values(runtime.store.cells).find(isEdgeCell)!;
    expect(edge.source).toEqual({ cellId: 'a', portId: 'right' });
    expect(edge.target).toEqual({ cellId: 'b', portId: 'left' });
    await act(async () => runtime.select({ focus: ['root'], ids: ['a', 'b'] }));
    expect(
      paths(test.svg.querySelector(`[data-cell-id="${edge.id}"]`)!)[0],
    ).toEqual(pathsBefore[0]);
    const edited = moveEdgeRoutePoint(
      edge,
      edgePolyline(runtime.store, edge),
      1,
      [330, 260],
    );
    await act(async () => {
      await test.controller.current!.dispatch({
        id: 'edit-curve',
        operations: [{ type: 'replace_cell', cell: edited }],
      });
    });
    await act(async () => {
      await test.controller.current!.dispatch({
        id: 'move-source',
        operations: [
          {
            type: 'replace_cell',
            cell: { ...a, geometry: { ...a.geometry, x: 50 } },
          },
        ],
      });
    });
    const updated = edgePolyline(runtime.store, edited);
    expect(updated[0]).toEqual([210, 150]);
    expect(updated[1]).toEqual([330, 260]);
    expect(updated[2]).toEqual([400, 150]);
    expect(JSON.parse(JSON.stringify(edited)).route.points[1]).toEqual([
      330, 260,
    ]);
  });
  it('losing pointer capture cancels endpoint reconnection and its queued preview', async () => {
    const value = empty();
    value.store.cells.edge = {
      id: 'edge',
      kind: 'arrow',
      cellType: 'edge',
      source: { point: [100, 100] },
      target: { point: [300, 100] },
      route: { mode: 'straight' },
    };
    (value.store.cells.root as FrameCell).children = ['edge'];
    const test = await mount(tool('select'), value),
      runtime = test.controller.current!.runtime;
    await act(async () => runtime.select({ focus: ['root'], ids: ['edge'] }));
    const handle = test.svg.querySelector('[data-edge-endpoint="target"]')!;
    await act(async () => {
      test.fire('pointerdown', [300, 100], handle);
      test.fire('pointermove', [450, 250]);
    });
    await test.paint();
    expect(
      paths(test.svg.querySelector('[data-cell-id="edge"]')!)[0].d,
    ).toContain('450');
    await act(async () => {
      test.fire('lostpointercapture', [450, 250]);
      test.fire('pointerup', [450, 250]);
    });
    await test.paint();
    expect(runtime.store.cells.edge).toBe(value.store.cells.edge);
    expect(test.onChange).not.toHaveBeenCalled();
    expect(
      paths(test.svg.querySelector('[data-cell-id="edge"]')!)[0].d,
    ).not.toContain('450');
  });
});

describe('live draft dependencies', () => {
  it('keeps an idle eraser preview at its screen size after zooming', async () => {
    const test = await mount(tool('erase'));
    await act(async () => test.fire('pointermove', [120, 90]));
    await test.paint();
    const circle = test.svg.querySelector('[data-eraser-preview]')!;
    expect(circle.getAttribute('r')).toBe('10');
    await act(async () => test.controller.current!.setZoom(2));
    await test.paint();
    expect(
      test.svg.querySelector('[data-eraser-preview]')!.getAttribute('r'),
    ).toBe('5');
    expect(test.onChange).not.toHaveBeenCalled();
  });
  it('updates snap tolerance with zoom and commits the same preview endpoints', async () => {
    const value = empty(),
      b = Draw.createGeometryCell('b', 'rectangle', [[400, 100]]);
    (value.store.cells.root as FrameCell).children.push('b');
    value.store.cells.b = b;
    const test = await mount(tool('curve'), value);
    await test.start([100, 150], [390, 150]);
    expect(test.svg.querySelector('[data-port-active]')).toBeTruthy();
    await act(async () => test.controller.current!.setZoom(2));
    await test.paint();
    expect(test.svg.querySelector('[data-port-active]')).toBeNull();
    const before = paths(test.svg.querySelector('[data-drawing-preview]')!);
    await act(async () => test.fire('pointerup', [780, 300]));
    const edge = Object.values(
      test.controller.current!.runtime.store.cells,
    ).find(isEdgeCell)!;
    expect(edge.target).toEqual({ point: [390, 150] });
    expect(
      paths(test.svg.querySelector(`[data-cell-id="${edge.id}"]`)!)[0],
    ).toEqual(before[0]);
  });
  it('keeps a pending line safe if its target is deleted, and discards it if its source is deleted', async () => {
    const value = empty(),
      a = Draw.createGeometryCell('a', 'rectangle', [[100, 100]]),
      b = Draw.createGeometryCell('b', 'rectangle', [[400, 100]]);
    (value.store.cells.root as FrameCell).children = ['a', 'b'];
    Object.assign(value.store.cells, { a, b });
    const test = await mount(tool('select'), value);
    await act(async () => {
      test.svg
        .querySelector('[data-cell-id="a"]')!
        .dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    });
    const source = test.svg.querySelector(
      '[data-cell-id="a"] [data-port-id="right"]',
    )!;
    await act(async () => {
      test.fire('pointerdown', [260, 150], source);
      test.fire('pointermove', [400, 150]);
    });
    await test.paint();
    await act(async () => {
      await test.controller.current!.dispatch({
        id: 'delete-target',
        operations: [{ type: 'remove_cell', cellId: 'b' }],
      });
    });
    expect(
      test.svg.querySelector('[data-drawing-preview="connection"]'),
    ).toBeTruthy();
    await act(async () => {
      await test.controller.current!.dispatch({
        id: 'delete-source',
        operations: [{ type: 'remove_cell', cellId: 'a' }],
      });
    });
    expect(
      test.svg.querySelector('[data-drawing-preview="connection"]'),
    ).toBeNull();
    await act(async () => test.fire('pointerup', [400, 150]));
    expect(
      Object.values(test.controller.current!.runtime.store.cells).filter(
        isEdgeCell,
      ),
    ).toHaveLength(0);
    expect(test.onChange).toHaveBeenCalledTimes(2);
  });
});

describe('navigation interrupts visual drafts', () => {
  it('temporary hand navigation cancels a pending connection and pans without document changes', async () => {
    const value = empty(),
      a = Draw.createGeometryCell('a', 'rectangle', [[100, 100]]);
    (value.store.cells.root as FrameCell).children.push('a');
    value.store.cells.a = a;
    const test = await mount(tool('select'), value);
    await act(async () => {
      test.svg
        .querySelector('[data-cell-id="a"]')!
        .dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    });
    const port = test.svg.querySelector(
      '[data-cell-id="a"] [data-port-id="right"]',
    )!;
    await act(async () => {
      test.fire('pointerdown', [260, 150], port);
      test.fire('pointerup', [260, 150]);
    });
    await test.paint();
    expect(
      test.svg.querySelector('[data-drawing-preview="connection"]'),
    ).toBeTruthy();
    await act(async () => {
      test.svg.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          bubbles: true,
        }),
      );
      test.fire('pointerdown', [300, 200]);
      test.fire('pointermove', [350, 200]);
      test.fire('pointerup', [350, 200]);
      test.svg.dispatchEvent(
        new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }),
      );
    });
    await test.paint();
    expect(
      test.svg.querySelector('[data-frame-world]')!.getAttribute('transform'),
    ).toBe('scale(1) translate(50 0)');
    await act(async () => test.fire('pointermove', [400, 200]));
    await test.paint();
    expect(
      test.svg.querySelector('[data-drawing-preview="connection"]'),
    ).toBeNull();
    expect(test.onChange).not.toHaveBeenCalled();
  });
});

describe('created-cell activation', () => {
  it.each([
    'shape',
    'text',
    'pen',
    'table',
    'swimlane',
    'frame',
    'mind',
    'workflow',
    'architecture',
    'line',
    'curve',
  ])(
    'selects only the created outer cell and completes %s once',
    async (pointer) => {
      const onComplete = vi.fn();
      const drawing = createFrameDrawingTool({
        pointer,
        shape: 'rectangle',
        pen: 'feltTipPen',
        onComplete,
      });
      const test = await mount(drawing);
      await test.start([300.4, 150.7], [500.2, 270.1]);
      await act(async () => test.fire('pointerup', [500.2, 270.1]));
      const runtime = test.controller.current!.runtime;
      const frame = runtime.store.cells.root as FrameCell;
      expect(runtime.selection).toEqual({
        focus: ['root'],
        ids: [frame.children[0]],
      });
      expect(onComplete).toHaveBeenCalledOnce();
      const created = runtime.store.cells[frame.children[0]];
      if (isNodeCell(created)) {
        expect(Number.isInteger(created.geometry.x)).toBe(true);
        expect(Number.isInteger(created.geometry.y)).toBe(true);
      }
      await test.paint();
      expect(onComplete).toHaveBeenCalledOnce();
    },
  );
  it.each([false, true])(
    'waits for acceptance and host echo in either order (echoFirst=%s)',
    async (echoFirst) => {
      const onComplete = vi.fn();
      const drawing = createFrameDrawingTool({
        pointer: 'shape',
        shape: 'rectangle',
        pen: 'feltTipPen',
        onComplete,
      });
      const test = await mount(drawing, empty(), true);
      let accept!: (result: { status: 'accepted' }) => void;
      test.onIntent.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            accept = resolve;
          }),
      );
      await test.start();
      await act(async () => test.fire('pointerup', [500, 270]));
      const transaction = test.onIntent.mock.calls[0][0] as unknown as {
        operations: import('@sue/board-core').CellOperation[];
      };
      const next = {
        store: applyCellOperations(
          test.controller.current!.runtime.store,
          transaction.operations,
          test.controller.current!.runtime.registry,
        ),
      };
      expect(test.controller.current!.runtime.selection.ids).toEqual([]);
      if (echoFirst) await test.echo(next);
      await act(async () => accept({ status: 'accepted' }));
      if (!echoFirst) {
        expect(onComplete).not.toHaveBeenCalled();
        await test.echo(next);
      }
      expect(test.controller.current!.runtime.selection.ids).toEqual(
        (next.store.cells.root as FrameCell).children,
      );
      expect(onComplete).toHaveBeenCalledOnce();
    },
  );
  it('does not activate rejected creation or steal selection after a newer pointer action', async () => {
    const onComplete = vi.fn();
    const drawing = createFrameDrawingTool({
      pointer: 'shape',
      shape: 'rectangle',
      pen: 'feltTipPen',
      onComplete,
    });
    const test = await mount(drawing, empty(), true);
    await test.start();
    await act(async () => test.fire('pointerup', [500, 270]));
    expect(onComplete).not.toHaveBeenCalled();
    test.onIntent.mockResolvedValueOnce({ status: 'accepted' });
    await test.start();
    await act(async () => test.fire('pointerup', [500, 270]));
    const transaction = test.onIntent.mock.calls[1][0] as unknown as {
      operations: import('@sue/board-core').CellOperation[];
    };
    const next = {
      store: applyCellOperations(
        test.controller.current!.runtime.store,
        transaction.operations,
        test.controller.current!.runtime.registry,
      ),
    };
    await act(async () => test.fire('pointerdown', [700, 500]));
    await test.echo(next);
    expect(test.controller.current!.runtime.selection.ids).toEqual([]);
    expect(onComplete).not.toHaveBeenCalled();
  });
  it('renders an internal Frame title and opens only its eligible name editor', async () => {
    const value = empty();
    const nested = createFrameCell('nested', {
      x: 300,
      y: 150,
      width: 240,
      height: 180,
    });
    value.store = applyCellOperations(value.store, [
      { type: 'insert_cell', parentId: 'root', cell: nested },
    ]);
    const test = await mount(tool('select'), value);
    const title = test.svg.querySelector('[data-frame-title-id="nested"]')!;
    expect(title.querySelector('foreignObject')!.getAttribute('x')).toBe('316');
    expect(title.querySelector('foreignObject')!.getAttribute('y')).toBe('166');
    expect(title.textContent).toBe('Frame');
    // jsdom has no SVG layout/CTM; browser metric tests cover the real transform.
    const anchor = title.querySelector('foreignObject')!;
    Object.defineProperty(anchor, 'getScreenCTM', {
      value: () => ({
        translate: (x: number, y: number) => ({
          a: 1,
          b: 0,
          c: 0,
          d: 1,
          e: x,
          f: y,
        }),
      }),
    });
    for (const key of ['x', 'y', 'width', 'height'])
      Object.defineProperty(anchor, key, {
        value: { baseVal: { value: Number(anchor.getAttribute(key)) } },
      });
    await act(async () => test.controller.current!.editText('nested'));
    expect(
      document.querySelector('[data-frame-title-editor="nested"]'),
    ).not.toBeNull();
    // A host may revoke permission while the editor is already open.
    await test.echo({
      store: {
        ...value.store,
        cells: { ...value.store.cells, nested: { ...nested, locked: true } },
      },
    });
    expect(
      document.querySelector('[data-frame-title-editor="nested"]'),
    ).toBeNull();
    expect(
      (title.querySelector('foreignObject') as SVGElement).style.visibility,
    ).not.toBe('hidden');
    await test.echo(value);
    expect(
      document.querySelector('[data-frame-title-editor="nested"]'),
    ).toBeNull();
    await test.echo({
      store: {
        ...value.store,
        cells: { ...value.store.cells, nested: { ...nested, locked: true } },
      },
    });
    await act(async () => test.controller.current!.editText('nested'));
    expect(
      document.querySelector('[data-frame-title-editor="nested"]'),
    ).toBeNull();
  });
});
