import {
  assertWholeGroupsMoved,
  directGroupOf,
  geometryBounds,
  groupLeafMembers,
  indexCells,
  isFrameCell,
  isNodeCell,
  laneContains,
  lockedByAncestor,
  planLaneDrop,
  unionCellBounds,
  type Cell,
  type CellRegistry,
  type CellStore,
  type NodeCell,
  type NodeGeometry,
} from '@sue/board-core';
import { architecturePorts } from './cell-commands';
import { architectureLayerIds, layoutArchitectureCells } from './cell-utils';
import type { ArchitectureLayerData } from './types';

/** Read-only runtime preparation. Persistence still goes through a transaction. */
export function prepareArchitectureSnapshot(store: CellStore): CellStore {
  let cells = store.cells;
  for (const cell of Object.values(store.cells)) {
    if (
      !isNodeCell(cell) ||
      cell.kind !== 'architecture-layer' ||
      cell.ports !== undefined
    )
      continue;
    if (cells === store.cells) cells = { ...cells };
    cells[cell.id] = { ...cell, ports: architecturePorts() };
  }
  return cells === store.cells ? store : { ...store, cells };
}

/** Membership uses pre-drag bounds; a dragged member must not grow its target. */
export function normalizeArchitectureContainers(
  before: CellStore,
  candidate: CellStore,
  registry: CellRegistry,
): CellStore {
  let cells = candidate.cells;
  const replace = (cell: Cell) => {
    if (cells === candidate.cells) cells = { ...cells };
    cells[cell.id] = cell;
  };
  const layers = Object.values(cells).filter(
    (cell): cell is NodeCell<ArchitectureLayerData> =>
      isNodeCell(cell) && cell.kind === 'architecture-layer',
  );
  const nextIndex = indexCells(candidate, registry);
  const oldGeometry = new Map<string, NodeGeometry>();
  for (const frame of Object.values(before.cells))
    if (isFrameCell(frame))
      layoutArchitectureCells(before, frame.id).forEach((g, id) =>
        oldGeometry.set(id, g),
      );
  const boundsOf = (layer: NodeCell) =>
    layer.geometry.derived
      ? (oldGeometry.get(layer.id) ?? layer.geometry)
      : layer.geometry;
  const positionChanged = (layer: NodeCell) => {
    const previous = before.cells[layer.id];
    return (
      isNodeCell(previous) &&
      !layer.geometry.derived &&
      (layer.geometry.x !== previous.geometry.x ||
        layer.geometry.y !== previous.geometry.y)
    );
  };
  // A presentation edit replaces a cell too. Only layout inputs can make its
  // container authored; unrelated files share this same assembled store.
  const placementInputs = (cell: Cell | undefined) =>
    isNodeCell(cell)
      ? [cell.geometry, (cell.data as { placed?: boolean } | undefined)?.placed]
      : undefined;
  const layoutInputs = (
    store: CellStore,
    layer: NodeCell<ArchitectureLayerData> | undefined,
  ) =>
    layer && [
      layer.geometry,
      layer.data?.order,
      layer.data?.layoutPaddingTop,
      (layer.data?.memberIds ?? []).map((id) => [
        id,
        placementInputs(store.cells[id]),
      ]),
    ];
  const oldIndex = indexCells(before, registry);
  const changedOrder = new Map<string, boolean>();
  const orderChanged = (frameId: string | undefined) => {
    if (!frameId) return false;
    if (!changedOrder.has(frameId))
      changedOrder.set(
        frameId,
        JSON.stringify(architectureLayerIds(before, frameId)) !==
          JSON.stringify(architectureLayerIds(candidate, frameId)),
      );
    return changedOrder.get(frameId)!;
  };
  for (const layer of layers) {
    const old = before.cells[layer.id],
      previous = oldGeometry.get(layer.id);
    if (!isNodeCell(old) || !previous || !positionChanged(layer)) continue;
    const dx = layer.geometry.x - previous.x,
      dy = layer.geometry.y - previous.y;
    if (!dx && !dy) continue;
    const members = layer.data?.memberIds ?? [];
    // The common move planner carries every member. A batch that also lays out
    // members already supplies their positions, including members left in place.
    const positionedMembers = members.some((id) => {
      const node = cells[id],
        previous = before.cells[id];
      return (
        isNodeCell(node) &&
        isNodeCell(previous) &&
        (node.geometry.x !== previous.geometry.x ||
          node.geometry.y !== previous.geometry.y)
      );
    });
    assertWholeGroupsMoved(before, [
      ...members,
      ...Object.keys(cells).filter((id) => {
        const a = before.cells[id],
          b = cells[id];
        return (
          isNodeCell(a) &&
          isNodeCell(b) &&
          (a.geometry.x !== b.geometry.x || a.geometry.y !== b.geometry.y)
        );
      }),
    ]);
    for (const id of members) {
      const node = cells[id],
        oldNode = before.cells[id];
      if (!isNodeCell(node) || !isNodeCell(oldNode)) continue;
      if (node.locked || lockedByAncestor(candidate, id))
        throw new Error('Architecture member is locked');
      if (
        positionedMembers ||
        node.geometry.x !== oldNode.geometry.x ||
        node.geometry.y !== oldNode.geometry.y
      )
        continue;
      const displayed = oldGeometry.get(id) ?? oldNode.geometry;
      replace({
        ...node,
        geometry: {
          ...displayed,
          x: displayed.x + dx,
          y: displayed.y + dy,
          derived: false,
        },
        data: { ...(node.data as object), placed: true },
      });
    }
  }
  const moved = Object.values(cells).filter((node): node is NodeCell => {
    const old = before.cells[node.id];
    return (
      isNodeCell(node) &&
      node.kind === 'architecture-module' &&
      isNodeCell(old) &&
      node.geometry.width === old.geometry.width &&
      node.geometry.height === old.geometry.height &&
      (node.geometry.x !== old.geometry.x || node.geometry.y !== old.geometry.y)
    );
  });
  if (
    Object.values(cells).some(
      (cell) => cell.kind === 'swimlane' && cell !== before.cells[cell.id],
    ) &&
    moved.length
  ) {
    const operations = Object.values(cells)
      .filter((cell) => cell !== before.cells[cell.id])
      .map((cell) => ({ type: 'replace_cell' as const, cell }));
    const selected = [
      ...moved.map((cell) => cell.id),
      ...layers.filter(positionChanged).map((layer) => layer.id),
    ];
    for (const op of planArchitectureDrop(
      before,
      selected,
      operations,
      registry,
    ))
      if (op.type === 'replace_cell' && op.cell.kind === 'architecture-layer')
        replace(op.cell);
  }
  for (const original of layers) {
    let layer = cells[original.id] as NodeCell<ArchitectureLayerData>;
    const previous = before.cells[layer.id] as
      NodeCell<ArchitectureLayerData> | undefined;
    if (!previous && layer.geometry.derived) continue;
    const relevant =
      oldIndex.parentOf.get(layer.id) !== nextIndex.parentOf.get(layer.id) ||
      orderChanged(nextIndex.parentOf.get(layer.id)) ||
      JSON.stringify(layoutInputs(before, previous)) !==
        JSON.stringify(layoutInputs({ ...candidate, cells }, layer));
    if (!relevant) continue;
    const base = boundsOf(layer);
    // Materialize untouched legacy members before making the container authored.
    for (const id of layer.data!.memberIds) {
      const member = cells[id];
      if (
        isNodeCell(member) &&
        member.geometry.derived &&
        oldGeometry.has(id) &&
        JSON.stringify(placementInputs(member)) ===
          JSON.stringify(placementInputs(before.cells[id]))
      )
        replace({
          ...member,
          geometry: { ...oldGeometry.get(id)!, derived: false },
          data: { ...(member.data as object), placed: true },
        });
    }
    layer = { ...layer, geometry: { ...base, derived: false } };
    const projected = layoutArchitectureCells(
      { ...candidate, cells: { ...cells, [layer.id]: layer } },
      nextIndex.parentOf.get(layer.id)!,
    ).get(layer.id)!;
    replace({ ...layer, geometry: projected });
  }
  // Old layers acquire ports atomically when actually referenced by a new edge.
  for (const edge of Object.values(cells)) {
    if (
      edge.cellType !== 'edge' ||
      edge.kind !== 'architecture-edge' ||
      edge === before.cells[edge.id]
    )
      continue;
    for (const terminal of [edge.source, edge.target]) {
      const layer = 'cellId' in terminal ? cells[terminal.cellId] : undefined;
      if (
        isNodeCell(layer) &&
        layer.kind === 'architecture-layer' &&
        layer.ports === undefined
      )
        replace({ ...layer, ports: architecturePorts() });
    }
  }
  let next = { ...candidate, cells };
  for (const frame of Object.values(cells)) {
    if (!isFrameCell(frame)) continue;
    const ids = moved
      .filter((m) => nextIndex.parentOf.get(m.id) === frame.id)
      .map((m) => m.id);
    if (!ids.length) continue;
    const positions = ids.map((id) => ({
      type: 'replace_cell' as const,
      cell: cells[id],
    }));
    for (const op of planLaneDrop(next, frame.id, ids, positions, registry))
      if (op.type === 'replace_cell' && registry.get(op.cell.kind)?.lanes)
        replace(op.cell);
    next = { ...candidate, cells };
  }
  return cells === candidate.cells ? candidate : next;
}

