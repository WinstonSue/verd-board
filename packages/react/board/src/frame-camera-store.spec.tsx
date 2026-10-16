import React, { act, memo, Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFrameCameraStore,
  FrameNodeAppearance,
  FrameScaleContent,
  type FrameNodeAppearanceValue,
} from './frame-camera-store';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const mount = () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  const camera = createFrameCameraStore(
    { zoom: 1, origination: [0, 0] },
    'root',
  );
  cleanups.push(async () => act(async () => root.unmount()));
  const zoom = (scale: number) =>
    act(async () => camera.publish({ zoom: scale, origination: [10, 20] }));
  return { container, root, camera, zoom };
};

describe('camera output subscriptions', () => {
  it('notifies only the old/new hovered cell and ignores late leaves', () => {
    const test = mount();
    const a = vi.fn(),
      b = vi.fn(),
      other = vi.fn();
    const unsubscribe = test.camera.subscribeCell('a', a);
    test.camera.subscribeCell('b', b);
    test.camera.subscribeCell('other', other);
    test.camera.setHovered('a');
    test.camera.setHovered('b');
    test.camera.leave('a');
    expect(test.camera.isHovered('b')).toBe(true);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    unsubscribe();
    test.camera.setHovered('a');
    expect(a).toHaveBeenCalledTimes(2);
    test.camera.setHovered(null);
    expect(test.camera.getHoveredId()).toBeNull();
  });
  it('calls scale callbacks without committing unchanged memoized native content', async () => {
    const test = mount();
    const body = vi.fn();
    const Shape = memo(function Shape({ width }: { width: number }) {
      body();
      return <rect width={width} height={20} />;
    });
    const scales: number[] = [];
    const commits = vi.fn();
    const render = (scale: number) => {
      scales.push(scale);
      return <Shape width={100} />;
    };
    await act(async () =>
      test.root.render(
        <Profiler id="static" onRender={commits}>
          <svg>
            <FrameScaleContent camera={test.camera} render={render} />
          </svg>
        </Profiler>,
      ),
    );
    for (let index = 1; index <= 60; index++) await test.zoom(1 + index / 20);
    expect(scales.at(-1)).toBe(4);
    expect(new Set(scales).size).toBe(61);
    expect(body).toHaveBeenCalledTimes(1);
    expect(commits).toHaveBeenCalledTimes(1);

    await act(async () =>
      test.root.render(
        <Profiler id="static" onRender={commits}>
          <svg>
            <FrameScaleContent
              camera={test.camera}
              render={(scale) => {
                expect(scale).toBe(4);
                return <Shape width={200} />;
              }}
            />
          </svg>
        </Profiler>,
      ),
    );
    expect(body).toHaveBeenCalledTimes(2);
    expect(test.container.querySelector('rect')!.getAttribute('width')).toBe(
      '200',
    );
  });

  it('keeps visibility callbacks live and commits only when the result changes', async () => {
    const test = mount();
    const child = <rect data-visible width={100} height={20} />;
    const scales: number[] = [];
    const commits = vi.fn();
    await act(async () =>
      test.root.render(
        <Profiler id="visibility" onRender={commits}>
          <svg>
            <FrameScaleContent
              camera={test.camera}
              render={(scale) => {
                scales.push(scale);
                return scale < 2 ? child : null;
              }}
            />
          </svg>
        </Profiler>,
      ),
    );
    for (const scale of [1.1, 1.3, 1.5, 1.9]) await test.zoom(scale);
    expect(commits).toHaveBeenCalledTimes(1);
    expect(scales.at(-1)).toBe(1.9);
    await test.zoom(2);
    expect(test.container.querySelector('[data-visible]')).toBeNull();
    expect(commits).toHaveBeenCalledTimes(2);
    await test.zoom(3);
    expect(commits).toHaveBeenCalledTimes(2);
    await test.zoom(1);
    expect(test.container.querySelector('[data-visible]')).not.toBeNull();
    expect(commits).toHaveBeenCalledTimes(3);
  });

  it('updates scaled attributes, default memo props and custom memo comparators', async () => {
    const test = mount();
    const custom = vi.fn();
    const Scaled = memo(function Scaled({ size }: { size: number }) {
      return <ellipse data-memo-scaled rx={size} />;
    });
    const Custom = memo(
      function Custom() {
        custom();
        return <circle data-custom r={test.camera.getZoom()} />;
      },
      () => false,
    );
    await act(async () =>
      test.root.render(
        <svg>
          <FrameScaleContent
            camera={test.camera}
            render={(scale) => <circle data-scaled r={6 / scale} />}
          />
          <FrameScaleContent camera={test.camera} render={() => <Custom />} />
          <FrameScaleContent
            camera={test.camera}
            render={(scale) => <Scaled size={10 / scale} />}
          />
        </svg>,
      ),
    );
    for (const scale of [2, 4, 8]) {
      await test.zoom(scale);
      expect(
        test.container.querySelector('[data-scaled]')!.getAttribute('r'),
      ).toBe(String(6 / scale));
      expect(
        test.container.querySelector('[data-custom]')!.getAttribute('r'),
      ).toBe(String(scale));
      expect(
        test.container.querySelector('[data-memo-scaled]')!.getAttribute('rx'),
      ).toBe(String(10 / scale));
    }
    expect(custom).toHaveBeenCalledTimes(4);
  });

  it('does not hide callback ref changes behind equal host attributes', async () => {
    const test = mount();
    const mounted: number[] = [];
    await act(async () =>
      test.root.render(
        <svg>
          <FrameScaleContent
            camera={test.camera}
            render={(scale) => (
              <rect
                width={100}
                ref={(node) => {
                  if (node) mounted.push(scale);
                }}
              />
            )}
          />
        </svg>,
      ),
    );
    for (const scale of [2, 3]) await test.zoom(scale);
    expect(mounted).toEqual([1, 2, 3]);
  });

  it('publishes appearance only when bounds or presentation actually change', async () => {
    const test = mount();
    const computes = vi.fn((scale: number) => ({
      bounds: { x: 10, y: 20, width: scale < 2 ? 100 : 200, height: 40 },
      fill: scale < 3 ? 'red' : 'blue',
      color: 'black',
    }));
    const commits = vi.fn();
    const renders = vi.fn(({ bounds, fill }: FrameNodeAppearanceValue) => (
      <rect {...bounds} fill={fill} />
    ));
    await act(async () =>
      test.root.render(
        <Profiler id="appearance" onRender={commits}>
          <svg>
            <FrameNodeAppearance
              camera={test.camera}
              compute={computes}
              render={renders}
            />
          </svg>
        </Profiler>,
      ),
    );
    for (const scale of [1.1, 1.4, 1.9]) await test.zoom(scale);
    expect(computes).toHaveBeenLastCalledWith(1.9);
    expect(commits).toHaveBeenCalledTimes(1);
    expect(renders).toHaveBeenCalledTimes(1);
    await test.zoom(2);
    expect(commits).toHaveBeenCalledTimes(2);
    expect(test.container.querySelector('rect')!.getAttribute('width')).toBe(
      '200',
    );
    await test.zoom(2.5);
    expect(commits).toHaveBeenCalledTimes(2);
    await test.zoom(3);
    expect(test.container.querySelector('rect')!.getAttribute('fill')).toBe(
      'blue',
    );
    expect(commits).toHaveBeenCalledTimes(3);
  });
});
