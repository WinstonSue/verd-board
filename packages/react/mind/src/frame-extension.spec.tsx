import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCellRegistry,
  isFrameCell,
  isNodeCell,
  ThemeColorMode,
  type MindNodeData,
  type NodeCell,
} from '@sue/board-core';
import {
  createMindFrameSnapshot,
  mindCellMetrics,
  mindPresentation,
} from '@sue/board-mind';
import { createBlockText } from '@sue/board-common';
import type { FrameRenderContext } from '@sue/board-react';
import { createMindFrameExtensions } from './frame-extension';

vi.mock('@sue/board-mind', async (original) => {
  const actual = await original<typeof import('@sue/board-mind')>();
  return {
    ...actual,
    mindCellMetrics: vi.fn(actual.mindCellMetrics),
    mindPresentation: vi.fn(actual.mindPresentation),
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.clearAllMocks());
const fixture = () => {
  const registry = createCellRegistry();
  const extensions = createMindFrameExtensions(registry);
  const { store } = createMindFrameSnapshot('frame', 'root');
  const cell = store.cells.root as NodeCell<MindNodeData>;
  const context: FrameRenderContext = {
    store,
    cell,
    geometry: cell.geometry,
    frameId: 'frame',
    scale: 1,
    selected: false,
    readonly: false,
    pending: false,
    getGeometry: (id) => {
      const node = store.cells[id];
      return isNodeCell(node) ? node.geometry : undefined;
    },
    select: vi.fn(),
    history: vi.fn(),
    dispatch: vi.fn(async () => ({ status: 'accepted' as const })),
  };
  return {
    context,
    extension: extensions.find((item) => item.kind === 'mind-root')!,
  };
};

describe('mind content caches', () => {
  it('reuses text metrics and presentation across camera and control changes', () => {
    const { context, extension } = fixture();
    const bounds = extension.textBounds!(context);
    const presentation = extension.presentation!(context);
    for (const scale of [0.1, 0.5, 2, 4, 8]) {
      const next = { ...context, scale, selected: true, hovered: true };
      expect(extension.textBounds!(next)).toBe(bounds);
      expect(extension.presentation!(next)).toBe(presentation);
    }
    expect(mindCellMetrics).toHaveBeenCalledTimes(1);
    expect(mindPresentation).toHaveBeenCalledTimes(1);

    const geometry = {
      ...context.geometry!,
      height: context.geometry!.height + 40,
    };
    const resized = extension.textBounds!({ ...context, geometry });
    expect(resized.height).toBe(bounds.height + 40);
    expect(mindCellMetrics).toHaveBeenCalledTimes(2);

    const cell = {
      ...context.cell,
      data: { emojis: [{ name: '🌿' }] },
    } as NodeCell<MindNodeData>;
    const decorated = extension.textBounds!({ ...context, cell });
    expect(decorated.y).toBe(bounds.y + 24);
    expect(mindCellMetrics).toHaveBeenCalledTimes(3);

    const frame = context.store.cells.frame;
    if (!isFrameCell(frame)) throw new Error('Expected frame fixture');
    const store = {
      ...context.store,
      cells: {
        ...context.store.cells,
        frame: {
          ...frame,
          view: { theme: { themeColorMode: ThemeColorMode.colorful } },
        },
      },
    };
    const themed = extension.presentation!({ ...context, store });
    expect(themed?.color).toBe('#FFFFFF');
    expect(themed).not.toBe(presentation);
    expect(mindPresentation).toHaveBeenCalledTimes(2);
    extension.presentation!({ ...context, frameId: 'other' });
    expect(mindPresentation).toHaveBeenCalledTimes(3);
  });

  it('keeps the static topic body while zoom changes and refreshes event callbacks', async () => {
    const { context, extension } = fixture();
    const emojis = [{ name: '🌿' }];
    const map = vi.spyOn(emojis, 'map');
    context.cell = {
      ...context.cell,
      data: { emojis, note: createBlockText('note') },
    } as NodeCell<MindNodeData>;
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(<svg>{extension.renderShape!(context)}</svg>),
      );
      const renders = map.mock.calls.length;
      for (const scale of [0.2, 0.5, 2, 8])
        await act(async () =>
          root.render(
            <svg>{extension.renderShape!({ ...context, scale })}</svg>,
          ),
        );
      expect(map).toHaveBeenCalledTimes(renders);
      const select = vi.fn();
      await act(async () =>
        root.render(
          <svg>{extension.renderShape!({ ...context, scale: 4, select })}</svg>,
        ),
      );
      await act(async () => {
        container
          .querySelector('[data-mind-note]')!
          .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      });
      expect(select).toHaveBeenCalledTimes(1);
      expect(context.select).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
