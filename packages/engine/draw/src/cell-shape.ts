import rough from 'roughjs';
import {
  nodeShapeGeometry,
  type NodeCell,
  type NodeGeometry,
} from '@sue/board-core';

export interface GeometryCellData {
  roughness?: number;
  fillStyle?: 'solid' | 'hachure' | 'cross-hatch' | 'dots' | 'zigzag';
}
export interface CellShapePath {
  d: string;
  stroke: string;
  strokeWidth: number;
  fill?: string;
  strokeDasharray?: string;
}
const generator = rough.generator();
const seedFor = (id: string) => {
  let seed = 2166136261;
  for (let i = 0; i < id.length; i++)
    seed = Math.imul(seed ^ id.charCodeAt(i), 16777619);
  return seed >>> 0 || 1;
};
/** Rough drawing consumes native core geometry; it never projects a BoardElement. */
export const drawCellShapePaths = (
  cell: NodeCell,
  geometry: NodeGeometry = cell.geometry,
  stroke = cell.appearance?.strokeColor ?? '#64748b',
): CellShapePath[] => {
  const shape = nodeShapeGeometry(geometry.outline ?? 'rectangle');
  if (!shape) return [];
  const data = cell.data as GeometryCellData | undefined;
  const parts = shape.parts?.(geometry) ?? [{ d: shape.path(geometry) }];
  const style = cell.appearance?.strokeStyle;
  return parts.flatMap((part, index) => {
    const drawable = generator.path(part.d, {
      roughness: data?.roughness ?? 0,
      seed: seedFor(cell.id) + index,
      stroke,
      strokeWidth: cell.appearance?.strokeWidth ?? 2,
      fill:
        part.fill === 'none' ? undefined : (cell.appearance?.fill ?? '#fff'),
      fillStyle: data?.fillStyle ?? 'solid',
      preserveVertices: true,
    });
    return generator.toPaths(drawable).map((path) => ({
      ...path,
      strokeDasharray:
        path.stroke !== 'none'
          ? (part.strokeDasharray ??
            (style === 'dashed'
              ? '8 4'
              : style === 'dotted'
                ? '2 4'
                : undefined))
          : undefined,
    }));
  });
};
