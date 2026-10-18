import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCellRegistry,
  createCellRuntime,
  createFrameCell,
  frameContentViewport,
  geometryBounds,
  type FrameSnapshot,
  type MindRootData,
  type NodeCell,
  type NodeGeometry,
} from '@sue/board-core';
import { createInlineText, type BoardTextDocument } from '@sue/board-common';
import {
  addMindChild,
  createMindChildCell,
  createMindFrameSnapshot,
  createMindRootCell,
  createMindSummary,
  layoutMindCells,
  mindChildIds,
} from '@sue/board-mind';
import {
  FrameCanvas,
  type FrameCanvasController,
  type FrameRenderExtension,
} from '@sue/board-react';
import { createMindFrameExtensions } from './frame-extension';
import { cloneFrameImageSvg } from '../../board/src/frame-export';

vi.mock('../../board/src/frame-text-editor', () => ({
  FrameTextEditor: ({
    text,
    onChange,
  }: {
    text: BoardTextDocument;
    onChange(change: {
      oldText: BoardTextDocument;
      newText: BoardTextDocument;
    }): void;
  }) => (
    <button
      data-frame-text-editor=""
      data-testid="mind-editor-change"
      onClick={() =>
        onChange({ oldText: text, newText: createInlineText('Edited topic') })
      }
    >
      Edit
    </button>
  ),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

const fixture = () => {
  const registry = createCellRegistry();
  const extensions = createMindFrameExtensions(registry);
  const runtime = createCellRuntime(
    createMindFrameSnapshot('mind', 'topic'),
    registry,
  );
  for (const id of ['a', 'b'])
    runtime.transact({
      id,
      operations: addMindChild(
        runtime.store,
        'topic',
        createMindChildCell(id),
        `edge-${id}`,
      ),
    });
  runtime.transact({
    id: 'summary',
    operations: createMindSummary(
      runtime.store,
      'topic',
      'a',
      'b',
      'summary',
      'range',
    ),
  });
  runtime.transact({
    id: 'other',
    operations: [
      {
        type: 'insert_cell',
        parentId: 'mind',
        cell: createMindRootCell('other', [650, 200]),
      },
    ],
  });
  const board = createFrameCell('board');
  board.children = ['mind'];
  const value: FrameSnapshot = {
    store: {
      rootId: 'board',
      cells: {
        ...runtime.store.cells,
        board,
        mind: {
          ...runtime.store.cells.mind,
          geometry: { x: 100, y: 100, width: 1200, height: 900 },
        } as NodeCell,
      },
    },
  };
  return { registry, extensions, value };
};

const mount = async () => {
  const { registry, extensions, value } = fixture();
  const display = new Map<string, NodeGeometry>();
  const capture: FrameRenderExtension = {
    presentation: (context) => {
      if (context.geometry && !context.preview)
        display.set(context.cell.id, context.geometry);
      return undefined;
    },
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    ref = createRef<FrameCanvasController>(),
    onChange = vi.fn();
  const render = (frameId = 'board', next = value) =>
    root.render(
      <FrameCanvas
        ref={ref}
        value={next}
        frameId={frameId}
        registry={registry}
        extensions={[...extensions, capture]}
        autoFit={false}
        onChange={onChange}
      />,
    );
  await act(async () => render());
  const svg = host.querySelector('svg')!;
  svg.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 1400,
      height: 1100,
      right: 1400,
      bottom: 1100,
      toJSON() {},
    }) as DOMRect;
  svg.setPointerCapture = vi.fn();
  svg.hasPointerCapture = () => false;
  const cell = (id: string) => host.querySelector(`[data-cell-id="${id}"]`)!;
  const fire = async (
    target: EventTarget,
    type: string,
    x: number,
    y: number,
    pointerId = 1,
  ) =>
    act(async () => {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0,
        clientX: x,
        clientY: y,
      });
      Object.defineProperty(event, 'pointerId', { value: pointerId });
      target.dispatchEvent(event);
    });
  const drag = async (id: string, dx: number, dy: number) => {
    await fire(cell(id), 'pointerdown', 300, 300);
    await fire(svg, 'pointermove', 300 + dx, 300 + dy);
    await fire(svg, 'pointerup', 300 + dx, 300 + dy);
  };
  cleanups.push(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  return { ref, host, svg, cell, fire, drag, display, value, onChange, render };
};

describe('embedded Mind root dragging', () => {
  it.each(['mind', 'board'])(
    '%s previews an entire child branch without changing history, removes it on cancel, and commits the same layout once',
    async (frameId) => {
      const t = await mount();
      await act(async () => {
        await t.ref.current!.dispatch({
          id: 'a1',
          operations: addMindChild(
            t.ref.current!.runtime.store,
            'a',
            createMindChildCell('a1'),
            'edge-a1',
          ),
        });
        t.render(frameId);
      });
      if (frameId === 'board') await t.drag('topic', 20, 15);
      const scale = Number(
        t.host
          .querySelector('[data-frame-content-id="mind"]')!
          .getAttribute('transform')!
          .match(/scale\(([^)]+)\)/)![1],
      );
      const before = t.ref.current!.runtime.store;
      const changes = t.onChange.mock.calls.length;
      const history = t.ref.current!.runtime.history.undos.length;
      const a = t.display.get('a')!,
        b = t.display.get('b')!;
      const dx = b.x + b.width + 20 - a.x,
        dy = b.y + b.height / 2 - (a.y + a.height / 2);
      await t.fire(t.cell('a'), 'pointerdown', 300, 300);
      await t.fire(t.svg, 'pointermove', 300 + dx * scale, 300 + dy * scale);
      const ghost = t.host.querySelector('[data-mind-ghost="a"]')!;
      expect(ghost).not.toBeNull();
      expect(ghost.getAttribute('opacity')).toBe('0.35');
      expect(ghost.querySelector('[data-draft-cell-id="a1"]')).not.toBeNull();
      expect(ghost.querySelector('[data-draft-cell-id="summary"]')).toBeNull();
      expect(
        t.host.querySelector('[data-mind-drop-target="b"]'),
      ).not.toBeNull();
      expect(t.ref.current!.runtime.store).toBe(before);
      expect(t.ref.current!.runtime.history.undos).toHaveLength(history);
      expect(t.onChange).toHaveBeenCalledTimes(changes);
      expect(
        cloneFrameImageSvg(t.svg).querySelector('[data-mind-ghost]'),
      ).toBeNull();
      const outline = ghost
        .querySelector('[data-draft-cell-id="a1"] path')!
        .getAttribute('d');
      await t.fire(t.svg, 'pointercancel', 300 + dx * scale, 300 + dy * scale);
      expect(t.host.querySelector('[data-mind-ghost]')).toBeNull();
      expect(t.ref.current!.runtime.store).toBe(before);
      await t.fire(t.cell('a'), 'pointerdown', 300, 300);
      await t.fire(t.svg, 'pointermove', 300 + dx * scale, 300 + dy * scale);
      await t.fire(t.svg, 'pointerup', 300 + dx * scale, 300 + dy * scale);
      expect(t.host.querySelector('[data-mind-ghost]')).toBeNull();
      expect(mindChildIds(t.ref.current!.runtime.store, 'b')).toEqual(['a']);
      expect(t.cell('a1').querySelector('path')!.getAttribute('d')).toBe(
        outline,
      );
      expect(t.ref.current!.runtime.history.undos).toHaveLength(history + 1);
      expect(t.onChange).toHaveBeenCalledTimes(changes + 1);
      await act(async () => {
        t.ref.current!.undo();
      });
      expect(t.ref.current!.runtime.store).toEqual(before);
    },
  );

  it('moves only the selected tree and summary, with identical preview, commit, history and reload', async () => {
    const t = await mount();
    const before = new Map(t.display);
    const branchBefore = t
      .cell('edge-a')
      .querySelector('path')!
      .getAttribute('d');
    await t.fire(t.cell('topic'), 'pointerdown', 300, 300);
    await t.fire(t.svg, 'pointermove', 340, 330);
    for (const id of ['topic', 'a', 'b', 'summary']) {
      expect(t.display.get(id)!.x).toBeCloseTo(before.get(id)!.x + 40);
      expect(t.display.get(id)!.y).toBeCloseTo(before.get(id)!.y + 30);
    }
    expect(t.display.get('other')).toEqual(before.get('other'));
    expect(t.onChange).not.toHaveBeenCalled();
    expect(t.cell('edge-a').querySelector('path')!.getAttribute('d')).not.toBe(
      branchBefore,
    );
    const preview = new Map(t.display);
    await t.fire(t.svg, 'pointerup', 340, 330);
    expect(t.display).toEqual(preview);
    const saved = t.ref.current!.runtime.snapshot;
    const placement = t.host
      .querySelector('[data-frame-content-id="mind"]')!
      .getAttribute('transform')!
      .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!
      .map(Number);
    const selected = t.display.get('topic')!;
    expect(t.ref.current!.selectionScreenBounds()).toMatchObject({
      x: selected.x * placement[2] + placement[0],
      y: selected.y * placement[2] + placement[1],
      width: selected.width * placement[2],
      height: selected.height * placement[2],
    });
    expect(saved.store.cells.mind).toEqual(t.value.store.cells.mind);
    expect(saved.store.cells.topic).toEqual({
      ...t.value.store.cells.topic,
      data: {
        ...((t.value.store.cells.topic as NodeCell).data as object),
        embeddedOffset: [40, 30],
      },
    });
    for (const id of [
      'a',
      'b',
      'summary',
      'other',
      'edge-a',
      'edge-b',
      'range',
    ])
      expect(saved.store.cells[id]).toEqual(t.value.store.cells[id]);
    await act(async () => t.ref.current!.undo());
    expect(t.display).toEqual(before);
    await act(async () => t.ref.current!.redo());
    expect(t.display).toEqual(preview);
    const reloaded = JSON.parse(JSON.stringify(saved)) as FrameSnapshot;
    await act(async () => t.render('board', reloaded));
    expect(t.display).toEqual(preview);
    await act(async () => t.render('mind', reloaded));
    const canonical = layoutMindCells(reloaded.store, 'mind');
    for (const id of ['topic', 'a', 'b', 'summary', 'other'])
      expect(t.display.get(id)).toEqual(canonical.get(id));
  });

  it('clamps every visible member inside the shell and uses the same base fit after the move', async () => {
    const t = await mount();
    const content = t.host.querySelector('[data-frame-content-id="mind"]')!;
    const transform = content.getAttribute('transform')!;
    const values = transform
      .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!
      .map(Number);
    const [x, y, scale] = values;
    await t.drag('topic', 10000, -10000);
    expect(content.getAttribute('transform')).toBe(transform);
    const viewport = frameContentViewport(
      (t.value.store.cells.mind as NodeCell).geometry,
    );
    for (const id of ['topic', 'a', 'b', 'summary']) {
      const bounds = t.display.get(id)!;
      expect(bounds.x * scale + x).toBeGreaterThanOrEqual(viewport.x - 1e-7);
      expect(bounds.y * scale + y).toBeGreaterThanOrEqual(viewport.y - 1e-7);
      expect((bounds.x + bounds.width) * scale + x).toBeLessThanOrEqual(
        viewport.x + viewport.width + 1e-7,
      );
      expect((bounds.y + bounds.height) * scale + y).toBeLessThanOrEqual(
        viewport.y + viewport.height + 1e-7,
      );
    }
    const first = t.display.get('topic')!;
    await t.drag('topic', -20, 20);
    expect(t.display.get('topic')!.x).toBeCloseTo(first.x - 20);
    expect(t.display.get('topic')!.y).toBeCloseTo(first.y + 20);
  });

  it('discards a cancelled preview before a subsequent Frame gesture and preserves shell dimensions', async () => {
    const t = await mount();
    await t.fire(t.cell('topic'), 'pointerdown', 300, 300);
    await t.fire(t.svg, 'pointermove', 340, 320);
    await t.fire(t.svg, 'pointercancel', 340, 320);
    const shell = t.cell('mind').querySelector('[data-frame-shell]')!;
    await t.fire(shell, 'pointerdown', 100, 100);
    await t.fire(t.svg, 'pointerup', 100, 100);
    expect(t.onChange).not.toHaveBeenCalled();
    await t.fire(shell, 'pointerdown', 100, 100);
    await t.fire(t.svg, 'pointermove', 140, 120);
    await t.fire(t.svg, 'pointerup', 140, 120);
    const geometry = (t.ref.current!.runtime.store.cells.mind as NodeCell)
      .geometry;
    expect(geometry).toEqual({
      x: 140,
      y: 120,
      width: 1200,
      height: 900,
      derived: false,
    });
    expect(
      (t.ref.current!.runtime.store.cells.topic as NodeCell<MindRootData>).data
        ?.embeddedOffset,
    ).toBeUndefined();
  });

  it('continues child reordering from the displayed positions after an embedded move', async () => {
    const t = await mount();
    await t.drag('topic', 40, 30);
    const a = t.display.get('a')!,
      b = t.display.get('b')!;
    const dy = a.y - b.y - b.height / 2 - 10;
    await t.fire(t.cell('b'), 'pointerdown', 300, 300);
    await t.fire(t.svg, 'pointermove', 300, 300 + dy);
    await t.fire(t.svg, 'pointerup', 300, 300 + dy);
    expect(mindChildIds(t.ref.current!.runtime.store, 'topic')).toEqual([
      'b',
      'a',
    ]);
    expect(
      (t.ref.current!.runtime.store.cells.topic as NodeCell<MindRootData>).data
        ?.embeddedOffset,
    ).toEqual([40, 30]);
  });

  it('reclamps an existing offset after resizing and can drag back from the visible position', async () => {
    const t = await mount();
    await t.drag('topic', 10000, 10000);
    const savedOffset = (
      t.ref.current!.runtime.store.cells.topic as NodeCell<MindRootData>
    ).data!.embeddedOffset!;
    const frame = t.ref.current!.runtime.store.cells.mind as NodeCell;
    await act(async () => {
      await t.ref.current!.dispatch({
        id: 'resize',
        operations: [
          {
            type: 'replace_cell',
            cell: {
              ...frame,
              geometry: { ...frame.geometry, width: 600, height: 300 },
            },
          },
        ],
      });
    });
    const display = t.display.get('topic')!;
    const base = layoutMindCells(t.ref.current!.runtime.store, 'mind').get(
      'topic',
    )!;
    expect(display.y - base.y).toBeLessThan(savedOffset[1]);
    const transform = t.host
      .querySelector('[data-frame-content-id="mind"]')!
      .getAttribute('transform')!;
    const scale = Number(transform.match(/scale\(([^)]+)\)/)![1]);
    await t.drag('topic', 0, -10);
    expect(t.display.get('topic')!.y).toBeCloseTo(display.y - 10 / scale);
    const offset = (
      t.ref.current!.runtime.store.cells.topic as NodeCell<MindRootData>
    ).data!.embeddedOffset!;
    expect(offset[1]).toBeCloseTo(t.display.get('topic')!.y - base.y);
  });

  it('rejects nonfinite embedded offsets before they can hide the saved tree', async () => {
    const t = await mount();
    const topic = t.ref.current!.runtime.store.cells
      .topic as NodeCell<MindRootData>;
    let result;
    await act(async () => {
      result = await t.ref.current!.dispatch({
        id: 'bad-offset',
        operations: [
          {
            type: 'replace_cell',
            cell: {
              ...topic,
              data: { ...topic.data, embeddedOffset: [Infinity, 0] },
            },
          },
        ],
      });
    });
    expect(result).toMatchObject({
      status: 'rejected',
      message: 'Invalid embedded mind offset',
    });
    expect(t.ref.current!.runtime.store.cells.topic).toEqual(topic);
    expect(t.onChange).not.toHaveBeenCalled();
  });

  it('keeps presentation offsets out of canonical coordinates when locking or editing text', async () => {
    const t = await mount();
    await t.drag('topic', 40, 30);
    const canonical = (t.ref.current!.runtime.store.cells.topic as NodeCell)
      .geometry;
    const before = new Map(t.display);
    for (const type of ['lock', 'unlock'] as const) {
      await act(async () => {
        await t.ref.current!.executeSelectionCommand({ type });
      });
      expect(
        (t.ref.current!.runtime.store.cells.topic as NodeCell).geometry,
      ).toEqual(canonical);
      expect(t.display).toEqual(before);
    }
    await act(async () => t.ref.current!.editText('topic'));
    expect(t.host.querySelector('[data-frame-text-editor]')).not.toBeNull();
    await act(async () => {
      (
        t.host.querySelector(
          '[data-testid="mind-editor-change"]',
        ) as HTMLButtonElement
      ).click();
    });
    const topic = t.ref.current!.runtime.store.cells
      .topic as NodeCell<MindRootData>;
    expect(topic.content?.label).toBe('Edited topic');
    expect(topic.geometry).toEqual(canonical);
    expect(topic.data?.embeddedOffset).toEqual([40, 30]);
  });

  it('disables root resizing and rotates without baking in its embedded offset', async () => {
    const t = await mount();
    await t.drag('topic', 40, 30);
    const before = (t.ref.current!.runtime.store.cells.topic as NodeCell)
      .geometry;
    expect(
      t.host.querySelector(
        '[data-handle-cell="topic"][data-resize-handle="se"]',
      ),
    ).toBeNull();
    const rotate = t.host.querySelector('[data-rotate-handle="topic"]')!;
    await t.fire(rotate, 'pointerdown', 300, 300);
    await t.fire(t.svg, 'pointermove', 340, 340);
    await t.fire(t.svg, 'pointerup', 340, 340);
    const topic = t.ref.current!.runtime.store.cells
      .topic as NodeCell<MindRootData>;
    expect(topic.geometry).toEqual({
      ...before,
      rotation: expect.any(Number),
    });
    expect(topic.data?.embeddedOffset).toEqual([40, 30]);
  });

  it('keeps the corners of rotated topics inside the embedded viewport', async () => {
    const t = await mount();
    const topic = t.ref.current!.runtime.store.cells.topic as NodeCell;
    await act(async () => {
      await t.ref.current!.dispatch({
        id: 'rotate',
        operations: [
          {
            type: 'replace_cell',
            cell: {
              ...topic,
              geometry: { ...topic.geometry, rotation: Math.PI / 4 },
            },
          },
        ],
      });
    });
    await t.drag('topic', -10000, -10000);
    const transform = t.host
      .querySelector('[data-frame-content-id="mind"]')!
      .getAttribute('transform')!;
    const [x, y, scale] = transform
      .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!
      .map(Number);
    const viewport = frameContentViewport(
      (t.value.store.cells.mind as NodeCell).geometry,
    );
    for (const id of ['topic', 'a', 'b', 'summary']) {
      const bounds = geometryBounds(t.display.get(id)!);
      expect(bounds.x * scale + x).toBeGreaterThanOrEqual(viewport.x - 1e-7);
      expect(bounds.y * scale + y).toBeGreaterThanOrEqual(viewport.y - 1e-7);
      expect((bounds.x + bounds.width) * scale + x).toBeLessThanOrEqual(
        viewport.x + viewport.width + 1e-7,
      );
      expect((bounds.y + bounds.height) * scale + y).toBeLessThanOrEqual(
        viewport.y + viewport.height + 1e-7,
      );
    }
  });
});

