import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionRegistry } from '@sue/board-common';
import {
  createNavigationFeedback,
  navigationPaintOpportunity,
  withNavigationFeedback,
} from './workspace-navigation-feedback';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('workspace navigation feedback', () => {
  it('does not show loading for a fast switch and never delays completion to finish an animation', () => {
    const feedback = createNavigationFeedback();
    const session = {};
    const ticket = feedback.begin({
      session,
      sourceFileId: 'a',
      targetFileId: 'b',
    });
    vi.advanceTimersByTime(90);
    feedback.settle(ticket, { status: 'completed' });
    expect(feedback.getState()?.loading).toBe(false);
    expect(feedback.canPaint(ticket)).toBe(false);
    feedback.commit(session, 'b');
    expect(feedback.canPaint(ticket)).toBe(true);
    feedback.painted(ticket);
    expect(feedback.getState()).toBeNull();
    vi.advanceTimersByTime(500);
    expect(feedback.getState()).toBeNull();
    expect(ticket.controller.signal.aborted).toBe(false);
  });

  it('shows loading only after 300ms and waits for both positioning and the target paint', () => {
    const feedback = createNavigationFeedback();
    const session = {};
    const ticket = feedback.begin({
      session,
      sourceFileId: 'a',
      targetFileId: 'b',
    });
    feedback.waitForNavigation(ticket, 7);
    feedback.settle(ticket, { status: 'completed' });
    feedback.commit(session, 'b');
    vi.advanceTimersByTime(299);
    expect(feedback.getState()?.loading).toBe(false);
    vi.advanceTimersByTime(1);
    expect(feedback.getState()?.loading).toBe(true);
    expect(feedback.canPaint(ticket)).toBe(false);
    feedback.navigationResult(6, 'revealed');
    expect(feedback.canPaint(ticket)).toBe(false);
    feedback.navigationResult(7, 'revealed');
    expect(feedback.canPaint(ticket)).toBe(true);
    feedback.painted(ticket);
    expect(feedback.getState()).toBeNull();
  });

  it('ignores superseded callbacks and clears failures, cancellation and workspace changes', () => {
    const feedback = createNavigationFeedback();
    const session = {};
    const old = feedback.begin({
      session,
      sourceFileId: 'a',
      targetFileId: 'b',
    });
    const latest = feedback.begin({
      session,
      sourceFileId: 'a',
      targetFileId: 'c',
    });
    expect(old.controller.signal.aborted).toBe(true);
    feedback.settle(old, { status: 'failed', code: 'old-failure' });
    feedback.painted(old);
    feedback.cancel(old);
    expect(feedback.current()).toBe(latest);
    feedback.settle(latest, {
      status: 'rejected',
      code: 'editing-flush-failed',
    });
    expect(feedback.getState()).toBeNull();
    const missing = feedback.begin({
      session,
      sourceFileId: 'a',
      targetFileId: 'missing',
    });
    feedback.waitForNavigation(missing, 8);
    feedback.navigationResult(8, 'unavailable');
    expect(feedback.getState()).toBeNull();
    feedback.begin({ session, sourceFileId: 'a', targetFileId: 'b' });
    feedback.commit({}, 'b');
    expect(feedback.getState()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows an empty group or error surface to complete without an editor', () => {
    const feedback = createNavigationFeedback();
    const session = {};
    const ticket = feedback.begin({
      session,
      sourceFileId: 'a',
      targetFileId: null,
    });
    feedback.commit(session, null);
    feedback.settle(ticket, { status: 'completed' });
    feedback.painted(ticket);
    expect(feedback.getState()).toBeNull();
  });

  it('begins before captured editing barriers and only the latest navigation can execute', async () => {
    const feedback = createNavigationFeedback();
    const session = {};
    let context = 'source-a';
    let release!: () => void;
    const oldFlush = new Promise<void>((resolve) => {
      release = resolve;
    });
    const executed: string[] = [];
    const raw = createActionRegistry({ getContext: () => context });
    raw.register<string>({
      id: 'open',
      label: 'Open',
      effect: 'view',
      concurrency: 'queue',
      async beforeQueue(source, target) {
        expect(feedback.current()?.targetFileId).toBe(target);
        expect(source).toBe('source-a');
        if (target === 'b') await oldFlush;
      },
      execute(_source, target) {
        executed.push(target);
        return { status: 'completed' };
      },
    });
    raw.seal();
    const actions = withNavigationFeedback(
      raw,
      feedback,
      (_id, args) => ({
        session,
        sourceFileId: 'a',
        targetFileId: String(args),
      }),
      () => 'c',
      new Set(['open']),
    );
    const captured = actions.actions()[0].capture();
    context = 'source-after-menu';
    const first = captured.execute('b');
    const second = captured.execute('c');
    expect((await first).status).toBe('cancelled');
    expect((await second).status).toBe('completed');
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(executed).toEqual(['c']);
    expect(feedback.current()?.targetFileId).toBe('c');
    actions.dispose();
    expect(feedback.getState()).toBeNull();
  });

  it('gives cold mounts a paint opportunity and cancels before deferred work starts', async () => {
    const controller = new AbortController();
    const painted = navigationPaintOpportunity(controller.signal);
    controller.abort();
    expect(await painted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const feedback = createNavigationFeedback();
    const raw = createActionRegistry({ getContext: () => ({}) });
    const execute = vi.fn(() => ({ status: 'completed' as const }));
    raw.register({ id: 'open', label: 'Open', effect: 'view', execute });
    const session = {};
    const actions = withNavigationFeedback(
      raw,
      feedback,
      () => ({ session, sourceFileId: 'a', targetFileId: 'b', cold: true }),
      () => 'b',
    );
    const work = actions.executeAction('open');
    expect(execute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(17);
    expect((await work).status).toBe('completed');
    expect(execute).toHaveBeenCalledOnce();
    feedback.cancel();
  });
});
