import type { EdgeRoutingContext } from './edge';
import type { EdgeLabelLayout } from './edge-label';
import type { OrthogonalRoutingResult } from './obstacle-route';

export const copyRoutingResult = (
  result: OrthogonalRoutingResult,
): OrthogonalRoutingResult => ({
  status: result.status,
  points: result.points.map(([x, y]) => [x, y]),
});
export const sameRoutingResult = (
  a: OrthogonalRoutingResult,
  b: OrthogonalRoutingResult,
) =>
  a.status === b.status &&
  a.points.length === b.points.length &&
  a.points.every(
    (p, at) => p[0] === b.points[at][0] && p[1] === b.points[at][1],
  );
export const copyLabelLayouts = (
  layouts: ReadonlyMap<string, EdgeLabelLayout>,
) =>
  new Map(
    [...layouts].map(([id, layout]) => [
      id,
      {
        point: [...layout.point] as EdgeLabelLayout['point'],
        bounds: { ...layout.bounds },
      },
    ]),
  );

/** Independent of public mutable route maps; contains no cells or store closures. */
export const routingBatches = new WeakMap<
  EdgeRoutingContext,
  {
    signature: string;
    results: Map<string, OrthogonalRoutingResult>;
    labels?: { signature: string; layouts: Map<string, EdgeLabelLayout> };
    previousLabels?: {
      signature: string;
      layouts: Map<string, EdgeLabelLayout>;
    };
  }
>();
