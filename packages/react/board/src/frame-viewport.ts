import type { RectangleClient, Viewport } from '@sue/board-core';

export const PRESENTATION_CAMERA_MS = 280;

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ViewportInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const emptyInsets: ViewportInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Fit world bounds into a viewport. Presentation may pass a minimum below the editor's 0.1. */
export const viewportForBounds = (
  bounds: RectangleClient,
  size: ViewportSize,
  insets: ViewportInsets = emptyInsets,
  limits: { minZoom: number; maxZoom: number } = { minZoom: 0.1, maxZoom: 8 },
): Viewport => {
  const width = Math.max(1, size.width - insets.left - insets.right);
  const height = Math.max(1, size.height - insets.top - insets.bottom);
  const nextZoom = Math.min(
    limits.maxZoom,
    Math.max(
      limits.minZoom,
      Math.min(
        width / Math.max(1e-6, bounds.width),
        height / Math.max(1e-6, bounds.height),
      ),
    ),
  );
  return {
    zoom: nextZoom,
    origination: [
      bounds.x - (width / nextZoom - bounds.width) / 2 - insets.left / nextZoom,
      bounds.y -
        (height / nextZoom - bounds.height) / 2 -
        insets.top / nextZoom,
    ],
  };
};

export const interpolateViewport = (
  from: Viewport,
  to: Viewport,
  t: number,
): Viewport => {
  const amount = Math.min(1, Math.max(0, t));
  const ease =
    amount < 0.5 ? 2 * amount * amount : 1 - (-2 * amount + 2) ** 2 / 2;
  const fromOrigin = from.origination ?? [0, 0];
  const toOrigin = to.origination ?? [0, 0];
  return {
    zoom: (from.zoom ?? 1) + ((to.zoom ?? 1) - (from.zoom ?? 1)) * ease,
    origination: [
      fromOrigin[0] + (toOrigin[0] - fromOrigin[0]) * ease,
      fromOrigin[1] + (toOrigin[1] - fromOrigin[1]) * ease,
    ],
  };
};

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;
