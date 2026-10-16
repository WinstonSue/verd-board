import { memo, useId, type ReactNode } from 'react';
import type { RectangleClient } from '@sue/board-core';

const shadows = {
  sm: { dy: 1, blur: 2, opacity: 0.16 },
  md: { dy: 4, blur: 8, opacity: 0.18 },
  lg: { dy: 12, blur: 20, opacity: 0.22 },
};
export const frameShadowFilter = (scope: string, shadow?: string) =>
  shadow && Object.hasOwn(shadows, shadow)
    ? `url(#${scope}-${shadow})`
    : undefined;

/** Cached native bodies carry values only, never a scene/store render closure. */
export const FrameStaticShadow = memo(function FrameStaticShadow({
  shadow,
  bounds,
  content,
}: {
  shadow?: string;
  bounds: RectangleClient;
  content: ReactNode;
}) {
  return (
    <FrameCellShadow shadow={shadow} bounds={bounds}>
      {(filter) => <g filter={filter}>{content}</g>}
    </FrameCellShadow>
  );
});

export function FrameCellShadow({
  shadow,
  bounds,
  children,
}: {
  shadow?: string;
  bounds: RectangleClient;
  children(filter?: string): ReactNode;
}) {
  const scope = `frame-shadow-${useId().replace(/:/g, '')}`;
  const preset =
    shadow && Object.hasOwn(shadows, shadow)
      ? shadows[shadow as keyof typeof shadows]
      : undefined;
  if (!preset) return <>{children()}</>;
  const padding = Math.ceil(preset.blur * 1.5 + Math.abs(preset.dy)) + 2;
  return (
    <>
      <defs>
        <filter
          id={`${scope}-${shadow}`}
          filterUnits="userSpaceOnUse"
          x={bounds.x - padding}
          y={bounds.y - padding}
          width={Math.max(1, bounds.width) + padding * 2}
          height={Math.max(1, bounds.height) + padding * 2}
        >
          <feDropShadow
            dx="0"
            dy={preset.dy}
            stdDeviation={preset.blur / 2}
            floodColor="#0f172a"
            floodOpacity={preset.opacity}
          />
        </filter>
      </defs>
      {children(frameShadowFilter(scope, shadow))}
    </>
  );
}
