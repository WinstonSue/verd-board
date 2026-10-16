import { describe, expect, it } from 'vitest';
import { createBlockText, createInlineText } from '@sue/board-common';
import {
  createCellRegistry,
  createCellRuntime,
  type NodeCell,
} from '@sue/board-core';
import {
  createMindFrameSnapshot,
  createMindChildCell,
  addMindChild,
} from './cell-commands';
import { mindCellMetrics, validMindMaxWidth } from './cell-metrics';
import { layoutMindCells, registerMindCells } from './cell-utils';

describe('native mind content layout', () => {
  it('expands the topic region for large wrapped rich text without shrinking media regions', () => {
    const cell = createMindChildCell('child');
    const text = createInlineText('Long topic with a large font');
    text.content.content![0].content![0].marks = [
      { type: 'textStyle', attrs: { fontSize: '32px' } },
    ];
    const expanded = mindCellMetrics({
      ...cell,
      geometry: { ...cell.geometry, width: 120, derived: false },
      content: { label: text.plainText, text },
    });
    expect(expanded.topicHeight).toBeGreaterThan(120);
    expect(expanded.height).toBe(expanded.topicHeight);
    expect(mindCellMetrics(cell).topicHeight).toBe(40);
  });
  it('reserves independent regions for images, emoji, notes and topic text', () => {
    const cell = createMindChildCell('child');
    const decorated = {
      ...cell,
      data: {
        image: { url: 'image.png', width: 200, height: 100 },
        emojis: [{ name: '🙂' }],
        note: createBlockText('Note'),
      },
    };
    const metrics = mindCellMetrics(decorated);
    expect(metrics.width).toBeGreaterThan(200);
    expect(metrics.imageWidth).toBe(200);
    expect(metrics.imageHeight).toBe(108);
    expect(metrics.emojiHeight).toBe(24);
    expect(metrics.noteHeight).toBe(48);
    expect(metrics.height).toBe(220);
    expect(
      mindCellMetrics({
        ...decorated,
        data: { ...decorated.data, noteCollapsed: true },
      }).height,
    ).toBe(172);
    expect(
      mindCellMetrics({
        ...cell,
        geometry: { ...cell.geometry, derived: false, width: 80 },
        data: { manualWidth: 64 },
      }).width,
    ).toBe(mindCellMetrics(cell).width);
  });
  it('caps automatic width, ignores legacy fixed widths and keeps height unlimited', () => {
    const child = createMindChildCell('child');
    const long = {
      ...child,
      geometry: { ...child.geometry, width: 1800, derived: false },
      data: { manualWidth: 1500 },
      content: { text: createInlineText('中文长内容'.repeat(500)) },
    };
    const narrow = mindCellMetrics(long);
    const wide = mindCellMetrics(long, { maxNodeWidth: 400 });
    expect(narrow.width).toBe(240);
    expect(narrow.height).toBeGreaterThan(1000);
    expect(wide.width).toBe(400);
    expect(wide.height).toBeLessThan(narrow.height);
    expect(validMindMaxWidth(80)).toBe(true);
    for (const value of [0, 79, 2001, 240.5, Infinity, '240'])
      expect(validMindMaxWidth(value)).toBe(false);
  });
  it('uses supplied typography measurements for topics and notes and fits images proportionally', () => {
    const child = createMindChildCell('child');
    const text = createInlineText('Topic');
    const note = createBlockText('Note');
    const metrics = mindCellMetrics(
      {
        ...child,
        content: { text },
        data: { image: { url: 'image', width: 800, height: 400 }, note },
      },
      {
        maxNodeWidth: 160,
        measureText: (document, width) => ({
          width: width === Infinity ? 800 : width,
          height: document === note ? 280 : 130,
        }),
      },
    );
    expect(metrics.width).toBe(160);
    expect(metrics.imageWidth).toBe(144);
    expect(metrics.imageHeight).toBe(80);
    expect(metrics.topicHeight).toBe(138);
    expect(metrics.noteHeight).toBe(288);
    expect(metrics.height).toBe(506);
  });
  it('applies each root override to its tree and supports undo without persisting derived geometry', () => {
    const registry = createCellRegistry();
    registerMindCells(registry);
    const runtime = createCellRuntime(
      createMindFrameSnapshot('frame', 'root'),
      registry,
    );
    const child = {
      ...createMindChildCell('child'),
      content: { text: createInlineText('long content '.repeat(100)) },
    };
    runtime.transact({
      id: 'insert',
      operations: addMindChild(runtime.store, 'root', child, 'edge'),
    });
    const before = runtime.store;
    expect(
      layoutMindCells(before, 'frame', { maxNodeWidth: 320 }).get('child')!
        .width,
    ).toBe(320);
    expect(runtime.store).toBe(before);
    const root = runtime.store.cells.root as NodeCell;
    runtime.transact({
      id: 'override',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...root,
            data: { ...(root.data as object), maxNodeWidth: 160 },
          },
        },
      ],
    });
    expect(
      layoutMindCells(runtime.store, 'frame', { maxNodeWidth: 320 }).get(
        'child',
      )!.width,
    ).toBe(160);
    expect(
      registry.get('mind-child')!.capabilities!(runtime.store, child, 'root')
        .resize,
    ).toBe(false);
    runtime.undo();
    expect(
      layoutMindCells(runtime.store, 'frame', { maxNodeWidth: 320 }).get(
        'child',
      )!.width,
    ).toBe(320);
  });
  it('omits collapsed descendants from layout without removing saved cells and restores them on undo', () => {
    const registry = createCellRegistry();
    registerMindCells(registry);
    const runtime = createCellRuntime(
      createMindFrameSnapshot('frame', 'root'),
      registry,
    );
    runtime.transact({
      id: 'child',
      operations: addMindChild(
        runtime.store,
        'root',
        createMindChildCell('child'),
        'edge',
      ),
    });
    runtime.transact({
      id: 'grandchild',
      operations: addMindChild(
        runtime.store,
        'child',
        createMindChildCell('grandchild'),
        'edge2',
      ),
    });
    const child = runtime.store.cells.child as NodeCell;
    runtime.transact({
      id: 'collapse',
      operations: [
        { type: 'replace_cell', cell: { ...child, data: { collapsed: true } } },
      ],
    });
    expect(layoutMindCells(runtime.store, 'frame').has('grandchild')).toBe(
      false,
    );
    expect(runtime.store.cells.grandchild).toBeDefined();
    runtime.undo();
    expect(layoutMindCells(runtime.store, 'frame').has('grandchild')).toBe(
      true,
    );
  });
});
