import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNavigationFeedback } from './workspace-navigation-feedback';
import { WorkspaceNavigationProgress } from './workspace-navigation-progress';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('workspace navigation progress', () => {
  it('keeps the strip mounted and aria-hidden for fast switches, then clears busy after paint', async () => {
    const feedback = createNavigationFeedback();
    const content = createRef<HTMLDivElement>();
    const ready = () => true;
    await act(async () =>
      root.render(
        <div ref={content}>
          <WorkspaceNavigationProgress
            feedback={feedback}
            content={content}
            ready={ready}
            locale="zh"
          />
        </div>,
      ),
    );
    const strip = container.querySelector('[role="progressbar"]')!;
    const session = {};
    await act(async () => {
      const ticket = feedback.begin({
        session,
        sourceFileId: 'a',
        targetFileId: 'b',
      });
      feedback.commit(session, 'b');
      feedback.settle(ticket, { status: 'completed' });
    });
    expect(content.current?.getAttribute('aria-busy')).toBe('true');
    expect(strip.getAttribute('aria-hidden')).toBe('true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(32);
    });
    expect(content.current?.getAttribute('aria-busy')).toBe('false');
    expect(container.querySelector('[role="progressbar"]')).toBe(strip);
    expect(strip.classList.contains('is-pending')).toBe(false);
    expect(strip.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('reveals only at the threshold and waits for readiness without taking focus', async () => {
    const feedback = createNavigationFeedback();
    const content = createRef<HTMLDivElement>();
    let available = false;
    const ready = () => available;
    await act(async () =>
      root.render(
        <div ref={content}>
          <button>Source</button>
          <WorkspaceNavigationProgress
            feedback={feedback}
            content={content}
            ready={ready}
            locale="en"
          />
        </div>,
      ),
    );
    container.querySelector('button')!.focus();
    const focused = document.activeElement;
    const session = {};
    await act(async () => {
      const ticket = feedback.begin({
        session,
        sourceFileId: 'a',
        targetFileId: 'b',
      });
      feedback.commit(session, 'b');
      feedback.settle(ticket, { status: 'completed' });
      await vi.advanceTimersByTimeAsync(299);
    });
    const strip = container.querySelector('[role="progressbar"]')!;
    expect(strip.getAttribute('aria-hidden')).toBe('true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(strip.getAttribute('aria-hidden')).toBe('false');
    expect(strip.getAttribute('aria-label')).toBe('Opening…');
    expect(document.activeElement).toBe(focused);
    await act(async () => {
      available = true;
      feedback.refresh();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(32);
    });
    expect(strip.getAttribute('aria-hidden')).toBe('true');
    expect(content.current?.getAttribute('aria-busy')).toBe('false');
  });

  it('cancels old paint callbacks when a later request or failure arrives', async () => {
    const feedback = createNavigationFeedback();
    const content = createRef<HTMLDivElement>();
    await act(async () =>
      root.render(
        <div ref={content}>
          <WorkspaceNavigationProgress
            feedback={feedback}
            content={content}
            ready={() => true}
            locale="zh"
          />
        </div>,
      ),
    );
    const session = {};
    await act(async () => {
      const ticket = feedback.begin({
        session,
        sourceFileId: 'a',
        targetFileId: 'b',
      });
      feedback.commit(session, 'b');
      feedback.settle(ticket, { status: 'completed' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    await act(async () => {
      feedback.begin({ session, sourceFileId: 'b', targetFileId: 'c' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(feedback.current()?.targetFileId).toBe('c');
    await act(async () => feedback.cancel());
    expect(content.current?.getAttribute('aria-busy')).toBe('false');
    expect(vi.getTimerCount()).toBe(0);
  });
});
