import type { RectangleClient } from '../interfaces/rectangle-client';
import { frameScene } from './frame';
import {
  geometryBounds,
  groupLeafMembers,
  lockedByAncestor,
  unionCellBounds,
} from './group';
import type { CellOperation } from './index';
import type { CellRegistry } from './registry';
import {
  isFrameCell,
  isGroupCell,
  isNodeCell,
  type Cell,
  type CellStore,
} from './types';

export interface CellLane {
  id: string;
  label: string;
  bounds: RectangleClient;
  members: readonly string[];
}

export function frameLaneScene(
  store: CellStore,
  frameId: string,
  registry: CellRegistry,
) {
  const anchor = frameScene(store, frameId, registry);
  return registry.scenes.find(
    (scene) =>
      scene.anchorKinds.includes(anchor ?? '') && scene.laneMemberKinds?.length,
  );
}

export function frameLanes(
  store: CellStore,
  frameId: string,
  registry: CellRegistry,
) {
  const frame = store.cells[frameId];
  if (!isFrameCell(frame) || !frameLaneScene(store, frameId, registry))
    return [];
  return frame.children.flatMap((id) => {
    const cell = store.cells[id];
    return ((cell && registry.get(cell.kind)?.lanes?.(cell)) || []).map(
      (lane) => ({ ...lane, containerId: id }),
    );
  });
}

export const laneContains = (lane: RectangleClient, bounds: RectangleClient) =>
  bounds.x >= lane.x - 1e-6 &&
  bounds.y >= lane.y - 1e-6 &&
  bounds.x + bounds.width <= lane.x + lane.width + 1e-6 &&
  bounds.y + bounds.height <= lane.y + lane.height + 1e-6;

export function planLaneDrop(
  store: CellStore,
  frameId: string,
  ids: readonly string[],
  operations: readonly CellOperation[],
  registry: CellRegistry,
  assignment?: { containerId: string; laneId: string } | null,
): CellOperation[] {
  const scene = frameLaneScene(store, frameId, registry);
  const lanes = frameLanes(store, frameId, registry);
  if (
    !scene ||
    !lanes.length ||
    ids.some((id) => lanes.some((lane) => lane.containerId === id))
  )
    return [...operations];
  const byId = new Map(
    operations.flatMap((op) =>
      op.type === 'replace_cell' ? [[op.cell.id, op.cell] as const] : [],
    ),
  );
  const changed = new Map<string, Map<string, string[]>>();
  const setMembers = (lane: (typeof lanes)[number], members: string[]) => {
    const container = store.cells[lane.containerId];
    if (container.locked || lockedByAncestor(store, container.id))
      throw new Error('Swimlane is locked');
    let tracks = changed.get(container.id);
    if (!tracks) changed.set(container.id, (tracks = new Map()));
    tracks.set(lane.id, members);
  };
  const membersOf = (lane: (typeof lanes)[number]) =>
    changed.get(lane.containerId)?.get(lane.id) ?? lane.members;
  const positionOps: CellOperation[] = [];
  const keepDomainOwners = new Set<string>();
  for (const id of ids) {
    const original = store.cells[id];
    const leaves = isGroupCell(original) ? groupLeafMembers(store, id) : [id];
    const nodes = leaves
      .map((leaf) => byId.get(leaf) ?? store.cells[leaf])
      .filter(isNodeCell);
    if (
      !nodes.length ||
      nodes.some((node) => !scene.laneMemberKinds!.includes(node.kind))
    )
      continue;
    if (assignment === undefined && !nodes.some((node) => byId.has(node.id)))
      continue;
    const bounds = unionCellBounds(
      nodes.map((node) => geometryBounds(node.geometry)),
    )!;
    const x = bounds.x + bounds.width / 2,
      y = bounds.y + bounds.height / 2;
    const target =
      assignment === null
        ? undefined
        : assignment
          ? lanes.find(
              (lane) =>
                lane.id === assignment.laneId &&
                lane.containerId === assignment.containerId,
            )
          : [...lanes]
              .reverse()
              .find(
                (lane) =>
                  !store.cells[lane.containerId].hidden &&
                  x >= lane.bounds.x &&
                  x <= lane.bounds.x + lane.bounds.width &&
                  y >= lane.bounds.y &&
                  y <= lane.bounds.y + lane.bounds.height,
              );
    if (assignment && !target) throw new Error('Swimlane is unavailable');
    if (target) nodes.forEach((node) => keepDomainOwners.add(node.id));
    if (target && !laneContains(target.bounds, bounds)) {
      if (
        assignment === undefined ||
        bounds.width > target.bounds.width ||
        bounds.height > target.bounds.height
      )
        throw new Error('Swimlane has insufficient space');
      const dx =
        Math.min(
          Math.max(bounds.x, target.bounds.x),
          target.bounds.x + target.bounds.width - bounds.width,
        ) - bounds.x;
      const dy =
        Math.min(
          Math.max(bounds.y, target.bounds.y),
          target.bounds.y + target.bounds.height - bounds.height,
        ) - bounds.y;
      for (const node of nodes) {
        const placed = registry.get(node.kind)?.translate?.(node, [dx, dy]);
        positionOps.push({
          type: 'replace_cell',
          cell: {
            ...node,
            ...(isNodeCell(placed) ? placed : undefined),
            geometry: {
              ...node.geometry,
              x: node.geometry.x + dx,
              y: node.geometry.y + dy,
              derived: false,
            },
          },
        });
      }
    }
    for (const node of nodes) {
      if (node.locked || lockedByAncestor(store, node.id))
        throw new Error('Swimlane member is locked');
      const previous = lanes.find((lane) => membersOf(lane).includes(node.id));
      if (previous === target) continue;
      if (previous)
        setMembers(
          previous,
          membersOf(previous).filter((member) => member !== node.id),
        );
      if (target) setMembers(target, [...membersOf(target), node.id]);
    }
  }
  const moves = operations.map((op) => {
    if (op.type !== 'replace_cell') return op;
    const util = registry.get(op.cell.kind);
    if (!util?.members || !util.withMembers) return op;
    const old = store.cells[op.cell.id];
    const members = old && util.members(old);
    if (
      members &&
      [...members, ...(util.members(op.cell) ?? [])].some((id) =>
        keepDomainOwners.has(id),
      )
    )
      return { ...op, cell: util.withMembers(op.cell, members) };
    return op;
  });
  return [
    ...moves,
    ...positionOps,
    ...Array.from(changed, ([id, tracks]): CellOperation => {
      const cell: Cell = store.cells[id];
      return {
        type: 'replace_cell',
        cell: registry.get(cell.kind)!.withLaneMembers!(cell, tracks),
      };
    }),
  ];
}
