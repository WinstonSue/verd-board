import {
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import {
  NAVIGATION_LOADING_DELAY,
  type NavigationFeedback,
} from './workspace-navigation-feedback';

export function WorkspaceNavigationProgress({
  feedback,
  content,
  ready,
  locale,
}: {
  feedback: NavigationFeedback;
  content: RefObject<HTMLDivElement | null>;
  ready(): boolean;
  locale: 'zh' | 'en';
}) {
  const state = useSyncExternalStore(
    feedback.subscribe,
    feedback.getState,
    feedback.getState,
  );
  const ticket = state?.ticket;
  const progress = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = progress.current;
    if (!ticket || !element || typeof element.animate !== 'function') return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animations: Animation[] = [];
    const start = () => {
      animations.forEach((animation) => animation.cancel());
      animations = [];
      if (motion.matches) return;
      const delay = Math.max(
        0,
        NAVIGATION_LOADING_DELAY - (performance.now() - ticket.startedAt),
      );
      // Prepare compositor animations before cold work starts. Each request owns
      // its animations, so replacing an already visible loading strip resets it.
      animations.push(
        element.animate([{ opacity: 0 }, { opacity: 1 }], {
          delay,
          duration: 1,
          fill: 'both',
        }),
      );
      const segment = element.firstElementChild as HTMLElement | null;
      if (segment)
        animations.push(
          segment.animate(
            [
              { transform: 'translateX(-100%)' },
              { transform: 'translateX(390%)' },
            ],
            {
              delay,
              duration: 1100,
              iterations: Infinity,
              easing: 'ease-in-out',
              fill: 'both',
            },
          ),
        );
    };
    start();
    motion.addEventListener('change', start);
    return () => {
      animations.forEach((animation) => animation.cancel());
      motion.removeEventListener('change', start);
    };
  }, [ticket]);
  useLayoutEffect(() => {
    const root = content.current;
    if (!root) return;
    root.setAttribute('aria-busy', ticket ? 'true' : 'false');
    if (!ticket) return;
    let first: number | undefined;
    let second: number | undefined;
    const check = () => {
      if (first !== undefined || !feedback.canPaint(ticket) || !ready()) return;
      first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => {
          first = undefined;
          if (feedback.canPaint(ticket) && ready()) feedback.painted(ticket);
        });
      });
    };
    const observer = new MutationObserver(check);
    observer.observe(root, { childList: true, subtree: true });
    check();
    return () => {
      observer.disconnect();
      if (first !== undefined) cancelAnimationFrame(first);
      if (second !== undefined) cancelAnimationFrame(second);
    };
  }, [feedback, content, ticket, state?.revision, ready]);
  return (
    <div
      ref={progress}
      className={`workspace-navigation-progress${ticket ? ' is-pending' : ''}`}
      data-testid="workspace-navigation-progress"
      data-loading={state?.loading ? 'true' : 'false'}
      role="progressbar"
      aria-label={locale === 'zh' ? '正在打开…' : 'Opening…'}
      aria-hidden={!state?.loading}
    >
      <span />
    </div>
  );
}
