import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCellStore,
  createFrameCell,
  moveVectorLinePoint,
  polylinePath,
  vectorLineMidpoints,
  vectorLinePath,
  type NodeCell,
} from '@sue/board-core';
import {
  createTableCell,
  createFreehandCell,
  createGeometryCell,
  createVectorLineCell,
  drawCellShapePaths,
  tableSelectionRange,
} from '@sue/board-draw';
import type { FrameRenderContext } from '@sue/board-react';
import { FrameTable } from './frame-table';
import { FrameVectorLine } from './frame-vector-line';
import { frameDrawExtensions } from './frame-draw-extension';

vi.mock('@sue/board-core', async (original) => {
  const actual = await original<typeof import('@sue/board-core')>();
  return {
    ...actual,
    vectorLinePath: vi.fn(actual.vectorLinePath),
    vectorLineMidpoints: vi.fn(actual.vectorLineMidpoints),
    moveVectorLinePoint: vi.fn(actual.moveVectorLinePoint),
    polylinePath: vi.fn(actual.polylinePath),
  };
});
vi.mock('@sue/board-draw', async (original) => {
  const actual = await original<typeof import('@sue/board-draw')>();
  return { ...actual, tableSelectionRange: vi.fn(actual.tableSelectionRange) };
});
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const contextFor = (cell: NodeCell): FrameRenderContext => ({
  cell,
  geometry: cell.geometry,
  store: createCellStore(createFrameCell('root')),
  frameId: 'root',
  scale: 1,
  selected: true,
  readonly: false,
  pending: false,
  getGeometry: () => cell.geometry,
  select: vi.fn(),
  history: vi.fn(),
  dispatch: vi.fn(async () => ({ status: 'accepted' as const })),
});
const pointer = (target: Element, type: string, x = 0, y = 0) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
};

