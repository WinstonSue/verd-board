import React, { act, StrictMode, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPreviewMountQueue,
  PreviewMountProvider,
  usePreviewMount,
} from './preview-mount';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function frames() {
  const callbacks = new Set<() => void>();
  return {
    schedule(callback: () => void) {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    advance() {
      const current = [...callbacks];
      callbacks.clear();
      current.forEach((callback) => callback());
    },
    get pending() {
      return callbacks.size;
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('preview admission', () => {
  it('prioritizes visible previews, waits for commit and admits at most one per frame', () => {
    const clock = frames();
    const queue = createPreviewMountQueue(clock.schedule);
    const order: string[] = [];
    const commits: (() => void)[] = [];
    const request = (id: string, priority: number) =>
      queue.request((commit) => {
        order.push(id);
        commits.push(commit);
      }, priority);
    request('nearby', 1);
    request('visible-first', 0);
    request('visible-second', 0);
    clock.advance();
    expect(order).toEqual(['visible-first']);
    expect(clock.pending).toBe(0);
    clock.advance();
    expect(order).toHaveLength(1);
    commits[0]();
    expect(order).toHaveLength(1);
    clock.advance();
    expect(order).toEqual(['visible-first', 'visible-second']);
    commits[1]();
    clock.advance();
    expect(order).toEqual(['visible-first', 'visible-second', 'nearby']);
    commits[2]();
    expect(clock.pending).toBe(0);
  });

  it('cancels pending and uncommitted previews without blocking later work', () => {
    const clock = frames();
    const queue = createPreviewMountQueue(clock.schedule);
    const removed = vi.fn();
    const cancelRemoved = queue.request(removed);
    cancelRemoved();
    expect(clock.pending).toBe(0);
    let staleCommit: (() => void) | undefined;
    const cancelStarted = queue.request((commit) => {
      staleCommit = commit;
    });
    const next = vi.fn();
    queue.request(next);
    clock.advance();
    cancelStarted();
    clock.advance();
    expect(next).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
    staleCommit?.();
    queue.clear();
    const afterReset = vi.fn();
    queue.request(afterReset);
    clock.advance();
    expect(afterReset).toHaveBeenCalledTimes(1);
  });

  it('shares admission across nested providers and bypasses the queue for exports', async () => {
    const clock = frames();
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) =>
      clock.schedule(callback),
    );
    vi.stubGlobal('cancelAnimationFrame', (cancel: () => void) => cancel());
    vi.stubGlobal('IntersectionObserver', undefined);
    function Preview({ id, force = false }: { id: string; force?: boolean }) {
      const ready = usePreviewMount({ force });
      return ready ? <span>{id}</span> : null;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <StrictMode>
            <PreviewMountProvider>
              <Preview id="first" />
              <PreviewMountProvider>
                <Preview id="second" />
              </PreviewMountProvider>
              <Preview id="export" force />
            </PreviewMountProvider>
          </StrictMode>,
        ),
      );
      expect(container.textContent).toBe('export');
      await act(async () => clock.advance());
      expect(container.textContent).toBe('firstexport');
      await act(async () => clock.advance());
      expect(container.textContent).toBe('firstsecondexport');
    } finally {
      await act(async () => root.unmount());
      expect(clock.pending).toBe(0);
    }
  });

  it('unmounts passive offscreen previews while retaining admitted editing occurrences', async () => {
    const clock = frames();
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) =>
      clock.schedule(callback),
    );
    vi.stubGlobal('cancelAnimationFrame', (cancel: () => void) => cancel());
    const observations = new Map<
      Element,
      (entry: IntersectionObserverEntry[]) => void
    >();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        private target: Element | undefined;
        constructor(
          private callback: (entry: IntersectionObserverEntry[]) => void,
        ) {}
        observe(target: Element) {
          this.target = target;
          observations.set(target, this.callback);
        }
        disconnect() {
          if (this.target) observations.delete(this.target);
        }
      },
    );
    const observe = (target: Element, visible: boolean) =>
      observations.get(target)?.([
        {
          isIntersecting: visible,
          intersectionRect: { left: 0, top: 0, right: 100, bottom: 100 },
        } as IntersectionObserverEntry,
      ]);
    function Preview({ retain }: { retain: boolean }) {
      const viewport = useRef<HTMLDivElement>(null);
      const ready = usePreviewMount({ viewport, retain });
      return (
        <div ref={viewport} data-retain={String(retain)}>
          {ready && <span>body</span>}
        </div>
      );
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <PreviewMountProvider>
            <Preview retain={false} />
            <Preview retain />
          </PreviewMountProvider>,
        ),
      );
      const [passive, editing] = [...container.children];
      await act(async () => {
        observe(passive, true);
        observe(editing, true);
      });
      await act(async () => clock.advance());
      await act(async () => clock.advance());
      expect(container.querySelectorAll('span')).toHaveLength(2);
      await act(async () => {
        observe(passive, false);
        observe(editing, false);
      });
      expect(passive.textContent).toBe('');
      expect(editing.textContent).toBe('body');
      await act(async () => observe(passive, true));
      await act(async () => clock.advance());
      expect(passive.textContent).toBe('body');
    } finally {
      await act(async () => root.unmount());
      expect(observations.size).toBe(0);
      expect(clock.pending).toBe(0);
    }
  });
});
