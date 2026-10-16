import type { PointerEvent } from 'react';
import {
  resizeHandles,
  resizeHandlePoint,
  resizeHandleDirection,
  type NodeGeometry,
  type ResizeHandle,
} from '@sue/board-core';

export function FrameSelectionHandles({
  id,
  geometry,
  scale,
  resize,
  rotate,
  inset = false,
  outline = true,
  onStart,
}: {
  id: string;
  geometry: NodeGeometry;
  scale: number;
  resize: boolean;
  rotate: boolean;
  /** Keep Frame handles inside their outer container. */
  inset?: boolean;
  outline?: boolean;
  onStart(
    event: PointerEvent<SVGElement>,
    mode: 'resize' | 'rotate',
    handle?: ResizeHandle,
  ): void;
}) {
  const size = 8 / Math.max(0.02, scale),
    offset = 28 / Math.max(0.02, scale);
  return (
    <g data-selection-handles={id} fill="#fff" stroke="#6366f1" strokeWidth={1}>
      {outline && (
        <rect
          x={geometry.x}
          y={geometry.y}
          width={geometry.width}
          height={geometry.height}
          fill="none"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
      {resize &&
        resizeHandles.map((handle) => {
          const point = resizeHandlePoint(geometry, handle);
          const direction = resizeHandleDirection(handle);
          if (inset) {
            point[0] -= (direction[0] * size) / 2;
            point[1] -= (direction[1] * size) / 2;
          } else if (!direction[0] || !direction[1]) {
            point[0] += direction[0] * size * 1.5;
            point[1] += direction[1] * size * 1.5;
          }
          return (
            <rect
              key={handle}
              data-resize-handle={handle}
              data-handle-cell={id}
              x={point[0] - size / 2}
              y={point[1] - size / 2}
              width={size}
              height={size}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: `${handle}-resize` }}
              onPointerDown={(event) => onStart(event, 'resize', handle)}
            />
          );
        })}
      {rotate && (
        <>
          <path
            d={`M${geometry.x + geometry.width / 2} ${geometry.y} L${geometry.x + geometry.width / 2} ${geometry.y - offset}`}
            fill="none"
            pointerEvents="none"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            data-rotate-handle={id}
            cx={geometry.x + geometry.width / 2}
            cy={geometry.y - offset}
            r={size / 2}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: 'grab' }}
            onPointerDown={(event) => onStart(event, 'rotate')}
          />
        </>
      )}
    </g>
  );
}
