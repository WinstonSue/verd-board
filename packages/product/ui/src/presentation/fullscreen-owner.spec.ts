import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exitPresentationFullscreen,
  requestPresentationFullscreen,
} from './fullscreen-owner';

const originalElement = Object.getOwnPropertyDescriptor(
  document,
  'fullscreenElement',
);
const originalExit = Object.getOwnPropertyDescriptor(
  document,
  'exitFullscreen',
);
const originalDesktop = Object.getOwnPropertyDescriptor(window, 'electronAPI');
beforeEach(() => {
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => null,
  });
  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    writable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const [key, descriptor] of [
    ['fullscreenElement', originalElement],
    ['exitFullscreen', originalExit],
  ] as const) {
    if (descriptor) Object.defineProperty(document, key, descriptor);
    else Reflect.deleteProperty(document, key);
  }
  if (originalDesktop)
    Object.defineProperty(window, 'electronAPI', originalDesktop);
  else Reflect.deleteProperty(window, 'electronAPI');
});

describe('presentation fullscreen ownership', () => {
  it('waits for entry before leaving and coalesces parent and unmount cleanup', async () => {
    const root = document.createElement('div');
    let entered!: () => void;
    let exited!: () => void;
    root.requestFullscreen = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          entered = resolve;
        }),
    );
    vi.spyOn(document, 'fullscreenElement', 'get').mockReturnValue(root);
    const exit = vi.spyOn(document, 'exitFullscreen').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          exited = resolve;
        }),
    );
    requestPresentationFullscreen(root);
    exitPresentationFullscreen(root);
    exitPresentationFullscreen(root);
    expect(exit).not.toHaveBeenCalled();
    entered();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1));
    exitPresentationFullscreen(root);
    expect(exit).toHaveBeenCalledTimes(1);
    exited();
    await Promise.resolve();
  });

  it('leaves a rejected entry as a pane fallback without exiting another owner', async () => {
    const root = document.createElement('div');
    root.requestFullscreen = vi.fn(() => Promise.reject(new Error('denied')));
    vi.spyOn(document, 'fullscreenElement', 'get').mockReturnValue(
      document.body,
    );
    const exit = vi.spyOn(document, 'exitFullscreen').mockResolvedValue();
    requestPresentationFullscreen(root);
    exitPresentationFullscreen(root);
    await Promise.resolve();
    await Promise.resolve();
    expect(exit).not.toHaveBeenCalled();
  });

  it('waits for the native desktop transition even after HTML entry resolves', async () => {
    const root = document.createElement('div');
    root.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    let nativeEntered!: () => void;
    const ready = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          nativeEntered = resolve;
        }),
    );
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { whenFullscreenReady: ready },
    });
    vi.spyOn(document, 'fullscreenElement', 'get').mockReturnValue(root);
    const exit = vi
      .spyOn(document, 'exitFullscreen')
      .mockResolvedValue(undefined);
    requestPresentationFullscreen(root);
    await Promise.resolve();
    expect(ready).toHaveBeenCalledTimes(1);
    exitPresentationFullscreen(root);
    expect(exit).not.toHaveBeenCalled();
    nativeEntered();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1));
  });
});
