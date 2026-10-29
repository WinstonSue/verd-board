import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';

export function useFramePaintVisibility(
  body: RefObject<HTMLElement | SVGElement | null>,
  {
    exporting = false,
    editing = false,
    viewport,
  }: {
    exporting?: boolean;
    editing?: boolean;
    viewport?: RefObject<Element | null>;
  },
) {
  const near = useRef(true);
  const options = useRef({ exporting, editing });
  options.current = { exporting, editing };
  const update = () => {
    const element = body.current;
    if (!element) return;
    const paused =
      !near.current &&
      !options.current.exporting &&
      !options.current.editing &&
      !element.contains(document.activeElement) &&
      !element.querySelector(
        '[data-frame-text-editor], [data-document-editing]',
      );
    element.style.opacity = paused ? '0' : '';
    if (paused) element.setAttribute('data-frame-paint-paused', '');
    else element.removeAttribute('data-frame-paint-paused');
  };
  useLayoutEffect(update);
  useEffect(() => {
    const element = body.current;
    if (!element || exporting || typeof IntersectionObserver === 'undefined')
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        near.current = entry.isIntersecting;
        update();
      },
      { rootMargin: '200px' },
    );
    observer.observe(viewport?.current ?? element);
    element.addEventListener('focusin', update);
    element.addEventListener('focusout', update);
    return () => {
      observer.disconnect();
      element.removeEventListener('focusin', update);
      element.removeEventListener('focusout', update);
    };
  }, [exporting, viewport]);
}

/** Retain the live editor and its geometry; only skip painting distant content. */
export function FrameContentVisibility({
  children,
  exporting = false,
  editing = false,
}: {
  children: ReactNode;
  exporting?: boolean;
  editing?: boolean;
}) {
  const body = useRef<HTMLDivElement>(null);
  useFramePaintVisibility(body, { exporting, editing });
  return (
    <div ref={body} style={{ width: '100%', height: '100%' }}>
      {children}
    </div>
  );
}
