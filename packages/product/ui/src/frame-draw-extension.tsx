import { memo, type ReactElement } from 'react';
import {
  isNodeCell,
  polylinePath,
  type Point,
  type NodeCell,
  type NodeGeometry,
} from '@sue/board-core';
import type { FrameRenderExtension } from '@sue/board-react';
import { drawCellShapePaths } from '@sue/board-draw';
import { FrameTable } from './frame-table';
import { FrameVectorLine } from './frame-vector-line';
// These leaves only use immutable content inputs. Reusing their elements also
// lets the camera selector skip JSX allocation and repeated props comparisons.
const freehandElements = new WeakMap<
  NodeCell,
  WeakMap<NodeGeometry, ReactElement>
>();
const roughElements = new WeakMap<
  NodeCell,
  WeakMap<NodeGeometry, { normal?: ReactElement; selected?: ReactElement }>
>();
const freehandElement = (cell: NodeCell, geometry: NodeGeometry) => {
  let geometries = freehandElements.get(cell);
  if (!geometries) {
    geometries = new WeakMap();
    freehandElements.set(cell, geometries);
  }
  let element = geometries.get(geometry);
  if (!element) {
    element = <FreehandPath cell={cell} geometry={geometry} />;
    geometries.set(geometry, element);
  }
  return element;
};
const roughElement = (
  cell: NodeCell,
  geometry: NodeGeometry,
  selected: boolean,
) => {
  let geometries = roughElements.get(cell);
  if (!geometries) {
    geometries = new WeakMap();
    roughElements.set(cell, geometries);
  }
  let elements = geometries.get(geometry);
  if (!elements) {
    elements = {};
    geometries.set(geometry, elements);
  }
  const key = selected ? 'selected' : 'normal';
  return (elements[key] ??= (
    <RoughShape cell={cell} geometry={geometry} selected={selected} />
  ));
};
const path: FrameRenderExtension = {
  render: ({ cell, geometry }) =>
    isNodeCell(cell) && geometry ? freehandElement(cell, geometry) : null,
};
const table: FrameRenderExtension = {
  render: (context) => <FrameTable {...context} />,
};
export const frameDrawExtensions: FrameRenderExtension[] = [
  {
    kind: 'geometry',
    renderShapeCacheKey: ({ cell, geometry, selected }) => [
      cell,
      geometry,
      selected,
    ],
    renderShape: ({ cell, geometry, selected }) =>
      isNodeCell(cell) && geometry
        ? roughElement(cell, geometry, selected)
        : null,
  },
  { ...path, kind: 'freehand' },
  {
    kind: 'vector-line',
    render: (context) => <FrameVectorLine {...context} />,
  },
  { ...table, kind: 'table' },
  { ...table, kind: 'swimlane' },
];

const FreehandPath = memo(function FreehandPath({
  cell,
  geometry,
}: {
  cell: NodeCell;
  geometry: NodeGeometry;
}) {
  const points = (cell.data as { points?: Point[] })?.points ?? [];
  const sx = cell.geometry.width ? geometry.width / cell.geometry.width : 1,
    sy = cell.geometry.height ? geometry.height / cell.geometry.height : 1;
  return (
    <path
      d={polylinePath(
        points.map(([x, y]) => [geometry.x + x * sx, geometry.y + y * sy]),
      )}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
});

/** Stable cells retain their generated Rough paths while only the camera moves. */
const RoughShape = memo(function RoughShape({
  cell,
  geometry,
  selected,
}: {
  cell: NodeCell;
  geometry: NodeGeometry;
  selected: boolean;
}) {
  return (
    <g data-shape-renderer="rough">
      {drawCellShapePaths(
        cell,
        geometry,
        selected ? '#6366f1' : cell.appearance?.strokeColor,
      ).map((path, index) => (
        <path
          key={index}
          {...path}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </g>
  );
});
