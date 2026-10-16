import {
  createContext,
  useContext,
  useLayoutEffect,
  type RefObject,
} from 'react';
const owners = new WeakMap<Element, object>();

/** Private ownership: canvas descendants and explicitly registered editor portals. */
export function createFrameWheelOwner(handle: (event: WheelEvent) => void) {
  const handled = new WeakSet<Event>();
  const owner = {};
  return {
    register(root: Element) {
      owners.set(root, owner);
      const wheel = (event: WheelEvent) => {
        const nearest = event
          .composedPath()
          .find((node) => node instanceof Element && owners.has(node));
        if (nearest !== root) return;
        if (handled.has(event)) return;
        handled.add(event);
        if (!event.ctrlKey && !event.metaKey && canScrollContent(event, root))
          return;
        event.preventDefault();
        handle(event);
      };
      root.addEventListener('wheel', wheel as EventListener, {
        capture: true,
        passive: false,
      });
      return () => {
        root.removeEventListener('wheel', wheel as EventListener, true);
        if (owners.get(root) === owner) owners.delete(root);
      };
    },
  };
}

function canScrollContent(event: WheelEvent, root: Element) {
  let node = event.target instanceof Element ? event.target : null;
  // The common SVG path does not need style or layout reads.
  if (!(node instanceof HTMLElement)) return false;
  while (node && root.contains(node)) {
    if (node instanceof HTMLElement) {
      const style = getComputedStyle(node);
      const remaining = (delta: number, offset: number, extent: number) =>
        delta < 0 ? offset > 0 : delta > 0 && offset < extent - 1;
      if (
        (/^(auto|scroll)$/.test(style.overflowX) &&
          remaining(
            event.deltaX,
            node.scrollLeft,
            node.scrollWidth - node.clientWidth,
          )) ||
        (/^(auto|scroll)$/.test(style.overflowY) &&
          remaining(
            event.deltaY,
            node.scrollTop,
            node.scrollHeight - node.clientHeight,
          ))
      )
        return true;
    }
    if (node === root) break;
    node = node.parentElement;
  }
  return false;
}

export const FrameWheelContext = createContext<ReturnType<
  typeof createFrameWheelOwner
> | null>(null);

export function useFrameWheelPortal(ref: RefObject<HTMLElement | null>) {
  const owner = useContext(FrameWheelContext);
  useLayoutEffect(() => {
    if (ref.current && owner) return owner.register(ref.current);
    return undefined;
  });
}
