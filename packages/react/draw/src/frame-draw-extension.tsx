import {
  resolveCellAppearance,
  resolveBoardTheme,
  type ResolvedBoardTheme,
  isNodeCell,
  polylinePath,
  type NodeCell,
  type NodeGeometry,
  type Point,
} from '@sue/board-core';
import { drawCellShapePaths } from '@sue/board-draw';
import type { FrameRenderExtension } from '@sue/board-react';
import { memo, type ReactElement } from 'react';
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
  WeakMap<
    NodeGeometry,
    Map<string, { normal?: ReactElement; selected?: ReactElement }>
  >
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
  theme?: ResolvedBoardTheme,
) => {
  let geometries = roughElements.get(cell);
  if (!geometries) {
    geometries = new WeakMap();
    roughElements.set(cell, geometries);
  }
  let variants = geometries.get(geometry);
  if (!variants) geometries.set(geometry, (variants = new Map()));
  const visual = resolveCellAppearance(cell, theme ?? resolveBoardTheme());
  const colors = JSON.stringify([visual.fill, visual.strokeColor]);
  let elements = variants.get(colors);
  if (!elements) variants.set(colors, (elements = {}));
  const key = selected ? 'selected' : 'normal';
  return (elements[key] ??= (
    <RoughShape
      cell={cell}
      geometry={geometry}
      selected={selected}
      fill={visual.fill}
      stroke={visual.strokeColor}
    />
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
    kind: 'image',
    render: ({ cell, geometry }) =>
      isNodeCell(cell) && geometry ? (
        <image
          href={(cell.data as { url: string })?.url}
          x={geometry.x}
          y={geometry.y}
          width={geometry.width}
          height={geometry.height}
        />
      ) : null,
  },
  {
    kind: 'geometry',
    renderShapeCacheKey: ({ cell, geometry, selected, theme }) => [
      theme,
      cell,
      geometry,
      selected,
    ],
    renderShape: ({ cell, geometry, selected, theme }) =>
      isNodeCell(cell) && geometry
        ? roughElement(cell, geometry, selected, theme)
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
      data-frame-node-outline
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
  fill,
  stroke,
}: {
  cell: NodeCell;
  geometry: NodeGeometry;
  selected: boolean;
  fill?: string;
  stroke?: string;
}) {
  return (
    <g data-shape-renderer="rough">
      {drawCellShapePaths(
        { ...cell, appearance: { ...cell.appearance, fill } },
        geometry,
        stroke,
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
