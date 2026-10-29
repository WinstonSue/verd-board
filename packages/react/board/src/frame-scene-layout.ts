import {
  createDefaultShapeGeometryRegistry,
  createCellRegistry,
  createEdgeRoutingContext,
  frameContentBounds,
  geometryBounds,
  isFrameCell,
  isNodeCell,
  isEdgeCell,
  nodeShapeGeometry,
  nodeShapeSpec,
  roundNodeGeometry,
  unionCellBounds,
  type CellStore,
  type CellRegistry,
  type NodeGeometry,
  type NodeCell,
  type EdgeCell,
  type Point,
  type RectangleClient,
  type EdgeRoutingContext,
  type arrowMarkerGeometry,
} from '@sue/board-core';
import {
  canonicalFrameProjection,
  type FrameViewProjection,
} from './frame-view-projection';
import { projectEmbeddedContent } from './frame-plugins';
import type { FrameRenderExtension } from './frame-canvas';
export type FrameLayoutEntry = {
  geometry: Map<string, NodeGeometry>;
  baseGeometry: Map<string, NodeGeometry>;
  fitBounds: RectangleClient;
  contentOffsets: Map<string, Point>;
  store: CellStore;
  routing: EdgeRoutingContext;
  outlines: Map<
    string,
    {
      geometry: NodeGeometry;
      registry: ReturnType<typeof createDefaultShapeGeometryRegistry>;
      spec: ReturnType<typeof nodeShapeSpec>;
      pathGeometry: ReturnType<typeof nodeShapeGeometry>;
      textBounds: NodeGeometry;
      parts: ReturnType<
        NonNullable<NonNullable<ReturnType<typeof nodeShapeGeometry>>['parts']>
      >;
    }
  >;
  routes: Map<
    string,
    {
      cell: EdgeCell;
      sourceGeometry?: NodeGeometry;
      targetGeometry?: NodeGeometry;
      routing: EdgeRoutingContext;
      points: Point[];
      labelPoints: Point[];
      path: string;
      markers?: ReturnType<typeof arrowMarkerGeometry>[];
    }
  >;
  getGeometry(id: string): NodeGeometry | undefined;
  baseRouting: EdgeRoutingContext;
};
export type FrameLayoutMemory = Pick<
  FrameLayoutEntry,
  | 'baseGeometry'
  | 'geometry'
  | 'baseRouting'
  | 'routing'
  | 'outlines'
  | 'routes'
> & {
  baseNodes: Map<string, { original: NodeCell; derived: NodeCell }>;
  nodes: Map<string, { original: NodeCell; derived: NodeCell }>;
};
export const sameGeometry = (a: NodeGeometry, b: NodeGeometry) =>
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.height === b.height &&
  a.rotation === b.rotation &&
  a.derived === b.derived &&
  (a.outline === b.outline ||
    JSON.stringify(a.outline) === JSON.stringify(b.outline));
