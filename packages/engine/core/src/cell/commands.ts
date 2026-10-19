import { normalizeCellPositionOperations } from './position';
import {
  deleteCells,
  indexCells,
  parentOf,
  type CellOperation,
  type CellRegistry,
} from './index';
import { frameScene } from './frame';
import {
  cellDeletionLocked,
  directGroupOf,
  groupHasLockedLeaf,
  groupLeafMembers,
  isGroupableCell,
  lockedByAncestor,
} from './group';
import type { Point } from '../interfaces/point';
import {
  isFrameCell,
  isNodeCell,
  isGroupCell,
  isEdgeCell,
  type CellStore,
  type CellId,
  type NodeCell,
  type Cell,
  type NodeAppearance,
} from './types';

export const groupCells = (
  store: CellStore,
  frameId: string,
  ids: readonly CellId[],
  groupId: string,
): CellOperation[] => {
  const frame = store.cells[frameId];
  const unique = [...new Set(ids)];
  if (
    !isFrameCell(frame) ||
    frameScene(store, frameId) === 'mind-root' ||
    frameScene(store, frameId) === 'uml-sequence-root' ||
    unique.length < 2
  )
    throw new Error('Grouping requires at least two frame children');
  const members = unique.filter(
    (id) => parentOf(store, id) === frameId && isGroupableCell(store, id),
  );
  if (members.length !== unique.length)
    throw new Error('Invalid group members');
  if (!selectionMovesAtomically(store, members) || frame.locked)
    throw new Error('Cannot group locked cells');
  const owners = new Set(members.map((id) => directGroupOf(store, id)));
  if (owners.size !== 1) throw new Error('Cells cross group focus');
  const ownerId = [...owners][0];
  const owner = ownerId ? store.cells[ownerId] : undefined;
  const leaves = members.flatMap((id) =>
    isGroupCell(store.cells[id]) ? groupLeafMembers(store, id) : [id],
  );
  const drawn = frame.children.filter((id) => leaves.includes(id));
  const first = Math.min(...drawn.map((id) => frame.children.indexOf(id)));
  const order = frame.children.filter((id) => !drawn.includes(id));
  order.splice(Math.max(0, first), 0, ...drawn);
  return [
    ...(!frameScene(store, frameId)
      ? [{ type: 'replace_cell' as const, cell: { ...frame, children: order } }]
      : []),
    ...(isGroupCell(owner)
      ? [
          {
            type: 'replace_cell' as const,
            cell: {
              ...owner,
              members: owner.members.flatMap((id) =>
                id === owner.members.find((id) => members.includes(id))
                  ? [groupId]
                  : members.includes(id)
                    ? []
                    : [id],
              ),
            },
          },
        ]
      : []),
    {
      type: 'insert_cell',
      parentId: frameId,
      cell: { id: groupId, kind: 'group', cellType: 'group', members },
    },
  ];
};
export const moveGroup = (
  store: CellStore,
  groupId: string,
  delta: Point,
): CellOperation[] => {
  const group = store.cells[groupId];
  if (!isGroupCell(group)) throw new Error('Missing group');
  if (
    group.locked ||
    groupHasLockedLeaf(store, groupId) ||
    lockedByAncestor(store, groupId)
  )
    return [];
  return translateCellSelection(store, [groupId], delta);
};

const selectionMovesAtomically = (store: CellStore, ids: readonly string[]) =>
  ids.every((id) => {
    const cell = store.cells[id];
    if (!cell || cell.locked || lockedByAncestor(store, id)) return false;
    return !(isGroupCell(cell) && groupHasLockedLeaf(store, id));
  });

