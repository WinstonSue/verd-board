import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import type { RectangleClient } from '@sue/board-core';
import type { FrameCameraStore } from './frame-camera-store';

/** Camera updates affect only the mounted layer, leaving scene geometry cached. */
type VirtualLayerProps = {
  camera: FrameCameraStore;
  svg: RefObject<SVGSVGElement | null>;
  ids: readonly string[];
  query(bounds: RectangleClient): readonly string[];
  pinned: readonly string[];
  enabled: boolean;
  children(id: string): ReactNode;
};
export function FrameVirtualLayer(props: VirtualLayerProps) {
  return props.enabled ? (
    <VirtualLayer {...props} />
  ) : (
    <>{props.ids.map(props.children)}</>
  );
}
function VirtualLayer({
  camera,
  svg,
  ids,
  query,
  pinned,
  enabled,
  children,
}: VirtualLayerProps) {
  const viewport = useSyncExternalStore(
    camera.subscribeViewport,
    camera.getSnapshot,
    camera.getSnapshot,
  );
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [svg]);
  const order = useMemo(
    () => new Map(ids.map((id, index) => [id, index])),
    [ids],
  );
  const renderCache = useMemo(
    () => ({ render: children, nodes: new Map<string, ReactNode>() }),
    [children],
  );
  const rendered = renderCache.nodes;
  const visible = useMemo(() => {
    if (!enabled || !size.width || !size.height) return ids;
    const zoom = viewport.zoom ?? 1,
      origin = viewport.origination ?? [0, 0];
    const margin = 200 / zoom;
    const selected = new Set(
      query({
        x: origin[0] - margin,
        y: origin[1] - margin,
        width: size.width / zoom + 2 * margin,
        height: size.height / zoom + 2 * margin,
      }),
    );
    pinned.forEach((id) => selected.add(id));
    let focused = svg.current?.ownerDocument.activeElement;
    while (focused && focused !== svg.current) {
      const id = focused.getAttribute('data-cell-id');
      if (id) selected.add(id);
      focused = focused.parentElement;
    }
    return [...selected]
      .filter((id) => order.has(id))
      .sort((a, b) => order.get(a)! - order.get(b)!);
  }, [enabled, size, viewport, ids, query, pinned, svg, order]);
  // Keep mounted views immediately, and admit new views in bounded batches.
  const [admitted, setAdmitted] = useState<ReadonlySet<string>>(
    () => new Set(visible.slice(0, 128)),
  );
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false,
      handle = 0;
    const visibleSet = new Set(visible);
    for (const id of rendered.keys())
      if (!visibleSet.has(id)) rendered.delete(id);
    const waiting = visible.filter((id) => !admitted.has(id));
    if (!waiting.length) return;
    let offset = 0;
    const step = () => {
      if (cancelled) return;
      const batch = waiting.slice(offset, (offset += 64));
      setAdmitted(
        (previous) =>
          new Set([
            ...visible.filter((id) => previous.has(id)),
            ...waiting.slice(0, offset),
            ...batch,
          ]),
      );
      if (offset < waiting.length) handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(handle);
    };
    // Each visibility change replaces the queue; stable cell IDs deduplicate jobs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, enabled, rendered]);
  const active = new Set(pinned);
  return (
    <>
      {visible.map((id) =>
        !enabled || admitted.has(id) || active.has(id)
          ? (() => {
              if (!rendered.has(id)) rendered.set(id, children(id));
              return rendered.get(id);
            })()
          : null,
      )}
    </>
  );
}
