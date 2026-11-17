import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { Point } from '@sue/board-core';
import {
  frameControlCursor,
  frameCursorController,
  type FrameCursorController,
  type FrameCursorSource,
} from './frame-control-cursor';
import {
  frameHoverOwner,
  FrameScaleContent,
  type FrameCameraStore,
} from './frame-camera-store';
import type {
  ResolvedPortGroup,
  SelectedEndpointPlan,
} from './frame-port-model';

export function FrameSelectedEndpointLayer({
  camera,
  getPlan,
  renderGroup,
}: {
  camera: FrameCameraStore;
  getPlan(zoom: number): SelectedEndpointPlan;
  renderGroup(group: ResolvedPortGroup, zoom: number): ReactNode;
}) {
  return (
    <FrameScaleContent
      camera={camera}
      render={(zoom) => (
        <g data-selected-edge-endpoints data-frame-export-exclude>
          {getPlan(zoom).groups.map((group) => renderGroup(group, zoom))}
        </g>
      )}
    />
  );
}

export const FRAME_CONTROL_HIT_RADIUS = 18;

type Control = {
  key: string;
  selected: boolean;
  kind: 'port' | 'point' | 'segment';
  cursor: string;
  nodeId?: string;
  endpoint: boolean;
  markRadius: number;
  visible: boolean;
  hover(value: boolean): void;
  enter?(): void;
  leave?(): void;
  down(event: PointerEvent<SVGElement>): void;
};
type ControlEntry = {
  current: Control;
  element?: SVGCircleElement;
  hoverOwner?: string | null;
};
const ControlContext = createContext<{
  add(element: SVGCircleElement, control: ControlEntry): void;
  remove(element: SVGCircleElement): void;
  refresh(control: ControlEntry): void;
} | null>(null);

