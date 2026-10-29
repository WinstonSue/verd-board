import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { FrameContentVisibility } from './frame-content-visibility';
import { cloneFrameImageSvg } from './frame-export';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

it('keeps observing and retains the same content, scroll and focus when leaving and reentering the viewport', async () => {
  let notify: (entries: IntersectionObserverEntry[]) => void = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof notify) {
        notify = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const mounts = vi.fn(),
    unmounts = vi.fn();
  function Content() {
    useEffect(() => {
      mounts();
      return unmounts;
    }, []);
    return (
      <div data-reader>
        <input />
        <p>Live content</p>
      </div>
    );
  }
  const content = <Content />;
  const render = (editing = false, exporting = false) =>
    act(() =>
      root.render(
        <FrameContentVisibility editing={editing} exporting={exporting}>
          {content}
        </FrameContentVisibility>,
      ),
    );
  const observe = (visible: boolean) =>
    act(() =>
      notify([{ isIntersecting: visible } as IntersectionObserverEntry]),
    );
  try {
    await render();
    const wrapper = container.firstElementChild as HTMLElement;
    const reader = container.querySelector<HTMLElement>('[data-reader]')!;
    const input = container.querySelector('input')!;
    reader.scrollTop = 123;
    await observe(false);
    expect(wrapper.style.opacity).toBe('0');
    expect(disconnect).not.toHaveBeenCalled();
    expect(container.querySelector('[data-reader]')).toBe(reader);
    await observe(true);
    expect(wrapper.style.opacity).toBe('');
    expect(reader.scrollTop).toBe(123);
    await act(() => input.focus());
    await observe(false);
    expect(document.activeElement).toBe(input);
    expect(wrapper.style.opacity).toBe('');
    await act(() => input.blur());
    expect(wrapper.style.opacity).toBe('0');
    await render(true);
    expect(wrapper.style.opacity).toBe('');
    await render(false);
    expect(wrapper.style.opacity).toBe('0');
    await render(false, true);
    expect(wrapper.style.opacity).toBe('');
    expect(mounts).toHaveBeenCalledTimes(1);
    expect(unmounts).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    container.remove();
  }
  expect(unmounts).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalledTimes(1);
});

it('pins embedded text and document editors even when focus moves to another scope', async () => {
  let notify: (entries: IntersectionObserverEntry[]) => void = () => {};
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof notify) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    for (const attribute of [
      'data-frame-text-editor',
      'data-document-editing',
    ]) {
      await act(() =>
        root.render(
          <FrameContentVisibility>
            <div {...{ [attribute]: '' }} />
          </FrameContentVisibility>,
        ),
      );
      await act(() =>
        notify([{ isIntersecting: false } as IntersectionObserverEntry]),
      );
      expect((container.firstElementChild as HTMLElement).style.opacity).toBe(
        '',
      );
    }
    await act(() =>
      root.render(
        <FrameContentVisibility>
          <p>Reader</p>
        </FrameContentVisibility>,
      ),
    );
    expect((container.firstElementChild as HTMLElement).style.opacity).toBe(
      '0',
    );
  } finally {
    await act(() => root.unmount());
  }
});

it('renders normally without IntersectionObserver and restores offscreen content in image clones', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(() =>
      root.render(
        <svg>
          <foreignObject>
            <FrameContentVisibility>
              <p>Complete export</p>
            </FrameContentVisibility>
          </foreignObject>
        </svg>,
      ),
    );
    const wrapper = container.querySelector(
      'foreignObject > div',
    ) as HTMLElement;
    expect(wrapper.style.opacity).toBe('');
    wrapper.setAttribute('data-frame-paint-paused', '');
    wrapper.style.opacity = '0';
    const clone = cloneFrameImageSvg(container.querySelector('svg')!);
    expect(clone.textContent).toContain('Complete export');
    expect(clone.querySelector('[data-frame-paint-paused]')).toBeNull();
    expect(
      (clone.querySelector('foreignObject > div') as HTMLElement).style.opacity,
    ).toBe('');
    expect(wrapper.style.opacity).toBe('0');
  } finally {
    await act(() => root.unmount());
  }
});
