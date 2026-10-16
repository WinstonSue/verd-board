import { memo, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  isNodeCell,
  roundFramePoint,
  roundNodeGeometry,
  unrotateNodePoint,
  isClosedPath,
  moveVectorLinePoint,
  pathNodePoints,
  removeVectorLinePoint,
  vectorLinePath,
  vectorLineMidpoints,
  type NodeCell,
  type Point,
  type VectorLineData,
} from '@sue/board-core';
import type { FrameRenderContext } from '@sue/board-react';
const VisibleVectorPath = memo(function VisibleVectorPath({
  path,
  fill,
}: {
  path: string;
  fill: string;
}) {
  return (
    <path
      data-vector-path="true"
      d={path}
      fill={fill}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
});
export function FrameVectorLine(context: FrameRenderContext) {
  const { cell, geometry, selected, readonly, pending, scale, dispatch } =
    context;
  const [pointsPreview, setPointsPreview] = useState<Point[]>();
  const drag = useRef<
    | {
        cell: NodeCell<VectorLineData>;
        index: number;
        insert: boolean;
        matrix: DOMMatrix;
        start: Point;
        points: Point[];
      }
    | undefined
  >(undefined);
  const root = useRef<SVGGElement>(null);
  const stablePoints = useMemo(
    () =>
      isNodeCell(cell) && geometry
        ? pathNodePoints(cell as NodeCell<VectorLineData>, geometry)
        : [],
    [cell, geometry],
  );
  const path = useMemo(
    () =>
      isNodeCell(cell)
        ? vectorLinePath(
            pointsPreview ?? stablePoints,
            (cell.data as VectorLineData).shape,
          )
        : '',
    [cell, stablePoints, pointsPreview],
  );
  const points = pointsPreview ?? stablePoints;
  const midpoints = useMemo(
    () =>
      isNodeCell(cell)
        ? vectorLineMidpoints(points, (cell.data as VectorLineData).shape)
        : [],
    [cell, points],
  );
  if (!isNodeCell(cell) || !geometry) return null;
  const line = cell as NodeCell<VectorLineData>,
    closed = isClosedPath(points),
    size = 5 / Math.max(0.02, scale);
  const writable = !readonly && !pending && !cell.locked;
  const commit = (next: NodeCell<VectorLineData>) => {
    void dispatch({
      id: crypto.randomUUID(),
      operations: [{ type: 'replace_cell', cell: next }],
    });
  };
  const start = (
    event: PointerEvent<SVGElement>,
    index: number,
    insert: boolean,
  ) => {
    if (!writable || event.button !== 0) return;
    const matrix = root.current?.getScreenCTM()?.inverse();
    if (!matrix) return;
    event.stopPropagation();
    event.preventDefault();
    context.select();
    const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix,
    );
    drag.current = {
      cell: line,
      index,
      insert,
      matrix,
      start: [position.x, position.y],
      points: pathNodePoints(line, geometry),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const update = (event: PointerEvent<SVGElement>, finish: boolean) => {
    const state = drag.current;
    if (!state) return;
    event.stopPropagation();
    const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      state.matrix,
    );
    const point: Point = [position.x, position.y];
    const moved =
      Math.hypot(point[0] - state.start[0], point[1] - state.start[1]) *
        scale >=
      2;
    const authored = roundFramePoint([
      state.cell.geometry.x +
        ((point[0] - geometry.x) * state.cell.geometry.width) / geometry.width,
      state.cell.geometry.y +
        ((point[1] - geometry.y) * state.cell.geometry.height) /
          geometry.height,
    ]);
    const candidate = moveVectorLinePoint(
      state.cell,
      state.index,
      authored,
      state.insert,
      8 / scale,
    );
    const next = {
      ...candidate,
      geometry: roundNodeGeometry(candidate.geometry),
    };
    if (finish) {
      drag.current = undefined;
      setPointsPreview(undefined);
      if (moved) commit(next);
    } else if (moved) {
      // Rebased rotated paths change their center. Paint in the old node's local
      // coordinates so the preview has exactly the final world positions.
      setPointsPreview(
        pathNodePoints(next).map((point) =>
          unrotateNodePoint(
            geometry,
            unrotateNodePoint(
              { ...next.geometry, rotation: -(next.geometry.rotation ?? 0) },
              point,
            ),
          ),
        ),
      );
    }
  };
  const cancel = () => {
    drag.current = undefined;
    setPointsPreview(undefined);
  };
  return (
    <g
      ref={root}
      data-vector-line={cell.id}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <VisibleVectorPath path={path} fill={cell.appearance?.fill ?? 'none'} />
      {!context.preview && (
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(10 / scale, cell.appearance?.strokeWidth ?? 2)}
          data-vector-hit="true"
        />
      )}
      {selected && writable && (
        <g
          data-vector-controls={cell.id}
          fill="#fff"
          stroke="#6366f1"
          strokeWidth={1 / scale}
        >
          {points.slice(0, closed ? -1 : undefined).map((point, index) => (
            <circle
              key={`point-${index}`}
              data-vector-point={index}
              cx={point[0]}
              cy={point[1]}
              r={size}
              style={{ cursor: 'move' }}
              onPointerDown={(event) => start(event, index, false)}
              onPointerMove={(event) => update(event, false)}
              onPointerUp={(event) => update(event, true)}
              onPointerCancel={cancel}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (points.length - (closed ? 1 : 0) > 2)
                  commit(removeVectorLinePoint(line, index));
              }}
            />
          ))}
          {midpoints.map((middle, index) => {
            return (
              <rect
                key={`insert-${index}`}
                data-vector-insert={index}
                x={middle[0] - size * 0.7}
                y={middle[1] - size * 0.7}
                width={size * 1.4}
                height={size * 1.4}
                style={{ cursor: 'copy' }}
                onPointerDown={(event) => start(event, index, true)}
                onPointerMove={(event) => update(event, false)}
                onPointerUp={(event) => update(event, true)}
                onPointerCancel={cancel}
              />
            );
          })}
        </g>
      )}
    </g>
  );
}