describe('Mind fold controls', () => {
  it.each(['mind', 'board'])(
    '%s folds and unfolds branches and roots without inserting or deleting topics',
    async (frameId) => {
      const t = await mount();
      await act(async () => {
        await t.ref.current!.dispatch({
          id: 'grandchild',
          operations: addMindChild(
            t.ref.current!.runtime.store,
            'a',
            createMindChildCell('leaf'),
            'edge-leaf',
          ),
        });
        t.render(frameId);
      });
      const ids = Object.keys(t.ref.current!.runtime.store.cells);
      expect(t.host.querySelector('[data-mind-add]')).toBeNull();
      await t.fire(t.cell('leaf'), 'pointerdown', 300, 300);
      await t.fire(t.svg, 'pointerup', 300, 300);
      expect(t.host.querySelector('[data-mind-controls="leaf"]')).toBeNull();

      for (const id of ['a', 'topic']) {
        await t.fire(t.cell(id), 'pointerdown', 300, 300);
        await t.fire(t.svg, 'pointerup', 300, 300);
        const button = () => t.host.querySelector(`[data-mind-fold="${id}"]`)!;
        const hiddenIds =
          id === 'a'
            ? ['leaf', 'edge-leaf']
            : [
                'a',
                'b',
                'summary',
                'leaf',
                'edge-a',
                'edge-b',
                'edge-leaf',
                'range',
              ];
        const before = t.ref.current!.runtime.history.undos.length;
        expect(button().getAttribute('aria-expanded')).toBe('true');
        await t.fire(button(), 'pointerdown', 300, 300);
        expect(button().getAttribute('aria-expanded')).toBe('false');
        expect(button().querySelector('path')!.getAttribute('d')).toContain(
          ' V ',
        );
        hiddenIds.forEach((hidden) => expect(t.cell(hidden)).toBeNull());
        expect(t.cell('other')).not.toBeNull();
        expect(Object.keys(t.ref.current!.runtime.store.cells)).toEqual(ids);
        expect(t.ref.current!.runtime.selection.ids).toEqual([id]);
        expect(t.ref.current!.runtime.history.undos.length).toBe(before + 1);
        await act(async () => t.ref.current!.undo());
        hiddenIds.forEach((hidden) => expect(t.cell(hidden)).not.toBeNull());
        await act(async () => t.ref.current!.redo());
        hiddenIds.forEach((hidden) => expect(t.cell(hidden)).toBeNull());

        // The expand button stays discoverable after selecting another tree.
        await t.fire(t.cell('other'), 'pointerdown', 500, 300);
        await t.fire(t.svg, 'pointerup', 500, 300);
        expect(button()).not.toBeNull();
        await t.fire(button(), 'pointerdown', 300, 300);
        expect(button().getAttribute('aria-expanded')).toBe('true');
        expect(button().querySelector('path')!.getAttribute('d')).not.toContain(
          ' V ',
        );
        hiddenIds.forEach((hidden) => expect(t.cell(hidden)).not.toBeNull());
        expect(Object.keys(t.ref.current!.runtime.store.cells)).toEqual(ids);
      }
    },
  );
});
