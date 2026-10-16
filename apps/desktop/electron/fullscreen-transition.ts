/** HTML fullscreen resolves before macOS finishes its native window animation. */
export function createFullscreenTransition() {
  let pending = false;
  const waiters = new Set<() => void>();
  return {
    begin() {
      pending = true;
    },
    settle() {
      pending = false;
      for (const resolve of waiters) resolve();
      waiters.clear();
    },
    ready(): Promise<void> {
      return pending
        ? new Promise((resolve) => waiters.add(resolve))
        : Promise.resolve();
    },
  };
}