/** Translate a whiteboard selection, treating groups as a unit and Frames as shells. */
export const translateCellSelection = (
  store: CellStore,
  ids: readonly string[],
  delta: Point,
): CellOperation[] => {
  // A locked object in the selection blocks the whole move. Skipping it would
  // leave the unlocked siblings shifted on their own.
  if (
    !selectionMovesAtomically(store, ids) ||
    ids.some(
      (id) =>
        store.cells[id]?.kind.startsWith('uml-') &&
        store.cells[id]?.kind !== 'uml-class' &&
        store.cells[id]?.kind !== 'uml-relation',
    )
  )
    return [];
  const cells = appearanceCells(
    store,
    ids.filter((id) => {
      const cell = store.cells[id];
      return (
        !isGroupCell(cell) ||
        (!cell.locked &&
          !groupHasLockedLeaf(store, id) &&
          !lockedByAncestor(store, id))
      );
    }),
  );
  const translate = (point: Point): Point => [
    point[0] + delta[0],
    point[1] + delta[1],
  ];
  return normalizeCellPositionOperations(
    store,
    cells.flatMap((cell): CellOperation[] => {
      if (isNodeCell(cell))
        return [
          {
            type: 'replace_cell',
            cell: {
              ...cell,
              geometry: {
                ...cell.geometry,
                x: cell.geometry.x + delta[0],
                y: cell.geometry.y + delta[1],
                derived: false,
              },
              ...(cell.kind === 'architecture-module'
                ? { data: { ...(cell.data as object), placed: true } }
                : cell.kind === 'workflow-start'
                  ? {
                      data: {
                        ...(cell.data as import('./types').WorkflowStartData),
                        origin: translate(
                          (cell.data as import('./types').WorkflowStartData)
                            .origin,
                        ),
                      },
                    }
                  : {}),
            },
          },
        ];
      if (isEdgeCell(cell))
        return [
          {
            type: 'replace_cell',
            cell: {
              ...cell,
              source:
                'point' in cell.source
                  ? { point: translate(cell.source.point) }
                  : cell.source,
              target:
                'point' in cell.target
                  ? { point: translate(cell.target.point) }
                  : cell.target,
              route:
                'points' in cell.route && cell.route.points
                  ? { ...cell.route, points: cell.route.points.map(translate) }
                  : cell.route,
            },
          },
        ];
      return [];
    }),
  );
};
export { alignCells, distributeCells, arrangeCells } from './arrangement';
export const reorderCells = (
  store: CellStore,
  frameId: string,
  ids: readonly string[],
  direction: 'front' | 'back' | 'forward' | 'backward',
): CellOperation[] => {
  const frame = store.cells[frameId];
  if (!isFrameCell(frame)) throw new Error('Missing frame');
  const selected = new Set(ids);
  const groups = frame.groups.map((id) => store.cells[id]).filter(isGroupCell);
  const blocks: { ids: string[]; selected: boolean }[] = [];
  const visited = new Set<string>();
  frame.children.forEach((id) => {
    if (visited.has(id)) return;
    const group = groups
      .filter((group) => groupLeafMembers(store, group.id).includes(id))
      .sort(
        (left, right) =>
          groupLeafMembers(store, right.id).length -
          groupLeafMembers(store, left.id).length,
      )[0];
    const members = group
      ? frame.children.filter((id) =>
          groupLeafMembers(store, group.id).includes(id),
        )
      : [id];
    members.forEach((id) => visited.add(id));
    blocks.push({
      ids: members,
      selected:
        !group?.locked &&
        !lockedByAncestor(store, group?.id ?? id) &&
        (selected.has(group?.id ?? id) ||
          members.some((id) => selected.has(id))) &&
        !members.some((id) => store.cells[id]?.locked) &&
        !(group && groupHasLockedLeaf(store, group.id)),
    });
  });
  let ordered: typeof blocks;
  if (direction === 'front')
    ordered = [
      ...blocks.filter((block) => !block.selected),
      ...blocks.filter((block) => block.selected),
    ];
  else if (direction === 'back')
    ordered = [
      ...blocks.filter((block) => block.selected),
      ...blocks.filter((block) => !block.selected),
    ];
  else {
    ordered = [...blocks];
    if (direction === 'forward')
      for (let i = ordered.length - 2; i >= 0; i--) {
        if (ordered[i].selected && !ordered[i + 1].selected)
          [ordered[i], ordered[i + 1]] = [ordered[i + 1], ordered[i]];
      }
    else
      for (let i = 1; i < ordered.length; i++) {
        if (ordered[i].selected && !ordered[i - 1].selected)
          [ordered[i], ordered[i - 1]] = [ordered[i - 1], ordered[i]];
      }
  }
  const children = ordered.flatMap((block) => block.ids);
  return [{ type: 'replace_cell', cell: { ...frame, children } }];
};

/** Group selection edits its visible members without traversing nested Frame content. */
export const appearanceCells = (
  store: CellStore,
  ids: readonly string[],
): (NodeCell | import('./types').EdgeCell)[] => {
  const cells = new Map<string, NodeCell | import('./types').EdgeCell>();
  const index = indexCells(store);
  const suppressed = new Set<string>();
  ids.forEach((id) => {
    const cell = store.cells[id];
    if (!isGroupCell(cell)) return;
    if (
      cell.locked ||
      lockedByAncestor(store, id) ||
      groupHasLockedLeaf(store, id)
    )
      groupLeafMembers(store, id).forEach((leaf) => suppressed.add(leaf));
  });
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id) || suppressed.has(id)) return;
    visited.add(id);
    const cell = store.cells[id];
    if (!cell || cell.locked || lockedByAncestor(store, id)) return;
    const ownerId = index.groupOf.get(id);
    const owner = ownerId ? store.cells[ownerId] : undefined;
    if (isGroupCell(owner) && owner.locked) return;
    if (isGroupCell(cell)) cell.members.forEach(visit);
    else if (isNodeCell(cell) || cell.cellType === 'edge') cells.set(id, cell);
  };
  ids.forEach(visit);
  return [...cells.values()];
};