/** Authored movement changes ownership; layout and explicit geometry edits do not. */
export function planArchitectureDrop(
  store: CellStore,
  selected: readonly string[],
  operations: readonly import('@sue/board-core').CellOperation[],
  registry: CellRegistry,
): import('@sue/board-core').CellOperation[] {
  const cells = { ...store.cells };
  for (const op of operations)
    if (op.type === 'replace_cell') cells[op.cell.id] = op.cell;
  const candidate = { ...store, cells };
  const index = indexCells(store, registry);
  const layers = Object.values(cells).filter(
    (c): c is NodeCell<ArchitectureLayerData> =>
      isNodeCell(c) && c.kind === 'architecture-layer',
  );
  const displayed = new Map<string, NodeGeometry>();
  for (const frame of Object.values(store.cells))
    if (isFrameCell(frame))
      layoutArchitectureCells(store, frame.id).forEach((g, id) =>
        displayed.set(id, g),
      );
  const roots = new Set(selected.flatMap((id) => groupLeafMembers(store, id)));
  const changed = new Map<string, NodeCell<ArchitectureLayerData>>();
  const processed = new Set<string>();
  for (const id of roots) {
    const node = cells[id];
    if (
      !isNodeCell(node) ||
      node.kind !== 'architecture-module' ||
      processed.has(id)
    )
      continue;
    let root = id,
      group = directGroupOf(store, root);
    while (group) {
      root = group;
      group = directGroupOf(store, root);
    }
    const ids = root === id ? [id] : groupLeafMembers(store, root);
    ids.forEach((id) => processed.add(id));
    const modules = ids
      .map((id) => cells[id])
      .filter(
        (c): c is NodeCell => isNodeCell(c) && c.kind === 'architecture-module',
      );
    if (
      modules.some((m) =>
        selected.includes(index.domainOwnerOf.get(m.id) ?? ''),
      )
    )
      continue;
    const bounds = unionCellBounds(
      ids
        .map((id) => cells[id])
        .filter(isNodeCell)
        .map((c) => geometryBounds(c.geometry)),
    );
    if (!bounds) continue;
    const target = [...layers].reverse().find((layer) => {
      const g = layer.geometry.derived
        ? (displayed.get(layer.id) ?? layer.geometry)
        : layer.geometry;
      return (
        !layer.hidden &&
        index.parentOf.get(layer.id) === index.parentOf.get(node.id) &&
        laneContains(
          { ...g, y: g.y + 44, height: Math.max(0, g.height - 44) },
          bounds,
        )
      );
    });
    for (const module of modules)
      for (const layer of layers) {
        const current = changed.get(layer.id) ?? layer;
        const old = current.data!.memberIds;
        const next =
          target?.id === layer.id
            ? [...old.filter((id) => id !== module.id), module.id]
            : old.filter((id) => id !== module.id);
        if (JSON.stringify(next) === JSON.stringify(old)) continue;
        if (
          current.locked ||
          module.locked ||
          lockedByAncestor(candidate, current.id) ||
          lockedByAncestor(candidate, module.id)
        )
          throw new Error('Architecture layer or member is locked');
        changed.set(layer.id, {
          ...current,
          data: { ...current.data!, memberIds: next },
        });
      }
  }
  return [
    ...operations,
    ...[...changed.values()].map((cell) => ({
      type: 'replace_cell' as const,
      cell,
    })),
  ];
}
