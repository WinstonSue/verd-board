import { useId, type ReactNode } from 'react';
import type { RectangleClient } from '@sue/board-core';

/** Local stroke widths scale with the scene; the soft shadow stays screen-sized. */
export function FrameInteractionStroke({
  bounds,
  scale,
  selected = false,
  baseWidth,
  dash,
  children,
}: {
  bounds: RectangleClient;
  scale: number;
  selected?: boolean;
  baseWidth: number;
  dash?: string;
  children(props: {
    stroke: string;
    strokeWidth: number;
    strokeDasharray: string;
    fill: string;
    pointerEvents: 'none';
    filter: string;
    'data-frame-export-exclude': string;
    'data-interaction-stroke': string;
  }): ReactNode;
}) {
  const id = `frame-interaction-${useId().replace(/:/g, '')}`;
  const zoom = Number.isFinite(scale) && scale > 0 ? scale : 1;
  // User-space bounds also cover zero-height/width lines and their arrowheads.
  const width = baseWidth + (selected ? 1 : 0);
  const padding = width / 2 + 12 / zoom;
  return (
    <>
      <defs data-frame-export-exclude="interaction-shadow">
        <filter
          id={id}
          filterUnits="userSpaceOnUse"
          primitiveUnits="userSpaceOnUse"
          x={bounds.x - padding}
          y={bounds.y - padding}
          width={Math.max(0, bounds.width) + padding * 2}
          height={Math.max(0, bounds.height) + padding * 2}
          colorInterpolationFilters="sRGB"
        >
          {/* Spread only the shadow input so 1px relationship strokes retain contrast. */}
          <feMorphology
            in="SourceAlpha"
            operator="dilate"
            radius={0.75 / zoom}
            result="shadow-alpha"
          />
          <feGaussianBlur
            in="shadow-alpha"
            stdDeviation={2.25 / zoom}
            result="light-blur"
          />
          <feFlood floodColor="#fff" floodOpacity={0.9} />
          <feComposite in2="light-blur" operator="in" result="light" />
          <feGaussianBlur
            in="shadow-alpha"
            stdDeviation={1.25 / zoom}
            result="dark-blur"
          />
          <feFlood floodColor="#0f172a" floodOpacity={0.65} />
          <feComposite in2="dark-blur" operator="in" result="dark" />
          <feMerge>
            <feMergeNode in="light" />
            <feMergeNode in="dark" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {children({
        stroke: '#6366f1',
        strokeWidth: width,
        strokeDasharray: dash ?? 'none',
        fill: 'none',
        pointerEvents: 'none',
        filter: `url(#${id})`,
        'data-frame-export-exclude': 'interaction-stroke',
        'data-interaction-stroke': selected ? 'selected' : 'related',
      })}
    </>
  );
}
