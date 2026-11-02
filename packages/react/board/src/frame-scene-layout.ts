import {
  createDefaultShapeGeometryRegistry,
  createCellRegistry,
  createSpatialIndex,
  edgePolyline,
  edgeLabelLayout,
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
  query(bounds: RectangleClient): readonly string[];
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
  extensionCache?: Map<
    FrameRenderExtension,
    {
      layout?: { key: readonly unknown[]; value: Map<string, NodeGeometry> };
      edges?: { key: readonly unknown[]; value: Map<string, EdgeCell> };
    }
  >;
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
    const extensionCache = previous?.extensionCache ?? new Map();
    for (const extension of extensionCache.keys())
      if (!extensions.includes(extension)) extensionCache.delete(extension);
    const cached = <T>(
      extension: FrameRenderExtension,
      kind: 'layout' | 'edges',
      key: readonly unknown[] | undefined,
      compute: () => T,
    ): T => {
      if (!key) return compute();
      const entry = extensionCache.get(extension) ?? {};
      const old = entry[kind];
      if (
        old &&
        old.key.length === key.length &&
        key.every((value, i) => Object.is(value, old.key[i]))
      )
        return old.value as T;
      const value = compute();
      entry[kind] = { key: [...key], value };
      extensionCache.set(extension, entry);
      return value;
    };
    let geometry = new Map<string, NodeGeometry>();
    if (seed?.frameId === id)
      seed.geometry.forEach((value, key) =>
        geometry.set(key, roundNodeGeometry(value)),
      );
    else
      extensions.forEach((extension) =>
        cached(
          extension,
          'layout',
          extension.layoutCacheKey && [
            viewProjection.identity,
            ...extension.layoutCacheKey(store, id, viewProjection),
          ],
          () =>
            extension.layout?.(store, id, viewProjection) ??
            new Map<string, NodeGeometry>(),
        ).forEach((value, key) => geometry.set(key, roundNodeGeometry(value))),
      );
    canonicalGeometry(store, geometry, previous?.baseGeometry);
    const base = applyLayoutGeometry(store, geometry, previous?.baseNodes);
    const applyEdges = (source: CellStore) => {
      let result = source;
      extensions.forEach((extension) =>
        cached(
          extension,
          'edges',
          extension.layoutEdgesCacheKey && [
            viewProjection.identity,
            ...[...geometry].flatMap(([key, value]) => [key, value]),
            ...extension.layoutEdgesCacheKey(source, id, geometry),
          ],
          () =>
            extension.layoutEdges?.(source, id, geometry) ??
            new Map<string, EdgeCell>(),
        ).forEach((edge, key) => {
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
    const childIds = new Set(isFrameCell(frame) ? frame.children : []);
    const childOrder = new Map([...childIds].map((id, index) => [id, index]));
    for (const map of [outlines, routes])
      for (const key of map.keys())
        if (!isFrameCell(frame) || !childIds.has(key) || !store.cells[key])
          map.delete(key);
    let spatial: ReturnType<typeof createSpatialIndex> | undefined;
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
      query: (bounds) => {
        if (!spatial) {
          const entries = isFrameCell(frame)
            ? frame.children.flatMap((cellId) => {
                const cell = laidOut.cells[cellId];
                if (!cell || cell.hidden) return [];
                if (isNodeCell(cell))
                  return [
                    {
                      id: cellId,
                      ...geometryBounds(geometry.get(cellId) ?? cell.geometry),
                    },
                  ];
                if (!isEdgeCell(cell)) return [];
                const points = edgePolyline(
                  laidOut,
                  cell,
                  undefined,
                  entry.routing,
                );
                const boxes = points.map(([x, y]) => ({
                  x: x - 24,
                  y: y - 24,
                  width: 48,
                  height: 48,
                }));
                for (let i = 0; i < (cell.labels?.length ?? 0); i++)
                  boxes.push(
                    edgeLabelLayout(cell, i, points, entry.routing).bounds,
                  );
                const box = unionCellBounds(boxes);
                return box ? [{ id: cellId, ...box }] : [];
              })
            : [];
          spatial = createSpatialIndex(entries);
        }
        return spatial
          .query(bounds)
          .sort((a, b) => childOrder.get(a)! - childOrder.get(b)!);
      },
      getGeometry: (cellId: string) => {
        const node = store.cells[cellId];
        return isNodeCell(node)
          ? (geometry.get(cellId) ?? node.geometry)
          : undefined;
      },
    };
    memory.set(id, {
      extensionCache,
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
