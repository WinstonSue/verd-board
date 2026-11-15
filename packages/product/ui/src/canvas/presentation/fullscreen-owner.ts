interface FullscreenOwner {
  entering: Promise<void> | null;
  exiting: Promise<void> | null;
  leave: boolean;
}

const owners = new WeakMap<HTMLElement, FullscreenOwner>();

const leave = (root: HTMLElement, owner: FullscreenOwner) => {
  if (owner.entering || owner.exiting) return;
  if (document.fullscreenElement !== root) {
    if (owners.get(root) === owner) owners.delete(root);
    return;
  }
  owner.exiting = document.exitFullscreen();
  void owner.exiting
    .catch(() => {})
    .finally(() => {
      owner.exiting = null;
      if (owners.get(root) === owner && document.fullscreenElement !== root)
        owners.delete(root);
    });
};

/** Must be called synchronously from the presentation button's user gesture. */
export function requestPresentationFullscreen(root: HTMLElement) {
  const current = owners.get(root);
  if (current && (current.entering || document.fullscreenElement === root)) {
    current.leave = false;
    return;
  }
  if (!root.requestFullscreen) return;
  const owner: FullscreenOwner = {
    entering: null,
    exiting: null,
    leave: false,
  };
  owners.set(root, owner);
  try {
    owner.entering = root.requestFullscreen().then(async () => {
      // Electron/macOS reports HTML entry before the native window animation
      // ends. Leaving during that transition strands the HTML fullscreen state.
      const desktop = (
        window as Window & {
          electronAPI?: { whenFullscreenReady?: () => Promise<void> };
        }
      ).electronAPI;
      await desktop?.whenFullscreenReady?.();
    });
    void owner.entering
      .catch(() => {})
      .finally(() => {
        owner.entering = null;
        if (owner.leave) leave(root, owner);
      });
  } catch {
    owners.delete(root);
  }
}

/** Coalesce parent/unmount cleanup and wait for a pending native entry. */
export function exitPresentationFullscreen(root: HTMLElement | null) {
  if (!root) return;
  const owner = owners.get(root) ?? {
    entering: null,
    exiting: null,
    leave: false,
  };
  owners.set(root, owner);
  owner.leave = true;
  leave(root, owner);
}
