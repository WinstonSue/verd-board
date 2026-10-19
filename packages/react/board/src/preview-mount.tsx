import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

type ScheduleFrame = (callback: () => void) => () => void;

const scheduleFrame: ScheduleFrame = (callback) => {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
};

/** One admission per frame, with the next frame scheduled after React commits. */
export function createPreviewMountQueue(frame: ScheduleFrame = scheduleFrame) {
  type Entry = {
    start(committed: () => void): void;
    priority: number;
    sequence: number;
    cancelled: boolean;
  };
  const pending: Entry[] = [];
  let sequence = 0;
  let running: Entry | undefined;
  let cancelFrame: (() => void) | undefined;
  const finish = (entry: Entry) => {
    if (running !== entry) return;
    running = undefined;
    schedule();
  };
  const schedule = () => {
    if (cancelFrame || running || !pending.length) return;
    cancelFrame = frame(() => {
      cancelFrame = undefined;
      pending.sort(
        (a, b) => a.priority - b.priority || a.sequence - b.sequence,
      );
      const entry = pending.shift();
      if (!entry) return;
      running = entry;
      try {
        entry.start(() => finish(entry));
      } catch (error) {
        finish(entry);
        throw error;
      }
    });
  };
  return {
    request(start: Entry['start'], priority = 0) {
      const entry: Entry = {
        start,
        priority,
        sequence: sequence++,
        cancelled: false,
      };
      pending.push(entry);
      schedule();
      return () => {
        if (entry.cancelled) return;
        entry.cancelled = true;
        const index = pending.indexOf(entry);
        if (index >= 0) pending.splice(index, 1);
        finish(entry);
        if (!pending.length && !running) {
          cancelFrame?.();
          cancelFrame = undefined;
        }
      };
    },
    clear() {
      pending.length = 0;
      running = undefined;
      cancelFrame?.();
      cancelFrame = undefined;
    },
  };
}

const PreviewMountContext = createContext<ReturnType<
  typeof createPreviewMountQueue
> | null>(null);

/** Nested canvases and document portals share their workspace's admission queue. */
export function PreviewMountProvider({ children }: { children: ReactNode }) {
  const inherited = useContext(PreviewMountContext);
  const local = useMemo(createPreviewMountQueue, []);
  useEffect(() => () => local.clear(), [local]);
  return (
    <PreviewMountContext.Provider value={inherited ?? local}>
      {children}
    </PreviewMountContext.Provider>
  );
}

export function usePreviewMount({
  active = true,
  force = false,
  viewport,
  retain = false,
}: {
  active?: boolean;
  force?: boolean;
  viewport?: RefObject<HTMLElement | null>;
  /** Editing occurrences keep their runtime after first admission. */
  retain?: boolean;
} = {}): boolean {
  const queue = useContext(PreviewMountContext);
  const [visibility, setVisibility] = useState({ near: false, visible: false });
  const [admitted, setAdmitted] = useState(false);
  const committed = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (force || !active || (retain && admitted)) return;
    if (typeof IntersectionObserver === 'undefined' || !viewport) {
      setVisibility({ near: true, visible: true });
      return;
    }
    const target = viewport.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const rect = entry.intersectionRect;
        const near = entry.isIntersecting;
        const visible =
          near &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < window.innerWidth &&
          rect.top < window.innerHeight;
        setVisibility((previous) =>
          previous.near === near && previous.visible === visible
            ? previous
            : { near, visible },
        );
      },
      { rootMargin: '400px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [active, force, viewport, retain, admitted]);
  const eligible = active && (visibility.near || (retain && admitted));
  useEffect(() => {
    if (force) return;
    if (!eligible) {
      setAdmitted(false);
      return;
    }
    if (admitted) return;
    if (!queue) {
      setAdmitted(true);
      return;
    }
    return queue.request(
      (complete) => {
        committed.current = complete;
        setAdmitted(true);
      },
      visibility.visible ? 0 : 1,
    );
  }, [queue, force, eligible, admitted, visibility.visible]);
  useLayoutEffect(() => {
    if (!admitted) return;
    committed.current?.();
    committed.current = null;
  }, [admitted]);
  return force || (eligible && admitted);
}
