import {
  isValidElement,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { Viewport } from '@sue/board-core';

/** Canvas-local, published camera; input accumulation stays in the canvas ref. */
export function createFrameCameraStore(initial: Viewport, frameId: string) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  let hoveredId: string | null = null;
  const cellListeners = new Map<string, Set<() => void>>();
  return {
    frameId,
    getSnapshot: () => snapshot,
    getZoom: () => snapshot.zoom ?? 1,
    getHoveredId: () => hoveredId,
    isHovered: (id?: string) => id != null && hoveredId === id,
    setHovered(id: string | null) {
      if (id === hoveredId) return;
      const previous = hoveredId;
      hoveredId = id;
      if (previous) cellListeners.get(previous)?.forEach((notify) => notify());
      if (id) cellListeners.get(id)?.forEach((notify) => notify());
    },
    leave(id: string) {
      if (hoveredId !== id) return;
      hoveredId = null;
      cellListeners.get(id)?.forEach((notify) => notify());
    },
    subscribeCell(id: string | undefined, listener: () => void) {
      listeners.add(listener);
      let cells: Set<() => void> | undefined;
      if (id) {
        cells = cellListeners.get(id);
        if (!cells) cellListeners.set(id, (cells = new Set()));
        cells.add(listener);
      }
      return () => {
        listeners.delete(listener);
        cells?.delete(listener);
        if (id && !cells?.size) cellListeners.delete(id);
      };
    },
    subscribeZoom: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(next: Viewport) {
      const previousZoom = snapshot.zoom ?? 1;
      snapshot = {
        zoom: next.zoom ?? 1,
        origination: [...(next.origination ?? [0, 0])],
      };
      if (previousZoom !== snapshot.zoom)
        listeners.forEach((listener) => listener());
    },
  };
}

export type FrameCameraStore = ReturnType<typeof createFrameCameraStore>;

function createZoomSelector<T>(
  camera: FrameCameraStore,
  compute: (zoom: number) => T,
  same: (previous: T, next: T) => boolean,
  cellId?: string,
) {
  let initialized = false;
  let zoom = 1;
  let snapshot: T;
  let hovered = false;
  return () => {
    const nextZoom = camera.getZoom();
    const nextHovered = camera.isHovered(cellId);
    if (initialized && Object.is(zoom, nextZoom) && hovered === nextHovered)
      return snapshot;
    const next = compute(nextZoom);
    if (!initialized || !same(snapshot, next)) snapshot = next;
    zoom = nextZoom;
    hovered = nextHovered;
    initialized = true;
    return snapshot;
  };
}

const memoType = Symbol.for('react.memo');
const unavailableRef = Symbol('unavailable-ref');

function usesShallowProps(element: ReactElement): boolean {
  const type: unknown = element.type;
  if (typeof type === 'string') return true;
  if (!type || typeof type !== 'object') return false;
  const memo = type as { $$typeof?: unknown; compare?: unknown };
  return memo.$$typeof === memoType && memo.compare == null;
}

function elementRef(element: ReactElement): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(element, 'ref');
  // React 18 keeps ref on the element; React 19 exposes it through props and
  // has a deprecated warning getter on the element. Never invoke that getter.
  if (descriptor && 'value' in descriptor) return descriptor.value ?? null;
  const props = element.props;
  if (props && typeof props === 'object') {
    const prop = Object.getOwnPropertyDescriptor(props, 'ref');
    if (prop && 'value' in prop) return prop.value ?? null;
  }
  return descriptor?.get ? unavailableRef : null;
}

function shallowProps(previous: unknown, next: unknown): boolean {
  if (Object.is(previous, next)) return true;
  if (
    !previous ||
    !next ||
    typeof previous !== 'object' ||
    typeof next !== 'object'
  )
    return false;
  const left = previous as Record<string, unknown>;
  const right = next as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) => Object.hasOwn(right, key) && Object.is(left[key], right[key]),
    )
  );
}

function sameScaleContent(previous: ReactNode, next: ReactNode): boolean {
  if (Object.is(previous, next)) return true;
  if (
    !isValidElement(previous) ||
    !isValidElement(next) ||
    previous.type !== next.type ||
    previous.key !== next.key ||
    !usesShallowProps(next)
  )
    return false;
  const ref = elementRef(previous);
  return (
    ref !== unavailableRef &&
    Object.is(ref, elementRef(next)) &&
    shallowProps(previous.props, next.props)
  );
}

/** Only scale-sensitive leaves subscribe, never the scene's recursive builder. */
export function FrameScaleContent({
  camera,
  cellId,
  render,
  onVisibilityCommit,
}: {
  camera: FrameCameraStore;
  cellId?: string;
  render(zoom: number): ReactNode;
  onVisibilityCommit?(): void;
}) {
  const getSnapshot = useMemo(
    () => createZoomSelector(camera, render, sameScaleContent, cellId),
    [camera, render, cellId],
  );
  const subscribe = useMemo(
    () => (notify: () => void) => camera.subscribeCell(cellId, notify),
    [camera, cellId],
  );
  const content = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const visible = content != null && content !== false;
  const previousVisibility = useRef(visible);
  useLayoutEffect(() => {
    if (previousVisibility.current === visible) return;
    previousVisibility.current = visible;
    onVisibilityCommit?.();
  }, [visible, onVisibilityCommit]);
  return content;
}

export interface FrameNodeAppearanceValue {
  bounds: { x: number; y: number; width: number; height: number };
  fill?: string;
  color?: string;
  stroke?: string;
}

function sameAppearance(
  previous: FrameNodeAppearanceValue,
  next: FrameNodeAppearanceValue,
): boolean {
  return (
    Object.is(previous.bounds.x, next.bounds.x) &&
    Object.is(previous.bounds.y, next.bounds.y) &&
    Object.is(previous.bounds.width, next.bounds.width) &&
    Object.is(previous.bounds.height, next.bounds.height) &&
    Object.is(previous.fill, next.fill) &&
    Object.is(previous.color, next.color) &&
    Object.is(previous.stroke, next.stroke)
  );
}

/** Extension callbacks remain live; identical appearance reuses its static JSX. */
export function FrameNodeAppearance({
  camera,
  cellId,
  compute,
  render,
}: {
  camera: FrameCameraStore;
  cellId?: string;
  compute(zoom: number): FrameNodeAppearanceValue;
  render(value: FrameNodeAppearanceValue): ReactNode;
}) {
  const getSnapshot = useMemo(
    () =>
      createZoomSelector(
        camera,
        (zoom) => {
          const value = compute(zoom);
          const { x, y, width, height } = value.bounds;
          return {
            bounds: { x, y, width, height },
            fill: value.fill,
            color: value.color,
            stroke: value.stroke,
          };
        },
        sameAppearance,
        cellId,
      ),
    [camera, compute, cellId],
  );
  const subscribe = useMemo(
    () => (notify: () => void) => camera.subscribeCell(cellId, notify),
    [camera, cellId],
  );
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(() => render(value), [render, value]);
}
