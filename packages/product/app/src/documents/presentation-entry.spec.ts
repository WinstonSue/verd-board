import { expect, it, vi } from 'vitest';
import type { ActionResult } from '@sue/board-common';
import { enterDocumentPresentation } from './presentation-entry';

it.each(['completed', 'rejected', 'stale', 'thrown'] as const)(
  'waits for editing and handles %s without losing the fullscreen gesture',
  async (outcome) => {
    let finish!: (result: ActionResult) => void;
    let fail!: (reason: Error) => void;
    const editing = new Promise<ActionResult>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const requestFullscreen = vi.fn();
    const enter = vi.fn();
    const cancel = vi.fn();
    const onError = vi.fn();
    const work = enterDocumentPresentation({
      requestFullscreen,
      flushEditing: () => editing,
      isCurrent: () => outcome !== 'stale',
      enter,
      cancel,
      onError,
    });
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(enter).not.toHaveBeenCalled();
    if (outcome === 'thrown') fail(new Error('Commit failed'));
    else
      finish(
        outcome === 'rejected'
          ? { status: 'rejected', code: 'write-failed' }
          : { status: 'completed' },
      );
    const result = await work;
    expect(enter).toHaveBeenCalledTimes(outcome === 'completed' ? 1 : 0);
    expect(cancel).toHaveBeenCalledTimes(outcome === 'completed' ? 0 : 1);
    expect(result.status).toBe(
      outcome === 'stale'
        ? 'cancelled'
        : outcome === 'thrown'
          ? 'rejected'
          : outcome,
    );
    expect(onError).toHaveBeenCalledTimes(
      ['rejected', 'thrown'].includes(outcome) ? 1 : 0,
    );
  },
);
