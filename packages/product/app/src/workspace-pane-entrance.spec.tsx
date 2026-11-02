import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePaneEntrance } from './workspace-pane-entrance';
import { createNavigationFeedback } from './workspace-navigation-feedback';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let oldAnimate: PropertyDescriptor | undefined;
let motion: EventTarget & { matches: boolean };
let animations: Array<{
  cancel: ReturnType<typeof vi.fn>;
  finish(): void;
  options: KeyframeAnimationOptions;
}>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  motion = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', () => motion);
  animations = [];
  oldAnimate = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'animate',
  );
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: vi.fn((_frames, options) => {
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const cancel = vi.fn();
      animations.push({ finish, cancel, options });
      return { finished, cancel };
    }),
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (oldAnimate)
    Object.defineProperty(HTMLElement.prototype, 'animate', oldAnimate);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ready-driven pane entrance', () => {
  it('holds the initial opacity until ready and does not let loading completion cancel the fade', async () => {
    const content = createRef<HTMLDivElement>();
    const feedback = createNavigationFeedback();
    let ready = false;
    await act(async () =>
      root.render(
        <div ref={content}>
          <WorkspacePaneEntrance
            content={content}
            feedback={feedback}
            activeFileId="a"
            visible
            ready={() => ready}
          />
          <div className="workspace-pane is-active" />
        </div>,
      ),
    );
    const pane = container.querySelector<HTMLElement>('.workspace-pane')!;
    expect(pane.style.opacity).toBe('0.55');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(animations).toHaveLength(0);
    await act(async () => {
      ready = true;
      feedback.refresh();
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(animations).toHaveLength(1);
    expect(animations[0].options).toMatchObject({
      duration: 180,
      id: 'workspace-pane-enter',
    });
    await act(async () => {
      feedback.cancel();
      feedback.refresh();
    });
    expect(animations[0].cancel).not.toHaveBeenCalled();
    await act(async () => animations[0].finish());
    expect(pane.style.opacity).toBe('');
    expect(pane.dataset['paneEntrance']).toBe('complete');
  });

  it('does not restart on unrelated renders and cancels an old target without remounting panes', async () => {
    const content = createRef<HTMLDivElement>();
    const feedback = createNavigationFeedback();
    const render = (id: string) =>
      act(async () =>
        root.render(
          <div ref={content}>
            <WorkspacePaneEntrance
              content={content}
              feedback={feedback}
              activeFileId={id}
              visible
              ready={() => true}
            />
            {['a', 'b'].map((key) => (
              <div
                key={key}
                data-file={key}
                className={`workspace-pane${id === key ? ' is-active' : ''}`}
              />
            ))}
          </div>,
        ),
      );
    await render('a');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    const node = container.querySelector('[data-file="a"]');
    await render('a');
    expect(animations).toHaveLength(1);
    await render('b');
    expect(animations[0].cancel).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    await act(async () => animations[0].finish());
    expect(container.querySelector('[data-file="a"]')).toBe(node);
    expect(
      container.querySelector<HTMLElement>('[data-file="b"]')!.dataset[
        'paneEntrance'
      ],
    ).toBe('running');
    expect(animations).toHaveLength(2);
  });

  it('removes motion immediately when reduced motion is selected', async () => {
    const content = createRef<HTMLDivElement>();
    const feedback = createNavigationFeedback();
    await act(async () =>
      root.render(
        <div ref={content}>
          <WorkspacePaneEntrance
            content={content}
            feedback={feedback}
            activeFileId="a"
            visible
            ready={() => true}
          />
          <div className="workspace-pane is-active" />
        </div>,
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    await act(async () => {
      motion.matches = true;
      motion.dispatchEvent(new Event('change'));
    });
    expect(animations[0].cancel).toHaveBeenCalledOnce();
    expect(
      container.querySelector<HTMLElement>('.workspace-pane')!.style.opacity,
    ).toBe('');
  });
});
