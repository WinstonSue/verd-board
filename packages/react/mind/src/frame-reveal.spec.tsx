import {
  applyCellOperations,
  isNodeCell,
  type NodeCell,
} from '@sue/board-core';
import {
  addMindChild,
  createMindChildCell,
  createMindFrameSnapshot,
} from '@sue/board-mind';
import {
  canonicalFrameProjection,
  type FrameRenderContext,
  type FrameViewProjection,
} from '@sue/board-react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { createTestCellRegistry } from '../../../../tests/fixtures/plugins/registry';
import { createMindFrameExtensions } from './frame-extension';
import { renderMindControls } from './mind-controls';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = () => {
  const registry = createTestCellRegistry();
  let store = createMindFrameSnapshot('frame', 'root').store;
  store = applyCellOperations(
    store,
    addMindChild(store, 'root', createMindChildCell('child'), 'edge'),
    registry,
  );
  const root = store.cells.root as NodeCell;
  store = {
    ...store,
    cells: {
      ...store.cells,
      root: { ...root, data: { ...(root.data as object), collapsed: true } },
    },
  };
  const projection: FrameViewProjection = {
    identity: {},
    expandedCellIds: new Set(['root']),
    purpose: 'interactive',
  };
  const context: FrameRenderContext = {
    store,
    cell: store.cells.root,
    frameId: 'frame',
    geometry: root.geometry,
    scale: 1,
    selected: true,
    pending: false,
    readonly: false,
    viewProjection: projection,
    clearRevealOverrides: vi.fn(),
    getGeometry: (id) => {
      const cell = store.cells[id];
      return isNodeCell(cell) ? cell.geometry : undefined;
    },
    select: vi.fn(),
    history: vi.fn(),
    dispatch: vi.fn(async () => ({ status: 'accepted' as const })),
  };
  return {
    store,
    projection,
    context,
    extension: createMindFrameExtensions(registry)[0],
  };
};

describe('Mind occurrence reveal projection', () => {
  it('shares projected layout with visibility while keeping canonical and export caches independent', () => {
    const { store, projection, context, extension } = fixture();
    const canonical = extension.layout!(
      store,
      'frame',
      canonicalFrameProjection,
    );
    const expanded = extension.layout!(store, 'frame', projection);
    expect(canonical.has('child')).toBe(false);
    expect(expanded.has('child')).toBe(true);
    expect(extension.layout!(store, 'frame', projection)).toBe(expanded);
    expect(extension.visible!({ ...context, cell: store.cells.child })).toBe(
      true,
    );
    expect(extension.visible!({ ...context, cell: store.cells.edge })).toBe(
      true,
    );
    expect(
      extension.visible!({
        ...context,
        cell: store.cells.child,
        viewProjection: canonicalFrameProjection,
      }),
    ).toBe(false);
    const exported = extension.layout!(store, 'frame', {
      identity: {},
      expandedCellIds: projection.expandedCellIds,
      purpose: 'export',
    });
    expect(exported.has('child')).toBe(false);
    expect(extension.layout!(store, 'frame', canonicalFrameProjection)).toBe(
      canonical,
    );
    expect(
      (store.cells.root as NodeCell<{ collapsed: boolean }>).data!.collapsed,
    ).toBe(true);
  });

  it('clears a temporary expansion on collapse without creating a content transaction', async () => {
    const { context } = fixture();
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(<svg>{renderMindControls(context)}</svg>),
      );
      const control = container.querySelector('[data-mind-fold]')!;
      expect(control.getAttribute('aria-expanded')).toBe('true');
      await act(async () =>
        control.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })),
      );
      expect(context.clearRevealOverrides).toHaveBeenCalledWith(['root']);
      expect(context.dispatch).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