/** Resolve overlapping targets in screen space, independently of SVG paint order. */
export function FrameControlLayer({
  children,
  camera,
  onNodeBodyPointerDown,
}: {
  children: ReactNode;
  camera?: FrameCameraStore;
  onNodeBodyPointerDown?(
    event: PointerEvent<SVGElement>,
    element: Element,
  ): boolean;
}) {
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const element = useRef<SVGGElement | null>(null);
  const controls = useRef(new Map<SVGCircleElement, ControlEntry>());
  const hovered = useRef<ControlEntry | null>(null);
  const pointer = useRef<Point | null>(null);
  const reconcile = useRef<() => void>(() => {});
  const queued = useRef(false);
  const cursor = useRef<FrameCursorController | null>(null);
  const source = useRef<FrameCursorSource>({
    reconcile: () => {
      if (element.current) reconcile.current();
    },
    leave: () => {},
  });
  const scheduleReconcile = useCallback(() => {
    if (queued.current) return;
    queued.current = true;
    queueMicrotask(() => {
      queued.current = false;
      if (element.current) reconcile.current();
    });
  }, []);
  const applyCursor = useCallback((control: ControlEntry | null) => {
    cursor.current?.hover(source.current, control?.current ?? null);
  }, []);
  const selectHover = (next: ControlEntry | null) => {
    applyCursor(next);
    const target =
      next?.element ??
      (pointer.current
        ? element.current?.ownerDocument.elementFromPoint?.(...pointer.current)
        : null) ??
      null;
    if (next) {
      next.hoverOwner = frameHoverOwner(next.element ?? null);
      if (next.hoverOwner) cameraRef.current?.setHovered(next.hoverOwner, next);
    }
    if (next === hovered.current) return;
    const previous = hovered.current;
    hovered.current = next;
    // Claim the new control before releasing the old one, including controls
    // with different DOM parents which belong to the same cell.
    next?.current.hover(true);
    next?.current.enter?.();
    previous?.current.hover(false);
    if (previous?.hoverOwner)
      cameraRef.current?.leave(previous.hoverOwner, previous, target);
    previous?.current.leave?.();
  };
  source.current.leave = () => {
    if (element.current) selectHover(null);
  };
  const registry = useMemo(
    () => ({
      add: (element: SVGCircleElement, control: ControlEntry) => {
        control.element = element;
        controls.current.set(element, control);
        scheduleReconcile();
      },
      remove: (element: SVGCircleElement) => {
        const control = controls.current.get(element);
        if (control) control.element = undefined;
        controls.current.delete(element);
        scheduleReconcile();
      },
      refresh: (control: ControlEntry) => {
        if (control === hovered.current) applyCursor(control);
        scheduleReconcile();
      },
    }),
    [applyCursor, scheduleReconcile],
  );
  const resolveAt = (point: Point, target?: SVGCircleElement) => {
    const fallback = target && controls.current.get(target);
    const elements =
      element.current?.ownerDocument.elementsFromPoint?.(point[0], point[1]) ??
      (target ? [target] : []);
    const candidates = elements.flatMap((element) => {
      const control = controls.current.get(element as SVGCircleElement);
      if (!control) return [];
      const circle = element as SVGCircleElement;
      const matrix = circle.getScreenCTM?.();
      if (!matrix) return [];
      const x = Number(circle.getAttribute('cx'));
      const y = Number(circle.getAttribute('cy'));
      const distance = Math.hypot(
        matrix.a * x + matrix.c * y + matrix.e - point[0],
        matrix.b * x + matrix.d * y + matrix.f - point[1],
      );
      return distance <= FRAME_CONTROL_HIT_RADIUS + 0.01
        ? [{ control, distance }]
        : [];
    });
    // A node PORT above its selected automatic endpoint must not start a new edge.
    const selectedEndpointNodes = new Set(
      candidates.flatMap(({ control }) =>
        control.current.selected &&
        control.current.endpoint &&
        control.current.nodeId
          ? [control.current.nodeId]
          : [],
      ),
    );
    const eligible = candidates.filter(
      ({ control }) =>
        control.current.endpoint ||
        !control.current.nodeId ||
        !selectedEndpointNodes.has(control.current.nodeId),
    );
    const priority = { port: 0, point: 1, segment: 2 };
    eligible.sort((a, b) =>
      Math.abs(a.distance - b.distance) > 0.01
        ? a.distance - b.distance
        : Number(b.control.current.selected) -
            Number(a.control.current.selected) ||
          priority[a.control.current.kind] - priority[b.control.current.kind] ||
          a.control.current.key.localeCompare(b.control.current.key),
    );
    return eligible[0]?.control ?? fallback ?? null;
  };
  reconcile.current = () => {
    if (pointer.current && element.current?.ownerDocument.elementsFromPoint)
      selectHover(resolveAt(pointer.current));
    else if (
      hovered.current &&
      (!hovered.current.element ||
        controls.current.get(hovered.current.element) !== hovered.current)
    )
      selectHover(null);
  };
  useLayoutEffect(() => {
    reconcile.current();
  });
  useLayoutEffect(() => {
    const svg = element.current?.ownerSVGElement;
    if (!svg) return;
    const controller = frameCursorController(svg);
    const owner = source.current;
    cursor.current = controller;
    const detach = controller.attach();
    const record = (event: globalThis.PointerEvent) => {
      pointer.current = [event.clientX, event.clientY];
      // Captured pointer moves target the root SVG, not the physical hot region.
      // Reconcile only a layer with an active hover, without scanning other layers.
      if (hovered.current && !element.current?.contains(event.target as Node))
        scheduleReconcile();
    };
    const leave = () => {
      pointer.current = null;
      selectHover(null);
    };
    svg.addEventListener('pointermove', record, true);
    svg.addEventListener('pointerdown', record, true);
    svg.addEventListener('pointerleave', leave);
    return () => {
      svg.removeEventListener('pointermove', record, true);
      svg.removeEventListener('pointerdown', record, true);
      svg.removeEventListener('pointerleave', leave);
      pointer.current = null;
      selectHover(null);
      controller.remove(owner);
      cursor.current = null;
      detach();
    };
    // Callbacks read current registered controls; the canvas SVG owns this lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const resolve = (event: PointerEvent<SVGGElement>) => {
    pointer.current = [event.clientX, event.clientY];
    return resolveAt(pointer.current, event.target as SVGCircleElement);
  };
  const move = (event: PointerEvent<SVGGElement>) => {
    const control = resolve(event);
    selectHover(control);
  };
  return (
    <ControlContext.Provider value={registry}>
      <g
        ref={element}
        data-frame-control-layer
        onPointerOverCapture={move}
        onPointerMoveCapture={move}
        onPointerLeave={scheduleReconcile}
        onPointerDownCapture={(event) => {
          const control = resolve(event);
          if (control) {
            const hit = control.element;
            const matrix = hit?.getScreenCTM?.();
            const distance =
              hit && matrix
                ? Math.hypot(
                    matrix.a * Number(hit.getAttribute('cx')) +
                      matrix.c * Number(hit.getAttribute('cy')) +
                      matrix.e -
                      event.clientX,
                    matrix.b * Number(hit.getAttribute('cx')) +
                      matrix.d * Number(hit.getAttribute('cy')) +
                      matrix.f -
                      event.clientY,
                  )
                : 0;
            // Enlarged port padding must not consume the body of a selected
            // movable node. The visible mark remains a dedicated control.
            if (
              onNodeBodyPointerDown &&
              control.current.kind === 'port' &&
              !control.current.endpoint &&
              (!control.current.visible ||
                distance > control.current.markRadius + 0.5)
            ) {
              const bodies =
                element.current?.ownerDocument.elementsFromPoint?.(
                  event.clientX,
                  event.clientY,
                ) ?? [];
              const body = bodies
                .map((item) => item.closest('[data-cell-id]'))
                .find(Boolean);
              if (body && onNodeBodyPointerDown(event, body)) {
                selectHover(null);
                return;
              }
            }
            selectHover(control);
            control.current.down(event);
            if (
              event.button === 0 &&
              event.defaultPrevented &&
              control.current.cursor !== 'not-allowed'
            )
              cursor.current?.lock(
                source.current,
                control.current,
                event.pointerId,
              );
          }
        }}
      >
        {children}
      </g>
    </ControlContext.Provider>
  );
}

/** Subscribe only controls affected by hover, connection targets or camera scale. */
export function FramePortSubscription({
  camera,
  ids,
  children,
}: {
  camera: FrameCameraStore;
  ids: readonly string[];
  children(
    zoom: number,
    hoveredId: string | null,
    connectionTargetId: string | null,
  ): ReactNode;
}) {
  const subscribe = useMemo(
    () => (notify: () => void) => {
      const subscriptions = ids.map((id) => camera.subscribeCell(id, notify));
      return () => subscriptions.forEach((unsubscribe) => unsubscribe());
    },
    [camera, ids],
  );
  const snapshot = () => {
    const hovered = ids.includes(camera.getHoveredId() ?? '')
      ? camera.getHoveredId()
      : null;
    const target = ids.includes(camera.getConnectionTargetId() ?? '')
      ? camera.getConnectionTargetId()
      : null;
    return JSON.stringify([camera.getZoom(), hovered, target]);
  };
  const [zoom, hovered, target] = JSON.parse(
    useSyncExternalStore(subscribe, snapshot, snapshot),
  ) as [number, string | null, string | null];
  return children(zoom, hovered, target);
}

/** The visible mark and the screen-sized hit target are intentionally independent. */
export function FrameControlHandle({
  point,
  scale,
  radius = 6,
  square,
  cursor = 'move',
  visible = true,
  selected = false,
  kind = 'port',
  controlKey,
  nodeId,
  endpoint = false,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  attributes,
}: {
  point: Point;
  scale: number;
  radius?: number;
  square?: boolean;
  cursor?: string;
  visible?: boolean;
  selected?: boolean;
  kind?: Control['kind'];
  controlKey: string;
  nodeId?: string;
  endpoint?: boolean;
  attributes?: Record<string, string | undefined>;
  onPointerDown(event: PointerEvent<SVGElement>): void;
  onPointerEnter?(): void;
  onPointerLeave?(): void;
}) {
  const layer = useContext(ControlContext);
  const [hovered, setHovered] = useState(false);
  const entry = useRef<ControlEntry>({ current: null! });
  entry.current.current = {
    key: controlKey,
    selected,
    kind,
    cursor,
    nodeId,
    endpoint,
    markRadius: radius * (hovered ? 1.5 : 1),
    visible: visible || hovered,
    hover: setHovered,
    enter: onPointerEnter,
    leave: onPointerLeave,
    down: onPointerDown,
  };
  useLayoutEffect(() => {
    layer?.refresh(entry.current);
  }, [layer, cursor]);
  const element = useRef<SVGCircleElement | null>(null);
  const register = useCallback(
    (node: SVGCircleElement | null) => {
      if (element.current) layer?.remove(element.current);
      element.current = node;
      if (node) layer?.add(node, entry.current);
    },
    [layer],
  );
  const factor = Math.max(1e-8, scale);
  const markRadius = (radius * (hovered ? 1.5 : 1)) / factor;
  return (
    <g data-control-hovered={hovered ? 'true' : 'false'}>
      <circle
        ref={register}
        {...attributes}
        data-control-hit={controlKey}
        cx={point[0]}
        cy={point[1]}
        r={FRAME_CONTROL_HIT_RADIUS / factor}
        fill="transparent"
        stroke="none"
        pointerEvents="all"
        style={{
          cursor: `var(--frame-control-cursor, ${frameControlCursor(cursor)})`,
        }}
      />
      <g
        data-control-mark
        visibility={visible || hovered ? undefined : 'hidden'}
        fill="#fff"
        stroke="#6366f1"
        strokeWidth={1 / factor}
        pointerEvents="none"
      >
        {square ? (
          <rect
            x={point[0] - markRadius}
            y={point[1] - markRadius}
            width={2 * markRadius}
            height={2 * markRadius}
          />
        ) : (
          <circle cx={point[0]} cy={point[1]} r={markRadius} />
        )}
      </g>
    </g>
  );
}