describe('drawing body caches during zoom', () => {
  it('reuses Rough JSX until selection, geometry or immutable cell content changes', async () => {
    const cell = createGeometryCell('rectangle', 'rectangle', [
      [10, 20],
      [130, 100],
    ]);
    const context = { ...contextFor(cell), selected: false };
    const extension = frameDrawExtensions.find(
      (item) => item.kind === 'geometry',
    )!;
    const normal = extension.renderShape!(context);
    for (const scale of [0.1, 0.5, 1.1, 2, 4, 8])
      expect(extension.renderShape!({ ...context, scale })).toBe(normal);
    const selected = extension.renderShape!({ ...context, selected: true });
    expect(selected).not.toBe(normal);
    expect(
      extension.renderShape!({ ...context, selected: true, scale: 4 }),
    ).toBe(selected);
    expect(extension.renderShape!(context)).toBe(normal);

    const geometry = { ...cell.geometry, x: 30, width: 240 };
    const resized = extension.renderShape!({
      ...context,
      geometry,
      selected: true,
    });
    expect(resized).not.toBe(selected);
    const changed = {
      ...cell,
      content: { label: 'Changed immutable content' },
    };
    const updated = extension.renderShape!({
      ...context,
      cell: changed,
      geometry,
      selected: true,
    });
    expect(updated).not.toBe(resized);
    expect(
      extension.renderShape!({
        ...context,
        cell: changed,
        geometry,
        selected: true,
        scale: 8,
      }),
    ).toBe(updated);

    const container = document.createElement('div');
    const root = createRoot(container);
    const paths = () =>
      [...container.querySelectorAll('path')].map((path) => ({
        d: path.getAttribute('d'),
        fill: path.getAttribute('fill'),
        stroke: path.getAttribute('stroke'),
      }));
    try {
      await act(async () => root.render(<svg>{normal}</svg>));
      const original = paths();
      await act(async () => root.render(<svg>{selected}</svg>));
      expect(paths().some((path) => path.stroke === '#6366f1')).toBe(true);
      await act(async () => root.render(<svg>{updated}</svg>));
      expect(paths()).toEqual(
        drawCellShapePaths(changed, geometry, '#6366f1').map((path) => ({
          d: path.d,
          fill: path.fill ?? null,
          stroke: path.stroke,
        })),
      );
      expect(paths().map((path) => path.d)).not.toEqual(
        original.map((path) => path.d),
      );
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('reuses freehand paths through continuous zoom and invalidates geometry and point changes', async () => {
    const cell = createFreehandCell('stroke', [
      [10, 20],
      [30, 40],
      [50, 20],
    ]);
    const context = contextFor(cell);
    const extension = frameDrawExtensions.find(
      (item) => item.kind === 'freehand',
    )!;
    const container = document.createElement('div');
    const root = createRoot(container);
    const element = extension.render!(context);
    const render = (next: FrameRenderContext) =>
      root.render(<svg>{extension.render!(next)}</svg>);
    try {
      await act(async () => render(context));
      const original = container.querySelector('path')!.getAttribute('d');
      expect(polylinePath).toHaveBeenCalledTimes(1);
      for (let index = 1; index <= 60; index++) {
        const next = { ...context, scale: 1 + index / 10 };
        expect(extension.render!(next)).toBe(element);
        await act(async () => render(next));
      }
      expect(polylinePath).toHaveBeenCalledTimes(1);
      expect(container.querySelector('path')!.getAttribute('d')).toBe(original);

      const geometry = { ...cell.geometry, x: 20, width: 80 };
      const resizedElement = extension.render!({ ...context, geometry });
      expect(resizedElement).not.toBe(element);
      await act(async () => render({ ...context, geometry }));
      expect(polylinePath).toHaveBeenCalledTimes(2);
      expect(vi.mocked(polylinePath).mock.calls.at(-1)![0]).toEqual([
        [20, 20],
        [60, 40],
        [100, 20],
      ]);

      const changed = {
        ...cell,
        data: {
          ...cell.data!,
          points: [
            [0, 0],
            [10, 5],
            [40, 0],
          ] as [number, number][],
        },
      };
      expect(
        extension.render!({ ...context, cell: changed, geometry }),
      ).not.toBe(resizedElement);
      await act(async () => render({ ...context, cell: changed, geometry }));
      expect(polylinePath).toHaveBeenCalledTimes(3);
      expect(vi.mocked(polylinePath).mock.calls.at(-1)![0]).toEqual([
        [20, 20],
        [40, 25],
        [100, 20],
      ]);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('does not rebuild table entries on scale changes and keeps selection callbacks fresh', async () => {
    const context = contextFor(
      createTableCell(
        'table',
        [
          [0, 0],
          [200, 100],
        ],
        2,
        2,
      ),
    );
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <svg>
            <FrameTable {...context} />
          </svg>,
        ),
      );
      const calculations = vi.mocked(tableSelectionRange).mock.calls.length;
      for (const scale of [0.1, 0.5, 2, 4, 8])
        await act(async () =>
          root.render(
            <svg>
              <FrameTable {...context} scale={scale} />
            </svg>,
          ),
        );
      expect(tableSelectionRange).toHaveBeenCalledTimes(calculations);
      const select = vi.fn();
      await act(async () =>
        root.render(
          <svg>
            <FrameTable {...context} select={select} />
          </svg>,
        ),
      );
      await act(async () =>
        pointer(container.querySelector('[data-table-entry]')!, 'pointerdown'),
      );
      expect(select).toHaveBeenCalledTimes(1);
      expect(context.select).not.toHaveBeenCalled();
      await act(async () =>
        root.render(
          <svg>
            <FrameTable {...context} readonly />
          </svg>,
        ),
      );
      expect(
        container.querySelector('[aria-label="Table controls"]'),
      ).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('reuses vector paths while hit areas and interaction snapping receive the current scale', async () => {
    const context = contextFor(
      createVectorLineCell(
        'line',
        [
          [0, 0],
          [100, 50],
          [200, 0],
        ],
        'curve',
      ),
    );
    const container = document.createElement('div');
    const root = createRoot(container);
    vi.stubGlobal(
      'DOMPoint',
      class {
        constructor(
          public x: number,
          public y: number,
        ) {}
        matrixTransform() {
          return this;
        }
      },
    );
    try {
      await act(async () =>
        root.render(
          <svg>
            <FrameVectorLine {...context} />
          </svg>,
        ),
      );
      const path = container
        .querySelector('[data-vector-path]')!
        .getAttribute('d');
      const pathCalculations = vi.mocked(vectorLinePath).mock.calls.length;
      const midpointCalculations =
        vi.mocked(vectorLineMidpoints).mock.calls.length;
      const group = container.querySelector(
        '[data-vector-line]',
      ) as SVGGElement;
      group.getScreenCTM = () => ({ inverse: () => ({}) }) as DOMMatrix;
      const handle = container.querySelector(
        '[data-vector-point="0"]',
      ) as SVGCircleElement;
      handle.setPointerCapture = vi.fn();
      await act(async () => pointer(handle, 'pointerdown'));
      for (const scale of [0.5, 2, 8, 4])
        await act(async () =>
          root.render(
            <svg>
              <FrameVectorLine {...context} scale={scale} />
            </svg>,
          ),
        );
      expect(
        container.querySelector('[data-vector-path]')!.getAttribute('d'),
      ).toBe(path);
      expect(vectorLinePath).toHaveBeenCalledTimes(pathCalculations);
      expect(vectorLineMidpoints).toHaveBeenCalledTimes(midpointCalculations);
      expect(
        container
          .querySelector('[data-vector-hit]')!
          .getAttribute('stroke-width'),
      ).toBe('2.5');
      expect(handle.getAttribute('r')).toBe('1.25');
      await act(async () => pointer(handle, 'pointerup', 2, 0));
      expect(vi.mocked(moveVectorLinePoint).mock.calls.at(-1)![4]).toBe(2);
      expect(context.dispatch).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
