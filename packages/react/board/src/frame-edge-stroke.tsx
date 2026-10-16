import type { FrameCameraStore } from './frame-camera-store';
import { memo, useMemo, useSyncExternalStore } from 'react';
import {
  edgeDisplayGeometry,
  arrowMarkerGeometry,
  type Point,
  type NodeAppearance,
} from '@sue/board-core';

/** No event closures or store dependencies in the expensive native path body. */
export const FrameEdgeStroke = memo(function FrameEdgeStroke({
  id,
  path,
  markers,
  appearance,
  stroke,
  preview,
}: {
  id: string;
  path: string;
  markers: ReturnType<typeof arrowMarkerGeometry>[];
  appearance?: NodeAppearance;
  stroke: string;
  preview: boolean;
}) {
  return (
    <>
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={appearance?.strokeWidth ?? 2}
        strokeDasharray={
          appearance?.strokeStyle === 'dashed'
            ? '8 4'
            : appearance?.strokeStyle === 'dotted'
              ? '2 4'
              : undefined
        }
      />
      {!preview && (
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={12}
          vectorEffect="non-scaling-stroke"
          data-edge-hit={id}
        />
      )}
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
    </>
  );
});

/** Hover publishes only to the two endpoint subscriptions and this path leaf. */
export function FrameInteractiveEdge({
  camera,
  points,
  curve,
  source,
  target,
  markerKinds,
  ...props
}: Omit<Parameters<typeof FrameEdgeStroke>[0], 'path' | 'markers'> & {
  camera: FrameCameraStore;
  points: Point[];
  curve: boolean;
  source?: { id: string; visible: boolean; radius: number };
  target?: { id: string; visible: boolean; radius: number };
  markerKinds: [string, string];
}) {
  const subscribe = useMemo(
    () => (notify: () => void) => {
      const a = camera.subscribeCell(source?.id, notify),
        b = camera.subscribeCell(target?.id, notify);
      return () => {
        a();
        b();
      };
    },
    [camera, source?.id, target?.id],
  );
  const getSnapshot = () =>
    Number(!!source && (source.visible || camera.isHovered(source.id))) +
    2 * Number(!!target && (target.visible || camera.isHovered(target.id)));
  const visible = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const geometry = useMemo(
    () =>
      edgeDisplayGeometry(
        points,
        curve,
        visible & 1
          ? (source?.radius ?? 0) + (props.appearance?.strokeWidth ?? 2) / 2
          : 0,
        visible & 2
          ? (target?.radius ?? 0) + (props.appearance?.strokeWidth ?? 2) / 2
          : 0,
      ),
    [
      points,
      curve,
      visible,
      props.appearance?.strokeWidth,
      source?.radius,
      target?.radius,
    ],
  );
  const [sourceMarker, targetMarker] = markerKinds;
  const markers = useMemo(
    () => [
      arrowMarkerGeometry(geometry.markerPoints, sourceMarker, true),
      arrowMarkerGeometry(geometry.markerPoints, targetMarker),
    ],
    [geometry, sourceMarker, targetMarker],
  );
  return <FrameEdgeStroke {...props} path={geometry.path} markers={markers} />;
}
