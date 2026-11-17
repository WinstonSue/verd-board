import type { RectangleClient } from '../interfaces/rectangle-client';
import type { RoutingObstacle } from '../geometry/obstacle-route';
import type { CellOperation, CellSelection } from './index';
import type { CellLayoutStyle } from './arrangement';
import type { CellRegistry, CellScene } from './registry';
import {
  isFrameCell,
  type CellStore,
  type NodeGeometry,
  type EdgeCell,
} from './types';

export const GEOMETRY_POLICY_VERSION = 1;
export const DEFAULT_GEOMETRY_SPACING = Object.freeze({
  nodeGap: 96,
  rankGap: 160,
  visualNodeGap: 12,
  laneGap: 8,
  terminalRun: 24,
});
export interface GeometrySpacing {
  nodeGap: number;
  rankGap: number;
  visualNodeGap: number;
  laneGap: number;
  terminalRun: number;
}
export interface GeometryDiagnostic {
  code:
    | 'routing.clearance'
    | 'routing.terminal-blocked'
    | 'routing.budget'
    | 'layout.constraints'
    | 'geometry.domain-managed';
  message: string;
  frameId: string;
  sceneId?: string;
  unitId?: string;
  cellIds: readonly string[];
}
export interface GeometryPlanResult {
  status: 'success' | 'partial' | 'blocked';
  operations: CellOperation[];
  diagnostics: GeometryDiagnostic[];
}
export interface GeometryLayoutUnit {
  id: string;
  nodeIds: readonly string[];
  edgeIds: readonly string[];
  anchorId?: string;
}
export interface GeometryPlanningContext {
  store: CellStore;
  frameId: string;
  selection: CellSelection;
  style: CellLayoutStyle;
  registry: CellRegistry;
  spacing: GeometrySpacing;
  /** Grows when routing feeds a congested corridor back into node placement. */
  expansion: number;
}
export interface SceneGeometryPolicy {
  version: number;
  nodeLayout: 'core' | 'domain' | 'none';
  edgeRouting: 'orthogonal' | 'domain' | 'none';
  defaultStyle?: CellLayoutStyle;
  spacing?: Partial<GeometrySpacing>;
  resolveLayoutUnits?(
    context: GeometryPlanningContext,
  ): readonly GeometryLayoutUnit[];
  planLayout?(context: GeometryPlanningContext): CellOperation[];
  /** Domain-owned projections stay derived, rather than becoming saved coordinates. */
  project?(
    store: CellStore,
    frameId: string,
  ): ReadonlyMap<string, NodeGeometry>;
  /** Transparent semantic containers can still contribute solid header obstacles. */
  obstacles?(
    store: CellStore,
    frameId: string,
    geometry?: ReadonlyMap<string, NodeGeometry>,
  ): readonly RoutingObstacle[];
  /** Replace the shared obstacle set for an edge at a different abstraction level. */
  edgeObstacles?(
    store: CellStore,
    frameId: string,
    edge: EdgeCell,
    obstacles: readonly RoutingObstacle[],
    geometry?: ReadonlyMap<string, NodeGeometry>,
  ): readonly RoutingObstacle[];
  validate?(context: GeometryPlanningContext): readonly GeometryDiagnostic[];
  fixedNodeIds?(context: GeometryPlanningContext): readonly string[];
}
const defaultPolicy: SceneGeometryPolicy = Object.freeze({
  version: 1,
  nodeLayout: 'core',
  edgeRouting: 'orthogonal',
});
export function frameGeometryScene(
  store: CellStore,
  frameId: string,
  registry?: CellRegistry,
): CellScene | undefined {
  const frame = store.cells[frameId];
  if (!isFrameCell(frame)) return;
  return registry?.scenes.find((scene) =>
    frame.children.some((id) =>
      scene.anchorKinds.includes(store.cells[id]?.kind),
    ),
  );
}
export function geometryPolicyFor(
  store: CellStore,
  frameId: string,
  registry?: CellRegistry,
): SceneGeometryPolicy {
  const scene = frameGeometryScene(store, frameId, registry);
  return (
    scene?.geometry ??
    (scene?.arrangeable === false
      ? { ...defaultPolicy, nodeLayout: 'none' }
      : defaultPolicy)
  );
}
export function geometrySpacingFor(
  policy: SceneGeometryPolicy,
  expansion = 1,
): GeometrySpacing {
  const input = { ...DEFAULT_GEOMETRY_SPACING, ...policy.spacing };
  return {
    ...input,
    visualNodeGap: Math.max(12, input.visualNodeGap),
    nodeGap: Math.max(32, input.nodeGap) * expansion,
    rankGap: Math.max(32, input.rankGap) * expansion,
    terminalRun: Math.max(24, input.terminalRun),
  };
}
export const rectanglesOverlap = (a: RectangleClient, b: RectangleClient) =>
  Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) + 1e-6 &&
  Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y) + 1e-6;