function canonicalGeometry(
  store: CellStore,
  next: Map<string, NodeGeometry>,
  previous?: ReadonlyMap<string, NodeGeometry>,
) {
  for (const [id, value] of next) {
    const original = store.cells[id];
    const old = previous?.get(id);
    if (isNodeCell(original) && sameGeometry(original.geometry, value))
      next.set(id, original.geometry);
    else if (old && sameGeometry(old, value)) next.set(id, old);
  }
}
function applyLayoutGeometry(
  store: CellStore,
  geometry: ReadonlyMap<string, NodeGeometry>,
  previous?: FrameLayoutMemory['nodes'],
) {
  let laidOut = store;
  const nodes: FrameLayoutMemory['nodes'] = new Map();
  for (const [id, value] of geometry) {
    const original = store.cells[id];
    if (!isNodeCell(original) || original.geometry === value) continue;
    const old = previous?.get(id);
    const derived =
      old?.original === original && old.derived.geometry === value
        ? old.derived
        : { ...original, geometry: value };
    nodes.set(id, { original, derived });
    if (laidOut === store) laidOut = { ...store, cells: { ...store.cells } };
    laidOut.cells[id] = derived;
  }
  return { laidOut, nodes };
}
/** Each scene owns its caches; a draft reuses existing root layout geometry. */
export function createFrameLayouts(
  store: CellStore,
  extensions: readonly FrameRenderExtension[] = [],
  seed?: { frameId: string; geometry: ReadonlyMap<string, NodeGeometry> },
  mountedRootId = store.rootId,
  memory = new Map<string, FrameLayoutMemory>(),
  registry: CellRegistry = createCellRegistry(),
  viewProjection: FrameViewProjection = canonicalFrameProjection,
  previewBase?: (id: string) => FrameLayoutEntry,
) {
  for (const id of memory.keys())
    if (!isFrameCell(store.cells[id])) memory.delete(id);
  const cache = new Map<string, FrameLayoutEntry>();
  return (id: string) => {
    const existing = cache.get(id);
    if (existing) return existing;
    const previous = memory.get(id);
    let geometry = new Map<string, NodeGeometry>();
    if (seed?.frameId === id)
      seed.geometry.forEach((value, key) =>
        geometry.set(key, roundNodeGeometry(value)),
      );
    else
      extensions.forEach((extension) =>
        extension
          .layout?.(store, id, viewProjection)
          .forEach((value, key) => geometry.set(key, roundNodeGeometry(value))),
      );
    canonicalGeometry(store, geometry, previous?.baseGeometry);
    const base = applyLayoutGeometry(store, geometry, previous?.baseNodes);
    const applyEdges = (source: CellStore) => {
      let result = source;
      extensions.forEach((extension) =>
        extension.layoutEdges?.(source, id, geometry).forEach((edge, key) => {
          if (
            !isEdgeCell(source.cells[key]) ||
            edge.id !== key ||
            edge.kind !== source.cells[key].kind
          )
            return;
          if (result === source)
            result = { ...source, cells: { ...source.cells } };
          result.cells[key] = edge;
        }),
      );
      return result;
    };
    let laidOut = applyEdges(base.laidOut);
    const baseGeometry = geometry;
    const previewRouting = previewBase?.(id).routing;
    const baseRouting = createEdgeRoutingContext(
      laidOut,
      id,
      undefined,
      previewRouting ?? previous?.baseRouting,
      registry,
      { preview: !!previewRouting },
    );
    const contentBounds = frameContentBounds(laidOut, id, baseRouting);
    const fitBounds = extensions.some((extension) =>
      extension.plugin?.fitLayoutBounds?.(store, id),
    )
      ? unionCellBounds([
          contentBounds,
          ...[...baseGeometry].flatMap(([id, bounds]) =>
            !store.cells[id]?.hidden ? [geometryBounds(bounds)] : [],
          ),
        ])!
      : contentBounds;
    const frame = store.cells[id];
    const projection =
      id !== mountedRootId && isFrameCell(frame)
        ? projectEmbeddedContent(
            extensions,
            store,
            frame,
            baseGeometry,
            fitBounds,
          )
        : { geometry, offsets: new Map<string, Point>() };
    geometry = projection.geometry;
    if (geometry !== baseGeometry)
      canonicalGeometry(store, geometry, previous?.geometry);
    const projected =
      geometry === baseGeometry
        ? base
        : applyLayoutGeometry(store, geometry, previous?.nodes);
    laidOut = applyEdges(projected.laidOut);
    const outlines = previous?.outlines ?? new Map();
    const routes = previous?.routes ?? new Map();
    for (const map of [outlines, routes])
      for (const key of map.keys())
        if (
          !isFrameCell(frame) ||
          !frame.children.includes(key) ||
          !store.cells[key]
        )
          map.delete(key);
    const entry: NonNullable<ReturnType<typeof cache.get>> = {
      geometry,
      baseGeometry,
      baseRouting,
      fitBounds,
      contentOffsets: projection.offsets,
      store: laidOut,
      routing:
        geometry === baseGeometry
          ? baseRouting
          : createEdgeRoutingContext(
              laidOut,
              id,
              undefined,
              previewRouting ?? previous?.routing,
              registry,
              { preview: !!previewRouting },
            ),
      outlines,
      routes,
      getGeometry: (cellId: string) => {
        const node = store.cells[cellId];
        return isNodeCell(node)
          ? (geometry.get(cellId) ?? node.geometry)
          : undefined;
      },
    };
    memory.set(id, {
      baseGeometry,
      geometry,
      baseRouting,
      routing: entry.routing,
      outlines,
      routes,
      baseNodes: base.nodes,
      nodes: projected.nodes,
    });
    cache.set(id, entry);
    return entry;
  };
}
