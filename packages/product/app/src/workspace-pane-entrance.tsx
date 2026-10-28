import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { NavigationFeedback } from './workspace-navigation-feedback';

/** A pane owns its entrance after readiness; completing loading must not cancel it. */
export function WorkspacePaneEntrance({
  content,
  activeFileId,
  visible,
  ready,
  feedback,
}: {
  content: RefObject<HTMLDivElement | null>;
  activeFileId: string | null;
  visible: boolean;
  ready(): boolean;
  feedback: NavigationFeedback;
}) {
  const latestReady = useRef(ready);
  latestReady.current = ready;
  useLayoutEffect(() => {
    let disposed = false;
    let release = () => {};
    const attach = () => {
      const root = content.current;
      if (disposed || !root || !visible || !activeFileId) return;
      const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      let pane: HTMLElement | null = null;
      let animation: Animation | undefined;
      let frame: number | undefined;
      const clear = () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        animation?.cancel();
        animation = undefined;
        pane?.style.removeProperty('opacity');
      };
      const check = () => {
        const current = root.querySelector<HTMLElement>(
          '.workspace-pane.is-active',
        );
        if (current !== pane) {
          clear();
          pane = current;
          if (pane) {
            pane.dataset['paneEntrance'] = 'preparing';
            pane.style.opacity = motion?.matches ? '1' : '0.55';
          }
        }
        if (!pane) return;
        if (motion?.matches || typeof pane.animate !== 'function') {
          clear();
          pane.dataset['paneEntrance'] = 'complete';
          return;
        }
        if (
          pane.dataset['paneEntrance'] !== 'preparing' ||
          frame !== undefined ||
          !latestReady.current()
        )
          return;
        frame = requestAnimationFrame(() => {
          frame = undefined;
          const target = pane;
          if (
            disposed ||
            !target?.isConnected ||
            !target.classList.contains('is-active') ||
            !latestReady.current()
          )
            return;
          animation = target.animate([{ opacity: 0.55 }, { opacity: 1 }], {
            id: 'workspace-pane-enter',
            duration: 180,
            easing: 'ease-out',
            fill: 'forwards',
          });
          target.dataset['paneEntrance'] = 'running';
          void animation.finished.then(
            () => {
              if (disposed || target !== pane) return;
              target.style.removeProperty('opacity');
              target.dataset['paneEntrance'] = 'complete';
              animation?.cancel();
              animation = undefined;
            },
            () => {},
          );
        });
      };
      const observer = new MutationObserver(check);
      observer.observe(root, { childList: true, subtree: true });
      const unsubscribe = feedback.subscribe(check);
      motion?.addEventListener('change', check);
      check();
      release = () => {
        observer.disconnect();
        unsubscribe();
        motion?.removeEventListener('change', check);
        clear();
      };
    };
    // The parent host ref is attached after child layout effects on first mount.
    // A microtask installs the initial opacity before the browser can paint.
    if (content.current) attach();
    else queueMicrotask(attach);
    return () => {
      disposed = true;
      release();
    };
  }, [content, activeFileId, visible, feedback]);
  return null;
}
