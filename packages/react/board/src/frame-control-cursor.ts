import { useLayoutEffect, useMemo, type RefObject } from 'react';

// Keep the logical operation separate from its platform cursor representation.
// Use a consistent move image without depending on the platform's cursor theme.
const moveImage = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 1 7 6h3v4H6V7l-5 5 5 5v-3h4v4H7l5 5 5-5h-3v-4h4v3l5-5-5-5v3h-4V6h3Z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
export const FRAME_MOVE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(moveImage)}") 12 12, move`;
export const frameControlCursor = (cursor: string) =>
  cursor === 'move' ? FRAME_MOVE_CURSOR : cursor;

export interface FrameCursorSource {
  reconcile(): void;
  leave(): void;
}
type CursorOwner = { source: FrameCursorSource; key: string; cursor: string };
type CursorGesture = CursorOwner & { pointerId: number };

const controllers = new WeakMap<SVGSVGElement, FrameCursorController>();

/** One writer for the actual canvas cursor, shared by all its control layers. */
export function frameCursorController(svg: SVGSVGElement) {
  let controller = controllers.get(svg);
  if (!controller) {
    controller = createFrameCursorController(svg);
    controllers.set(svg, controller);
  }
  return controller;
}
export type FrameCursorController = ReturnType<
  typeof createFrameCursorController
>;

function createFrameCursorController(svg: SVGSVGElement) {
  let base = '';
  let hover: CursorOwner | null = null;
  let gesture: CursorGesture | null = null;
  let users = 0;
  let restore: (() => void) | undefined;
  const attribute = (name: string, value: string | null) => {
    if (svg.getAttribute(name) === value) return;
    if (value === null) svg.removeAttribute(name);
    else svg.setAttribute(name, value);
  };
  const paint = () => {
    const owner = gesture ?? hover;
    const logical = owner?.cursor ?? base;
    const cursor = logical ? frameControlCursor(logical) : '';
    if (svg.style.cursor !== cursor) svg.style.cursor = cursor;
    const controlCursor = owner ? cursor : '';
    if (
      svg.style.getPropertyValue('--frame-control-cursor') !== controlCursor
    ) {
      if (controlCursor)
        svg.style.setProperty('--frame-control-cursor', controlCursor);
      else svg.style.removeProperty('--frame-control-cursor');
    }
    // Internal diagnostics also let tests correlate the native request with its owner.
    attribute('data-frame-cursor', logical || 'default');
    attribute(
      'data-frame-cursor-mode',
      gesture ? 'gesture' : hover ? 'control' : 'tool',
    );
    attribute('data-frame-cursor-owner', owner?.key ?? null);
  };
  const reconcile = (source: FrameCursorSource | undefined) => {
    queueMicrotask(() => {
      if (users) source?.reconcile();
    });
  };
  const reset = () => {
    const source = hover?.source ?? gesture?.source;
    gesture = null;
    hover = null;
    source?.leave();
    paint();
  };
  return {
    attach() {
      if (users++ === 0) {
        const originalCursor = svg.style.cursor;
        const originalVariable = svg.style.getPropertyValue(
          '--frame-control-cursor',
        );
        const view = svg.ownerDocument.defaultView;
        const release = (event: globalThis.PointerEvent) => {
          if (!gesture || gesture.pointerId !== event.pointerId) return;
          const source = gesture.source;
          gesture = null;
          paint();
          reconcile(source);
        };
        const leave = () => {
          const source = hover?.source;
          hover = null;
          source?.leave();
          paint();
        };
        const lost = (event: globalThis.PointerEvent) => {
          release(event);
        };
        view?.addEventListener('pointerup', release, true);
        view?.addEventListener('pointercancel', reset, true);
        view?.addEventListener('blur', reset);
        svg.addEventListener('pointerleave', leave);
        svg.addEventListener('lostpointercapture', lost);
        restore = () => {
          view?.removeEventListener('pointerup', release, true);
          view?.removeEventListener('pointercancel', reset, true);
          view?.removeEventListener('blur', reset);
          svg.removeEventListener('pointerleave', leave);
          svg.removeEventListener('lostpointercapture', lost);
          svg.style.cursor = originalCursor;
          if (originalVariable)
            svg.style.setProperty('--frame-control-cursor', originalVariable);
          else svg.style.removeProperty('--frame-control-cursor');
          svg.removeAttribute('data-frame-cursor');
          svg.removeAttribute('data-frame-cursor-mode');
          svg.removeAttribute('data-frame-cursor-owner');
        };
        paint();
      }
      return () => {
        if (--users === 0) {
          hover = null;
          gesture = null;
          restore?.();
          restore = undefined;
          controllers.delete(svg);
        }
      };
    },
    setBase(cursor: string | undefined) {
      base = cursor ?? '';
      paint();
    },
    hover(
      source: FrameCursorSource,
      owner: { key: string; cursor: string } | null,
    ) {
      if (owner) hover = { source, ...owner };
      else if (hover?.source === source) hover = null;
      paint();
    },
    lock(
      source: FrameCursorSource,
      owner: { key: string; cursor: string },
      pointerId: number,
    ) {
      gesture = { source, ...owner, pointerId };
      paint();
    },
    remove(source: FrameCursorSource) {
      // DOM migration must not unlock an already accepted pointer gesture.
      if (hover?.source === source) hover = null;
      paint();
    },
    cancel() {
      const source = gesture?.source ?? hover?.source;
      gesture = null;
      // Normal lost-capture cleanup also calls canvas cancellation after pointerup.
      // Keep the current hover until re-hit, instead of briefly painting the tool.
      paint();
      reconcile(source);
    },
  };
}

export function useFrameCursor(
  svg: RefObject<SVGSVGElement | null>,
  base: string | undefined,
) {
  useLayoutEffect(() => {
    if (!svg.current) return;
    return frameCursorController(svg.current).attach();
  }, [svg]);
  useLayoutEffect(() => {
    if (svg.current) frameCursorController(svg.current).setBase(base);
  }, [svg, base]);
  return useMemo(
    () => ({
      setBase(cursor: string | undefined) {
        if (svg.current) frameCursorController(svg.current).setBase(cursor);
      },
      cancel() {
        if (svg.current) frameCursorController(svg.current).cancel();
      },
    }),
    [svg],
  );
}
