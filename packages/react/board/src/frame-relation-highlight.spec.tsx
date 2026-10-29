import { act, Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createFrameCameraStore } from './frame-camera-store';
import { FrameNodeInteraction } from './frame-relation-highlight';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('does not commit inactive nodes on zoom and changes active shadows without recopying their contours', async () => {
  const camera = createFrameCameraStore(
    { zoom: 1, origination: [0, 0] },
    'root',
  );
  const container = document.createElement('div');
  const root = createRoot(container);
  const commits = vi.fn();
  const bounds = { x: 0, y: 0, width: 100, height: 40 };
  const children = (
    <>
      <path data-frame-node-outline d="M0 0L100 40" stroke="black" />
      <g data-frame-node-interaction-slot />
    </>
  );
  const serialize = vi.spyOn(XMLSerializer.prototype, 'serializeToString');
  const render = (primary: boolean) =>
    act(async () =>
      root.render(
        <Profiler id="node" onRender={commits}>
          <svg>
            <g data-cell-id="node">
              <FrameNodeInteraction
                camera={camera}
                cellId="node"
                bounds={bounds}
                relatedSelected={false}
                primary={primary}
                scale={1}
                baseWidth={1}
              >
                {children}
              </FrameNodeInteraction>
            </g>
          </svg>
        </Profiler>,
      ),
    );
  try {
    await render(false);
    for (const zoom of [1.2, 1.5, 2, 3])
      await act(() => camera.publish({ zoom }));
    expect(commits).toHaveBeenCalledTimes(1);
    expect(serialize).not.toHaveBeenCalled();
    await render(true);
    const copies = serialize.mock.calls.length;
    expect(copies).toBeGreaterThan(0);
    const path = container.querySelector('[data-frame-node-outline]')!;
    const clone = vi.spyOn(path, 'cloneNode');
    for (const zoom of [1, 2, 4]) {
      await act(() => camera.publish({ zoom }));
      expect(
        container.querySelector('feGaussianBlur')!.getAttribute('stdDeviation'),
      ).toBe(String(2.25 / zoom));
      expect(
        path.getAttribute('data-frame-original-stroke-opacity'),
      ).not.toBeNull();
    }
    expect(serialize).toHaveBeenCalledTimes(copies);
    expect(clone).not.toHaveBeenCalled();
    await act(async () => {
      path.setAttribute('d', 'M0 0L80 20');
    });
    expect(serialize.mock.calls.length).toBeGreaterThan(copies);
    expect(
      container.querySelector('[data-node-highlight]')!.innerHTML,
    ).toContain('L80 20');
    await render(false);
    expect(path.getAttribute('data-frame-original-stroke-opacity')).toBeNull();
    expect(container.querySelector('[data-node-highlight]')).toBeNull();
  } finally {
    await act(() => root.unmount());
    vi.restoreAllMocks();
  }
});
