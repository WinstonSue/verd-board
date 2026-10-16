import { describe, expect, it, vi } from 'vitest';
import { createFullscreenTransition } from './fullscreen-transition';

describe('native fullscreen transition', () => {
  it('holds all exits until native entry settles and permits subsequent transitions', async () => {
    const transition = createFullscreenTransition();
    await transition.ready();
    transition.begin();
    const exit = vi.fn();
    const first = transition.ready().then(exit);
    const second = transition.ready().then(exit);
    await Promise.resolve();
    expect(exit).not.toHaveBeenCalled();
    transition.settle();
    await Promise.all([first, second]);
    expect(exit).toHaveBeenCalledTimes(2);
    transition.begin();
    const closed = transition.ready().then(exit);
    transition.settle();
    await closed;
    expect(exit).toHaveBeenCalledTimes(3);
  });
});
