import {
  arrowMarkerGeometry,
  edgeDisplayGeometry,
  type NodeAppearance,
  type EdgeJump,
  type Point,
  type RectangleClient,
} from '@sue/board-core';
import { memo, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { FrameScaleContent, type FrameCameraStore } from './frame-camera-store';
import { FrameInteractionStroke } from './frame-interaction-stroke';

/** No event closures or store dependencies in the expensive native path body. */
export const FrameEdgeStroke = memo(function FrameEdgeStroke({
  id,
  path,
  markers,
  appearance,
  stroke,
  preview,
  hitPath,
  highlighted,
  selected,
  camera,
  scale,
  bounds,
  filter,
  children,
}: {
  id: string;
  camera: FrameCameraStore;
  scale: number;
  bounds: RectangleClient;
  filter?: string;
  children?: ReactNode;
  hitPath?: string;
  highlighted?: boolean;
  selected?: boolean;
  path: string;
  markers: ReturnType<typeof arrowMarkerGeometry>[];
  appearance?: NodeAppearance;
  stroke: string;
  preview: boolean;
}) {
  const dash =
    appearance?.strokeStyle === 'dashed'
      ? '8 4'
      : appearance?.strokeStyle === 'dotted'
        ? '2 4'
        : undefined;
  return (
    <>
      {!preview && (selected || highlighted) && (
        <FrameScaleContent
          camera={camera}
          render={(zoom) => (
            <FrameInteractionStroke
              bounds={bounds}
              scale={zoom * scale}
              selected={selected}
              baseWidth={appearance?.strokeWidth ?? 2}
              dash={dash}
            >
              {(paint) => (
                <g
                  {...paint}
                  data-relation-highlight={selected ? undefined : 'edge'}
                >
                  <path d={path} />
                  {markers.map(
                    (marker, at) =>
                      marker && (
                        <path
                          key={at}
                          d={marker.path}
                          strokeLinejoin="round"
                          strokeDasharray="none"
                          fill={
                            marker.fill === 'stroke'
                              ? paint.stroke
                              : marker.fill === 'background'
                                ? '#fff'
                                : 'none'
                          }
                        />
                      ),
                  )}
                </g>
              )}
            </FrameInteractionStroke>
          )}
        />
      )}
      <g filter={filter} opacity={appearance?.opacity}>
        <g
          opacity={!preview && (selected || highlighted) ? 0 : undefined}
          data-frame-original-opacity={
            !preview && (selected || highlighted) ? '1' : undefined
          }
        >
          <path
            data-edge-display={id}
            d={path}
            fill="none"
            stroke={stroke}
            strokeWidth={appearance?.strokeWidth ?? 2}
            strokeDasharray={dash}
          />
          {markers.map(
            (marker, at) =>
              marker && (
                <path
                  key={at}
                  data-arrow-marker={at === 0 ? 'source' : 'target'}
                  d={marker.path}
                  strokeLinejoin="round"
                  stroke={stroke}
                  strokeWidth={appearance?.strokeWidth ?? 2}
                  fill={
                    marker.fill === 'stroke'
                      ? stroke
                      : marker.fill === 'background'
                        ? '#fff'
                        : 'none'
                  }
                />
              ),
          )}
        </g>
        {children}
      </g>
      {!preview && (
        <path
          d={hitPath ?? path}
          fill="none"
          stroke="transparent"
          strokeWidth={12}
          vectorEffect="non-scaling-stroke"
          data-edge-hit={id}
        />
      )}
    </>
  );
});

/** Hover publishes only to the two endpoint subscriptions and this path leaf. */
export function FrameInteractiveEdge({
  camera,
  points,
  curve,
  markerKinds,
  sourceId,
  targetId,
  jumps,
  rounded,
  safetyBounds,
  relatedSelected,
  interactive = true,
  ...props
}: Omit<Parameters<typeof FrameEdgeStroke>[0], 'path' | 'markers'> & {
  camera: FrameCameraStore;
  sourceId?: string;
  targetId?: string;
  jumps?: readonly EdgeJump[];
  rounded?: boolean;
  safetyBounds?: readonly import('@sue/board-core').RectangleClient[];
  relatedSelected?: boolean;
  interactive?: boolean;
  points: Point[];
  curve: boolean;
  markerKinds: [string, string];
}) {
  const subscribe = useMemo(
    () => (notify: () => void) => {
      const a = camera.subscribeCell(sourceId, notify),
        b = camera.subscribeCell(targetId, notify),
        c = camera.subscribeCell(props.id, notify);
      return () => {
        a();
        b();
        c();
      };
    },
    [camera, sourceId, targetId, props.id],
  );
  const getSnapshot = () =>
    Number(
      interactive &&
        (!!relatedSelected ||
          camera.isHovered(props.id) ||
          camera.isHovered(sourceId) ||
          camera.isHovered(targetId)),
    );
  const visible = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const geometry = useMemo(
    () =>
      edgeDisplayGeometry(
        points,
        curve,
        0,
        0,
        rounded || jumps?.length
          ? { jumps, cornerRadius: rounded ? 6 : 0, safetyBounds }
          : undefined,
      ),
    [points, curve, jumps, rounded, safetyBounds],
  );
  const [sourceMarker, targetMarker] = markerKinds;
  const markers = useMemo(
    () => [
      arrowMarkerGeometry(geometry.markerPoints, sourceMarker, true),
      arrowMarkerGeometry(geometry.markerPoints, targetMarker),
    ],
    [geometry, sourceMarker, targetMarker],
  );
  const hitGeometry = useMemo(
    () => edgeDisplayGeometry(points, curve),
    [points, curve],
  );
  return (
    <FrameEdgeStroke
      {...props}
      camera={camera}
      path={geometry.path}
      hitPath={interactive ? hitGeometry.path : geometry.path}
      markers={markers}
      highlighted={!!visible}
    />
  );
}

/** Same visible path body, without camera subscriptions, ports, highlights or hit regions. */
export function FrameStaticEdge({
  points,
  curve,
  jumps,
  rounded,
  safetyBounds,
  markerKinds,
  ...props
}: Parameters<typeof FrameInteractiveEdge>[0]) {
  const geometry = useMemo(
    () =>
      edgeDisplayGeometry(
        points,
        curve,
        0,
        0,
        rounded || jumps?.length
          ? { jumps, cornerRadius: rounded ? 6 : 0, safetyBounds }
          : undefined,
      ),
    [points, curve, jumps, rounded, safetyBounds],
  );
  const [sourceMarker, targetMarker] = markerKinds;
  const markers = useMemo(
    () => [
      arrowMarkerGeometry(geometry.markerPoints, sourceMarker, true),
      arrowMarkerGeometry(geometry.markerPoints, targetMarker),
    ],
    [geometry, sourceMarker, targetMarker],
  );
  return (
    <FrameEdgeStroke
      {...props}
      preview
      path={geometry.path}
      markers={markers}
    />
  );
}