export const updateCellAppearance = (
  store: CellStore,
  ids: readonly string[],
  patch: Partial<NodeAppearance>,
): CellOperation[] =>
  appearanceCells(store, ids).map((cell) => {
    const appearance = { ...cell.appearance, ...patch };
    if (!isNodeCell(cell)) delete (appearance as Partial<NodeAppearance>).fill;
    return { type: 'replace_cell', cell: { ...cell, appearance } as Cell };
  });

/** A multi-selection action applies only when every object allows it. */
export const selectionAllows = (
  store: CellStore,
  ids: readonly string[],
  registry: CellRegistry,
  capability: 'delete' | 'move' | 'edit' | 'resize' | 'rotate' | 'connect',
  mountedFrameId = store.rootId,
) => {
  const parents = indexCells(store).parentOf;
  const allowed = (id: string): boolean => {
    const cell = store.cells[id];
    if (!cell || cell.locked || lockedByAncestor(store, id)) return false;
    if (capability === 'delete' && cellDeletionLocked(store, id)) return false;
    for (let owner = parents.get(id); owner; owner = parents.get(owner))
      if (store.cells[owner]?.locked) return false;
    if (isGroupCell(cell)) {
      if (
        ['resize', 'rotate', 'connect'].includes(capability) ||
        groupHasLockedLeaf(store, id)
      )
        return false;
      return groupLeafMembers(store, id).every(allowed);
    }
    const mount =
      isFrameCell(cell) && parents.has(id) && id !== mountedFrameId
        ? 'embedded'
        : 'root';
    const caps = registry.get(cell.kind)?.capabilities?.(store, cell, mount);
    return !caps || caps[capability] !== false;
  };
  return ids.length > 0 && ids.every(allowed);
};

/** Remove only the selected group level, promoting members to its parent. */
export const ungroupCells = (
  store: CellStore,
  ids: readonly CellId[],
): CellOperation[] => {
  const groups = [...new Set(ids)]
    .map((id) => store.cells[id])
    .filter(isGroupCell);
  if (
    !groups.length ||
    !selectionMovesAtomically(
      store,
      groups.map((g) => g.id),
    )
  )
    return [];
  const updates = new Map<string, import('./types').GroupCell>();
  const selected = new Set(groups.map((g) => g.id));
  for (const group of groups) {
    const ownerId = directGroupOf(store, group.id);
    const owner = ownerId
      ? (updates.get(ownerId) ?? store.cells[ownerId])
      : undefined;
    if (isGroupCell(owner) && !selected.has(owner.id))
      updates.set(owner.id, {
        ...owner,
        members: owner.members.flatMap((id) =>
          id === group.id ? group.members : [id],
        ),
      });
  }
  return [
    ...[...updates.values()].map((cell) => ({
      type: 'replace_cell' as const,
      cell,
    })),
    ...groups.map((group) => ({
      type: 'remove_cell' as const,
      cellId: group.id,
    })),
  ];
};

/** Locking a group never changes its members' individual lock flags. */
export const setCellsLocked = (
  store: CellStore,
  ids: readonly CellId[],
  locked: boolean,
): CellOperation[] =>
  [...new Set(ids)].flatMap((id) => {
    const cell = store.cells[id];
    if (!cell || lockedByAncestor(store, id) || !!cell.locked === locked)
      return [];
    return [{ type: 'replace_cell' as const, cell: { ...cell, locked } }];
  });

/** Domain operations must not move only part of an existing rigid group. */
export const assertWholeGroupsMoved = (
  store: CellStore,
  ids: readonly CellId[],
) => {
  const moved = new Set(ids);
  for (const cell of Object.values(store.cells)) {
    if (!isGroupCell(cell)) continue;
    const leaves = groupLeafMembers(store, cell.id).filter((id) =>
      isNodeCell(store.cells[id]),
    );
    if (
      leaves.some((id) => moved.has(id)) &&
      !leaves.every((id) => moved.has(id))
    )
      throw new Error('Ungroup first to move part of a group');
  }
};

/** Clear the mounted document while preserving its required scene anchors and view. */
export const clearFrameCells = (
  store: CellStore,
  frameId: string,
): CellOperation[] => {
  const frame = store.cells[frameId];
  if (!isFrameCell(frame)) throw new Error('Missing frame');
  const scene = frameScene(store, frameId);
  const anchors = frame.children.filter((id) => store.cells[id].kind === scene);
  // Workflow starts cannot be removed independently of their owning Frame.
  const retained = new Set(
    scene === 'workflow-start' ? anchors : anchors.slice(0, 1),
  );
  return deleteCells(store, [
    ...frame.groups,
    ...frame.children.filter((id) => !retained.has(id)),
  ]);
};
