import { describe, expect, it, vi } from 'vitest';
import { createShutdownCoordinator } from './shutdown';
describe('desktop workspace shutdown', () => {
  it('waits for the matching save acknowledgement and coalesces repeated close requests', () => {
    const request = vi.fn(),
      close = vi.fn(),
      error = vi.fn();
    const state = createShutdownCoordinator(request, close, error);
    state.setReady(true);
    expect(state.shouldPreventClose()).toBe(true);
    expect(state.shouldPreventClose()).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    state.complete(999, true);
    expect(close).not.toHaveBeenCalled();
    state.complete(1, true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(state.shouldPreventClose()).toBe(false);
  });
  it('keeps the window open after failure and permits a fresh save attempt', () => {
    const request = vi.fn(),
      close = vi.fn(),
      error = vi.fn();
    const state = createShutdownCoordinator(request, close, error);
    state.setReady(true);
    state.shouldPreventClose();
    state.complete(1, false, 'disk full');
    expect(close).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('disk full');
    state.shouldPreventClose();
    expect(request).toHaveBeenLastCalledWith(2);
    state.complete(1, true);
    expect(close).not.toHaveBeenCalled();
    state.complete(2, true);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('allows closing before the editor and its save queue have mounted', () => {
    const state = createShutdownCoordinator(vi.fn(), vi.fn(), vi.fn());
    expect(state.shouldPreventClose()).toBe(false);
  });
});
