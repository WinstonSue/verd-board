import {
  umlReferences,
  remapUmlCell,
  umlClipboardSequence,
  planUmlPaste,
  type UmlClipboardSequence,
} from './uml';
import { normalizeCellPositionOperations } from './position';
import { stripFrameViewports } from './types';
import {
  isEdgeCell,
  isFrameCell,
  isGroupCell,
  isNodeCell,
  type Cell,
  type CellId,
  type CellStore,
  type EdgeCell,
  type NodeGeometry,
} from './types';
import type { Point } from '../interfaces/point';
import { portAnchor, relativeAnchor } from '../geometry/edge';
import type { CellOperation, CellRegistry, CellSelection } from './index';
import { frameScene } from './frame';
import { groupLeafMembers, lockedByAncestor } from './group';
import { indexCells } from './index';
import { sceneAnchorKind } from './kinds';

export interface CellFragment {
  cells: Record<CellId, Cell>;
  umlSequence?: UmlClipboardSequence;
  ids: CellId[];
  /** Captured before cut, so independent domain owners survive deletion. */
  source?: {
    rootId: CellId;
    frameId: CellId;
    ownerById: Record<CellId, CellId>;
  };
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const freePoint = (store: CellStore, terminal: EdgeCell['source']): Point => {
  if ('point' in terminal) return [...terminal.point];
  const cell = store.cells[terminal.cellId];
  if (!cell || !isNodeCell(cell)) return [0, 0];
  if (terminal.anchor) return relativeAnchor(cell.geometry, terminal.anchor);
  const port = cell.ports?.find((port) => port.id === terminal.portId);
  return port
    ? portAnchor(cell.geometry, port).point
    : [
        cell.geometry.x + cell.geometry.width / 2,
        cell.geometry.y + cell.geometry.height / 2,
      ];
};
export const copyCellFragment = (
  store: CellStore,
  ids: readonly CellId[],
): CellFragment => {
  store = stripFrameViewports(store);
  const included = new Set<CellId>();
  const visit = (id: CellId) => {
    const cell = store.cells[id];
    if (!cell || included.has(id)) return;
    included.add(id);
    if (cell.kind.startsWith('uml-')) {
      umlReferences(cell).forEach(visit);
      if (isEdgeCell(cell)) {
        if ('cellId' in cell.source) visit(cell.source.cellId);
        if ('cellId' in cell.target) visit(cell.target.cellId);
      }
    }
    if (isFrameCell(cell)) [...cell.children, ...cell.groups].forEach(visit);
    if (isGroupCell(cell)) cell.members.forEach(visit);
    (
      (cell as { data?: { memberIds?: string[] } }).data?.memberIds ?? []
    ).forEach(visit);
    if (cell.kind === 'mind-root' || cell.kind === 'mind-child')
      Object.values(store.cells).forEach((edge) => {
        if (
          isEdgeCell(edge) &&
          edge.kind === 'mind-branch' &&
          'cellId' in edge.source &&
          edge.source.cellId === id &&
          'cellId' in edge.target
        ) {
          visit(edge.target.cellId);
          visit(edge.id);
        }
      });
  };
  ids.forEach(visit);
  Object.values(store.cells).forEach((cell) => {
    if (
      isEdgeCell(cell) &&
      'cellId' in cell.source &&
      'cellId' in cell.target &&
      included.has(cell.source.cellId) &&
      included.has(cell.target.cellId) &&
      (cell.kind !== 'uml-message' ||
        (ids.includes(cell.source.cellId) &&
          ids.includes(cell.target.cellId)) ||
        included.has(cell.id))
    )
      included.add(cell.id);
  });
  Object.values(store.cells).forEach((edge) => {
    if (
      !isEdgeCell(edge) ||
      edge.kind !== 'mind-summary-edge' ||
      !('cellId' in edge.target)
    )
      return;
    const range = edge.data as
      { startSiblingId: string; endSiblingId: string } | undefined;
    const branch = range
      ? Object.values(store.cells).find(
          (cell) =>
            isEdgeCell(cell) &&
            cell.kind === 'mind-branch' &&
            'cellId' in cell.target &&
            cell.target.cellId === range.startSiblingId,
        )
      : undefined;
    if (
      range &&
      included.has(range.startSiblingId) &&
      included.has(range.endSiblingId) &&
      branch &&
      isEdgeCell(branch) &&
      'cellId' in branch.source &&
      included.has(branch.source.cellId)
    )
      visit(edge.target.cellId);
  });
  const cells: Record<string, Cell> = {};
  included.forEach((id) => {
    const cell = copy(store.cells[id]);
    if (isEdgeCell(cell)) {
      if (cell.kind === 'mind-summary-edge') {
        const range = cell.data as
          { startSiblingId: string; endSiblingId: string } | undefined;
        if (
          !range ||
          !included.has(range.startSiblingId) ||
          !included.has(range.endSiblingId)
        )
          return;
      }
      const sourceMissing =
        'cellId' in cell.source && !included.has(cell.source.cellId);
      const targetMissing =
        'cellId' in cell.target && !included.has(cell.target.cellId);
      if ((sourceMissing || targetMissing) && cell.kind !== 'arrow') return;
      if (sourceMissing) cell.source = { point: freePoint(store, cell.source) };
      if (targetMissing) cell.target = { point: freePoint(store, cell.target) };
    }
    cells[id] = cell;
  });
  Object.values(store.cells).forEach((edge) => {
    if (
      isEdgeCell(edge) &&
      edge.kind === 'mind-summary-edge' &&
      'cellId' in edge.source &&
      'cellId' in edge.target &&
      cells[edge.source.cellId] &&
      cells[edge.target.cellId]
    ) {
      const range = edge.data as
        { startSiblingId?: string; endSiblingId?: string } | undefined;
      if (
        range?.startSiblingId &&
        range?.endSiblingId &&
        cells[range.startSiblingId] &&
        cells[range.endSiblingId]
      )
        cells[edge.id] = copy(edge);
    }
  });
  Object.values(cells).forEach((cell) => {
    if (
      cell.kind === 'mind-summary' &&
      !Object.values(cells).some(
        (edge) =>
          isEdgeCell(edge) &&
          edge.kind === 'mind-summary-edge' &&
          'cellId' in edge.target &&
          edge.target.cellId === cell.id,
      )
    )
      delete cells[cell.id];
  });
  const descendants = new Set(
    Object.values(cells).flatMap((cell) =>
      isFrameCell(cell) ? [...cell.children, ...cell.groups] : [],
    ),
  );
  const index = indexCells(store);
  const ownerById = Object.fromEntries(
    Object.keys(cells).flatMap((id) => {
      const owner = index.domainOwnerOf.get(id);
      return owner && !cells[owner] ? [[id, owner]] : [];
    }),
  );
  const frameId = ids.length ? index.parentOf.get(ids[0]) : undefined;
  return {
    cells,
    ...(frameId
      ? {
          umlSequence: umlClipboardSequence(
            store,
            frameId,
            included,
            new Set(ids),
          ),
        }
      : {}),
    ...(frameId && Object.keys(ownerById).length
      ? { source: { rootId: store.rootId, frameId, ownerById } }
      : {}),
    ids: Object.keys(cells).filter((id) => !descendants.has(id)),
  };
};

export const pasteCellFragment = (
  fragment: CellFragment,
  parentId: string,
  allocateId: (previous: string) => string,
  offset: Point = [20, 20],
  targetMindNodeId?: string,
  adjust?: (
    cell: Cell,
    context: { sourceId: string; nested: boolean; offset: Point },
  ) => Cell | null,
): CellOperation[] => {
  const mapping = new Map(
    Object.keys(fragment.cells).map((id) => [id, allocateId(id)]),
  );
  if (new Set(mapping.values()).size !== mapping.size)
    throw new Error('Paste ids must be unique');
  const remap = (id: string) => mapping.get(id) ?? id;
  const nestedIds = new Set(
    Object.values(fragment.cells).flatMap((cell) =>
      isFrameCell(cell) ? [...cell.children, ...cell.groups] : [],
    ),
  );
  const cells = Object.values(fragment.cells)
    .map((original) => {
      const shift: Point = nestedIds.has(original.id) ? [0, 0] : offset;
      const cell = remapUmlCell(copy(original), remap) as Cell;
      cell.id = remap(cell.id);
      if (isNodeCell(cell))
        cell.geometry = {
          ...cell.geometry,
          x: cell.geometry.x + shift[0],
          y: cell.geometry.y + shift[1],
        };
      if (isFrameCell(cell)) {
        cell.children = cell.children.map(remap);
        cell.groups = cell.groups.map(remap);
      }
      if (isGroupCell(cell)) cell.members = cell.members.map(remap);
      if (isEdgeCell(cell)) {
        cell.source =
          'cellId' in cell.source
            ? { ...cell.source, cellId: remap(cell.source.cellId) }
            : {
                point: [
                  cell.source.point[0] + shift[0],
                  cell.source.point[1] + shift[1],
                ],
              };
        cell.target =
          'cellId' in cell.target
            ? { ...cell.target, cellId: remap(cell.target.cellId) }
            : {
                point: [
                  cell.target.point[0] + shift[0],
                  cell.target.point[1] + shift[1],
                ],
              };
      }
      if (isEdgeCell(cell) && 'points' in cell.route && cell.route.points)
        cell.route.points = cell.route.points.map(([x, y]) => [
          x + shift[0],
          y + shift[1],
        ]);
      if (
        isNodeCell(cell) &&
        cell.kind === 'mind-child' &&
        !Object.values(fragment.cells).some(
          (edge) =>
            isEdgeCell(edge) &&
            edge.kind === 'mind-branch' &&
            'cellId' in edge.target &&
            edge.target.cellId === original.id,
        )
      ) {
        cell.kind = 'mind-root';
        cell.geometry.derived = false;
        // A detached branch becomes an independent tree; roots must stay expanded.
        if (cell.data && typeof cell.data === 'object')
          delete (cell.data as { collapsed?: boolean }).collapsed;
      }
      const data = (
        cell as {
          data?: {
            memberIds?: string[];
            startSiblingId?: string;
            endSiblingId?: string;
          };
        }
      ).data;
      if (data?.memberIds) data.memberIds = data.memberIds.map(remap);
      if (data?.startSiblingId)
        data.startSiblingId = remap(data.startSiblingId);
      if (data?.endSiblingId) data.endSiblingId = remap(data.endSiblingId);
      if (!adjust) return cell;
      return adjust(cell, {
        sourceId: original.id,
        nested: nestedIds.has(original.id),
        offset: shift,
      });
    })
    .filter((cell): cell is Cell => !!cell);
  // Insert frames empty first; attach descendants through operations rather than duplicate hierarchy references.
  const parents = new Map<string, string>();
  cells.forEach((cell) => {
    if (isFrameCell(cell))
      [...cell.children, ...cell.groups].forEach((id) =>
        parents.set(id, cell.id),
      );
  });
  if (targetMindNodeId)
    cells
      .filter(
        (cell) =>
          !parents.has(cell.id) &&
          isNodeCell(cell) &&
          cell.kind === 'mind-root',
      )
      .forEach((cell, index) => {
        if (!isNodeCell(cell)) return;
        cell.kind = 'mind-child';
        cell.geometry.derived = true;
        cells.push({
          id: allocateId(`paste-branch-${index}`),
          kind: 'mind-branch',
          cellType: 'edge',
          source: { cellId: targetMindNodeId },
          target: { cellId: cell.id },
          route: { mode: 'auto' },
          data: { order: `paste-${cell.id}` },
        });
      });
  const depth = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) throw new Error('Clipboard frame hierarchy cycle');
    seen.add(id);
    return parents.has(id) ? 1 + depth(parents.get(id)!, seen) : 0;
  };
  return cells
    .sort((a, b) => depth(a.id) - depth(b.id))
    .map((cell) => ({
      type: 'insert_cell',
      cell: isFrameCell(cell) ? { ...cell, children: [], groups: [] } : cell,
      parentId: parents.get(cell.id) ?? parentId,
    }));
};

