import { createPortal } from 'react-dom';
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { NodeGeometry } from '@sue/board-core';
import type { FrameCameraStore } from './frame-camera-store';
import { FrameInteractionStroke } from './frame-interaction-stroke';

const emptyEdges: readonly string[] = [];
const primitives = 'path,rect,ellipse,circle,line,polyline,polygon';

/** SVG computed inheritance is not implemented by all hosts (including jsdom). */
function paintValue(
  element: SVGElement,
  property: string,
  attribute: string,
  fallback: string,
) {
  const computed = getComputedStyle(element).getPropertyValue(property);
  if (computed) return computed;
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    const value =
      (current as SVGElement).style?.getPropertyValue(property) ||
      current.getAttribute(attribute);
    if (value != null && value !== '') return value;
  }
  return fallback;
}

/**
 * Copy resolved SVG contours outside authored opacity, without a renderer API change.
 * Paint in the cell's dedicated slot so controls stay above the interaction layer.
 */
export function FrameNodeInteraction({
  camera,
  cellId,
  edgeIds = emptyEdges,
  bounds,
  relatedSelected,
  primary,
  scale,
  baseWidth,
  enabled = true,
  kind = 'node',
  children,
}: {
  camera: FrameCameraStore;
  cellId: string;
  edgeIds?: readonly string[];
  bounds: NodeGeometry;
  relatedSelected: boolean;
  primary: boolean;
  scale: number;
  baseWidth: number;
  enabled?: boolean;
  kind?: 'node' | 'edge';
  children: ReactNode;
}) {
  const body = useRef<SVGGElement>(null);
  const subscribe = useMemo(
    () => (notify: () => void) => {
      const subscriptions = [cellId, ...edgeIds].map((id) =>
        camera.subscribeCell(id, notify),
      );
      return () => subscriptions.forEach((unsubscribe) => unsubscribe());
    },
    [camera, cellId, edgeIds],
  );
  const getSnapshot = () => {
    const level = !enabled
      ? 0
      : primary
        ? 2
        : relatedSelected ||
            camera.isHovered(cellId) ||
            edgeIds.some((id) => camera.isHovered(id))
          ? 1
          : 0;
    return `${level}:${camera.getZoom()}`;
  };
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [level, zoom] = snapshot.split(':').map(Number);
  const [drawing, setDrawing] = useState<{
    markup: string;
    width: number;
    target: SVGGElement | null;
  }>({ markup: '', width: baseWidth, target: null });
  const [paintRevision, setPaintRevision] = useState(0);
  useLayoutEffect(() => {
    if (!level || !body.current) {
      setDrawing((previous) =>
        previous.markup
          ? { markup: '', width: baseWidth, target: null }
          : previous,
      );
      return;
    }
    const host = body.current;
    const target =
      Array.from(
        host.querySelectorAll<SVGGElement>(
          '[data-frame-node-interaction-slot]',
        ),
      ).find(
        (slot) =>
          slot.closest('[data-cell-id]')?.getAttribute('data-cell-id') ===
          cellId,
      ) ?? null;
    const coordinateRoot = target?.parentElement;
    const candidates = new Set<SVGElement>();
    for (const root of host.querySelectorAll<SVGElement>(
      '[data-frame-node-outline]',
    )) {
      const shapes = root.matches(primitives)
        ? [root]
        : root.querySelectorAll<SVGElement>(primitives);
      for (const shape of shapes) {
        if (
          shape.closest('[data-cell-id]')?.getAttribute('data-cell-id') !==
            cellId ||
          shape.closest(
            '[data-frame-interaction-ignore],foreignObject,[data-frame-export-exclude]',
          ) ||
          shape.getAttribute('stroke') === 'none' ||
          shape.getAttribute('stroke') === 'transparent'
        )
          continue;
        candidates.add(shape);
      }
    }
    const cleanups: (() => void)[] = [];
    const parts: string[] = [];
    let width = 0;
    for (const original of candidates) {
      const originalWidth = parseFloat(
        paintValue(original, 'stroke-width', 'stroke-width', String(baseWidth)),
      );
      const resolvedWidth = Number.isFinite(originalWidth)
        ? originalWidth
        : baseWidth;
      width = Math.max(width, resolvedWidth);
      const clone = original.cloneNode(false) as SVGElement;
      for (const attribute of Array.from(clone.attributes))
        if (
          attribute.name.startsWith('on') ||
          attribute.name.startsWith('data-') ||
          ['id', 'class', 'style', 'filter', 'vector-effect'].includes(
            attribute.name,
          )
        )
          clone.removeAttribute(attribute.name);
      for (const property of [
        'stroke-dasharray',
        'stroke-dashoffset',
        'stroke-linecap',
        'stroke-linejoin',
        'stroke-miterlimit',
      ])
        clone.style.setProperty(
          property,
          paintValue(
            original,
            property,
            property,
            property === 'stroke-dasharray' ? 'none' : '',
          ),
        );
      clone.setAttribute('stroke', '#6366f1');
      clone.setAttribute(
        'stroke-width',
        String(resolvedWidth + (level === 2 ? 1 : 0)),
      );
      clone.setAttribute('fill', 'none');
      clone.setAttribute('opacity', '1');
      clone.setAttribute('stroke-opacity', '1');
      clone.setAttribute('pointer-events', 'none');
      const transforms: string[] = [];
      for (
        let parent = original.parentElement;
        parent && (parent as Element) !== host && parent !== coordinateRoot;
        parent = parent.parentElement
      ) {
        const transform = parent.getAttribute('transform');
        if (transform) transforms.unshift(transform);
      }
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      if (transforms.length)
        group.setAttribute('transform', transforms.join(' '));
      group.append(clone);
      parts.push(new XMLSerializer().serializeToString(group));
      const hadStyle = original.hasAttribute('style');
      const inline = original.style.getPropertyValue('stroke-opacity');
      const priority = original.style.getPropertyPriority('stroke-opacity');
      original.setAttribute(
        'data-frame-original-stroke-opacity',
        paintValue(original, 'stroke-opacity', 'stroke-opacity', '1'),
      );
      original.style.setProperty('stroke-opacity', '0');
      cleanups.push(() => {
        original.removeAttribute('data-frame-original-stroke-opacity');
        if (inline)
          original.style.setProperty('stroke-opacity', inline, priority);
        else original.style.removeProperty('stroke-opacity');
        if (!hadStyle && !original.style.length)
          original.removeAttribute('style');
      });
    }
    if (!parts.length && kind === 'edge') {
      setDrawing((previous) =>
        previous.markup
          ? { markup: '', width: baseWidth, target: null }
          : previous,
      );
      return;
    }
    if (!parts.length) {
      width = baseWidth;
      const rect = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'rect',
      );
      for (const key of ['x', 'y', 'width', 'height'] as const)
        rect.setAttribute(key, String(bounds[key]));
      rect.setAttribute('rx', '8');
      if (bounds.rotation && !target)
        rect.setAttribute(
          'transform',
          `rotate(${(bounds.rotation * 180) / Math.PI} ${bounds.x + bounds.width / 2} ${bounds.y + bounds.height / 2})`,
        );
      parts.push(new XMLSerializer().serializeToString(rect));
    }
    const markup = parts.join('');
    setDrawing((previous) =>
      previous.markup === markup &&
      previous.width === width &&
      previous.target === target
        ? previous
        : { markup, width, target },
    );
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [level, zoom, bounds, children, baseWidth, cellId, kind, paintRevision]);
  useLayoutEffect(() => {
    if (!level || !body.current) return;
    // A nested renderer can update its own path without rebuilding the scene.
    // Observe geometry only; our temporary stroke-opacity styles cannot loop.
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            (record.target as Element)
              .closest?.('[data-cell-id]')
              ?.getAttribute('data-cell-id') === cellId &&
            !(record.target as Element).closest?.(
              'foreignObject,[data-frame-export-exclude],[data-selection-handles],[data-vector-controls],[data-edge-controls]',
            ),
        )
      )
        setPaintRevision((revision) => revision + 1);
    });
    observer.observe(body.current, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'd',
        'x',
        'y',
        'width',
        'height',
        'rx',
        'ry',
        'cx',
        'cy',
        'r',
        'transform',
        'points',
        'stroke',
        'stroke-width',
        'stroke-dasharray',
      ],
    });
    return () => observer.disconnect();
  }, [level, children, cellId]);
  const cos = Math.abs(Math.cos(bounds.rotation ?? 0));
  const sin = Math.abs(Math.sin(bounds.rotation ?? 0));
  const width = bounds.width * cos + bounds.height * sin;
  const height = bounds.width * sin + bounds.height * cos;
  const filterBounds = drawing.target
    ? bounds
    : {
        x: bounds.x + (bounds.width - width) / 2,
        y: bounds.y + (bounds.height - height) / 2,
        width,
        height,
      };
  const interaction = !!level && !!drawing.markup && (
    <FrameInteractionStroke
      bounds={filterBounds}
      scale={zoom * scale}
      selected={level === 2}
      baseWidth={drawing.width}
    >
      {(paint) => (
        <g
          {...paint}
          data-node-highlight={kind === 'node' ? cellId : undefined}
          data-edge-highlight={kind === 'edge' ? cellId : undefined}
          data-relation-highlight={level === 1 ? kind : undefined}
          dangerouslySetInnerHTML={{ __html: drawing.markup }}
        />
      )}
    </FrameInteractionStroke>
  );
  return (
    <g
      data-node-interaction={cellId}
      onPointerOver={(event) => {
        if (
          enabled &&
          (event.target as Element)
            .closest('[data-cell-id]')
            ?.getAttribute('data-cell-id') === cellId
        )
          camera.setHovered(cellId);
      }}
      onPointerOut={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        camera.leave(cellId);
      }}
    >
      <g ref={body}>{children}</g>
      {drawing.target ? createPortal(interaction, drawing.target) : interaction}
    </g>
  );
}
