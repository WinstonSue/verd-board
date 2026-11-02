import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createCellStore, createFrameCell } from '@sue/board-core';
import { createTestCellRegistry } from '../../../../tests/fixtures/plugins/registry';
import {
  createFrameLayouts,
  type FrameLayoutMemory,
} from './frame-scene-layout';
import { FrameVirtualLayer } from './frame-virtual-layer';
import { createFrameCameraStore } from './frame-camera-store';
import { frameSelectionWorldBounds } from './frame-selection-camera';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
it('retains declared layouts across unrelated commits and recomputes changed dependencies', () => {
  const registry = createTestCellRegistry(),
    root = createFrameCell('root');
  const store = createCellStore(root),
    memory = new Map<string, FrameLayoutMemory>();
  const layout = vi.fn(() => new Map());
  const extension = { layout, layoutCacheKey: () => [root.name] };
  createFrameLayouts(
    store,
    [extension],
    undefined,
    'root',
    memory,
    registry,
  )('root');
  createFrameLayouts(
    { ...store, cells: { ...store.cells } },
    [extension],
    undefined,
    'root',
    memory,
    registry,
  )('root');
  expect(layout).toHaveBeenCalledTimes(1);
  root.name = 'new name';
  createFrameLayouts(
    store,
    [extension],
    undefined,
    'root',
    memory,
    registry,
  )('root');
  expect(layout).toHaveBeenCalledTimes(2);
});
it('computes an offscreen selection without mounted DOM', () => {
  const registry = createTestCellRegistry(),
    root = createFrameCell('root');
  root.children = ['node'];
  const store = createCellStore(root);
  store.cells.node = {
    id: 'node',
    cellType: 'node',
    kind: 'geometry',
    geometry: { x: 5000, y: 4000, width: 100, height: 50 },
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const bounds = frameSelectionWorldBounds({
    svg,
    world: null,
    store,
    frameId: 'root',
    ids: ['node'],
    parentOf: new Map([['node', 'root']]),
    layouts: createFrameLayouts(
      store,
      [],
      undefined,
      'root',
      undefined,
      registry,
    ),
    allowUnmounted: true,
  });
  expect(bounds).toEqual({ x: 5000, y: 4000, width: 100, height: 50 });
});
it('mounts only visible and active cells, reacts to pan, and exports all cells', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    svg = createRef<SVGSVGElement>();
  const camera = createFrameCameraStore(
    { zoom: 1, origination: [0, 0] },
    'root',
  );
  const measure = vi
    .spyOn(SVGElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({ width: 100, height: 100 } as DOMRect);
  const ids = Array.from({ length: 5000 }, (_, i) => String(i));
  const query = vi.fn((bounds) => (bounds.x > 100 ? ['4998'] : ['0']));
  const renderItem = vi.fn((id: string) => <g key={id} data-item={id} />);
  const render = (enabled: boolean) => (
    <svg ref={svg}>
      <FrameVirtualLayer
        camera={camera}
        svg={svg}
        ids={ids}
        query={query}
        pinned={['4999']}
        enabled={enabled}
      >
        {renderItem}
      </FrameVirtualLayer>
    </svg>
  );
  try {
    await act(async () => root.render(render(true)));
    expect(host.querySelectorAll('[data-item]')).toHaveLength(2);
    const calls = renderItem.mock.calls.length;
    await act(async () => camera.publish({ zoom: 1, origination: [1, 0] }));
    expect(renderItem).toHaveBeenCalledTimes(calls);
    await act(async () => camera.publish({ zoom: 1, origination: [1000, 0] }));
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(host.querySelector('[data-item="0"]')).toBeNull();
    expect(host.querySelector('[data-item="4998"]')).not.toBeNull();
    expect(host.querySelector('[data-item="4999"]')).not.toBeNull();
    await act(async () => root.render(render(false)));
    expect(host.querySelectorAll('[data-item]')).toHaveLength(5000);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    measure.mockRestore();
  }
});