export interface CellPasteRequest {
  store: CellStore;
  frameId: string;
  selectionIds: readonly string[];
  fragment: CellFragment;
  allocateId: (previous: string) => string;
  offset?: Point;
  registry?: CellRegistry;
  geometry?: ReadonlyMap<string, NodeGeometry>;
  /** Mind paste still passes the selected topic. Core does not infer a domain target. */
  targetMindNodeId?: string;
  /** File open replaces a frame and does not ask for an ownership target. */
  intent?: 'paste' | 'duplicate' | 'import' | 'open';
}
export interface CellPastePlan {
  operations: CellOperation[];
  selection: CellSelection;
}
const fragmentScene = (fragment: CellFragment) => {
  const nested = new Set(
    Object.values(fragment.cells).flatMap((cell) =>
      isFrameCell(cell) ? [...cell.children, ...cell.groups] : [],
    ),
  );
  return sceneAnchorKind(
    Object.values(fragment.cells)
      .filter((cell) => !nested.has(cell.id))
      .map((cell) => cell.kind),
  );
};
/** Plans one paste. A rejected plan does not describe a partial transaction. */
export const planCellPaste = (request: CellPasteRequest): CellPastePlan => {
  const frame = request.store.cells[request.frameId];
  if (!isFrameCell(frame)) throw new Error('Missing frame');
  if (
    request.intent !== 'open' &&
    (frame.locked || lockedByAncestor(request.store, frame.id))
  )
    throw new Error('Cannot paste into locked content');
  for (const [id, cell] of Object.entries(request.fragment.cells)) {
    if (
      !cell ||
      cell.id !== id ||
      (cell.cellType !== 'node' &&
        cell.cellType !== 'frame' &&
        cell.cellType !== 'edge' &&
        cell.cellType !== 'group') ||
      typeof cell.kind !== 'string'
    )
      throw new Error('Clipboard does not contain Verd cells');
  }
  if (request.fragment.ids.some((id) => !request.fragment.cells[id]))
    throw new Error('Clipboard does not contain Verd cells');
  const fragmentIds = new Set(Object.keys(request.fragment.cells));
  const incoming = fragmentScene(request.fragment);
  const current = frameScene(request.store, request.frameId);
  if (request.intent !== 'open' && incoming && incoming !== current)
    throw new Error('Cannot mix scenes in one frame');
  const umlPlan = planUmlPaste(request);
  if (umlPlan) return umlPlan;
  let ownerId: string | undefined;
  const ownerById = new Map<string, string>();
  const needsOwner =
    request.intent === 'open'
      ? []
      : Object.values(request.fragment.cells).filter((cell) =>
          request.registry
            ?.get(cell.kind)
            ?.requiresPasteOwner?.(cell, request.fragment),
        );
  const source = request.fragment.source;
  const sameFrame =
    request.intent !== 'import' &&
    source?.rootId === request.store.rootId &&
    source.frameId === request.frameId;
  const selectionIds = request.selectionIds.flatMap((id) =>
    groupLeafMembers(request.store, id),
  );
  for (const cell of needsOwner) {
    let owner: string | undefined;
    if (sameFrame) {
      owner = source.ownerById?.[cell.id];
      const target = owner ? request.store.cells[owner] : undefined;
      const index = indexCells(request.store);
      const expected = cell.kind.startsWith('workflow-')
        ? 'workflow-start'
        : 'architecture-layer';
      if (
        !target ||
        target.kind !== expected ||
        index.parentOf.get(target.id) !== request.frameId
      )
        throw new Error('Original paste owner is no longer available');
    } else
      owner = request.registry
        ?.get(cell.kind)
        ?.pasteOwner?.(request.store, request.frameId, selectionIds);
    if (!owner)
      throw new Error('Select a target first (target must be unambiguous)');
    if (
      request.store.cells[owner]?.locked ||
      lockedByAncestor(request.store, owner)
    )
      throw new Error('Cannot paste into a locked owner');
    ownerById.set(cell.id, owner);
  }
  const owners = new Set(ownerById.values());
  if (owners.size === 1) ownerId = [...owners][0];
  for (const cell of Object.values(request.fragment.cells)) {
    const message = request.registry
      ?.get(cell.kind)
      ?.rejectPaste?.(
        request.store,
        request.frameId,
        request.fragment.cells,
        ownerId,
      );
    if (message) throw new Error(message);
  }
  const mapping = new Map(
    Object.keys(request.fragment.cells).map((id) => [
      id,
      request.allocateId(id),
    ]),
  );
  const operations = pasteCellFragment(
    request.fragment,
    request.frameId,
    (id) => mapping.get(id) ?? request.allocateId(id),
    request.offset ?? [20, 20],
    request.targetMindNodeId,
    (cell, context) => {
      const util = request.registry?.get(cell.kind);
      return (
        util?.adjustPastedCell?.(cell, {
          ...context,
          geometry: request.geometry,
          ownerId: ownerById.get(context.sourceId),
          fragmentIds,
        }) ?? cell
      );
    },
  );
  const extras: CellOperation[] = [];
  if (request.registry) {
    // Complete each external owner once with only its orphan members.
    for (const owner of owners) {
      const members = needsOwner.filter(
        (cell) => ownerById.get(cell.id) === owner,
      );
      const cells = Object.fromEntries(members.map((cell) => [cell.id, cell]));
      const kinds = new Set(members.map((cell) => cell.kind));
      const completedOwners = new Set<string>();
      for (const kind of kinds) {
        for (const operation of request.registry
          .get(kind)
          ?.completePaste?.(
            request.store,
            request.frameId,
            mapping,
            cells,
            owner,
          ) ?? []) {
          if (
            operation.type === 'replace_cell' &&
            operation.cell.id === owner
          ) {
            if (completedOwners.has(owner)) continue;
            completedOwners.add(owner);
          }
          extras.push(operation);
        }
      }
    }
    // Complete contained anchors independently, preserving their remapped ownership.
    const containedKinds = new Set(
      Object.values(request.fragment.cells)
        .filter((cell) => !ownerById.has(cell.id))
        .map((cell) => cell.kind),
    );
    for (const kind of containedKinds)
      extras.push(
        ...(request.registry
          .get(kind)
          ?.completePaste?.(
            request.store,
            request.frameId,
            mapping,
            request.fragment.cells,
            undefined,
          ) ?? []),
      );
  }
  const seen = new Set<string>();
  const completed = (
    request.intent === 'open'
      ? [...operations, ...extras]
      : normalizeCellPositionOperations(request.store, [
          ...operations,
          ...extras,
        ])
  ).filter((operation) => {
    const key = JSON.stringify(operation);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const grouped = new Set(
    Object.values(request.fragment.cells).flatMap((cell) =>
      isGroupCell(cell) ? cell.members.map((id) => mapping.get(id) ?? id) : [],
    ),
  );
  const ids = request.fragment.ids
    .map((id) => mapping.get(id))
    .filter((id): id is string => !!id && !grouped.has(id));
  return {
    operations: completed,
    selection: { focus: [request.frameId], ids },
  };
};
