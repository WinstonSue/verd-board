import { portAnchor, relativeAnchor } from '../geometry/edge';
import type { Point } from '../interfaces/point';
import { frameScene } from './frame';
import { groupLeafMembers, lockedByAncestor } from './group';
import type { CellOperation, CellSelection } from './index';
import { indexCells, listedMembers } from './index';
import { sceneAnchorKind } from './kinds';
import { normalizeCellPositionOperations } from './position';
import {
  assertRegisteredCellKinds,
  createCellRegistry,
  type CellRegistry,
} from './registry';
import {
  isEdgeCell,
  isFrameCell,
  isGroupCell,
  isNodeCell,
  stripFrameViewports,
  type Cell,
  type CellId,
  type CellStore,
  type EdgeCell,
  type NodeGeometry,
} from './types';

export interface CellFragment {
  cells: Record<CellId, Cell>;
  ids: CellId[];
  /** Captured before cut, so independent domain owners survive deletion. */
  source?: {
    rootId: CellId;
    fileId?: CellId;
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
  registry: CellRegistry = createCellRegistry(),
  context?: { fileId?: CellId },
): CellFragment => {
  store = stripFrameViewports(store);
  const included = new Set<CellId>();
  const visit = (id: CellId) => {
    const cell = store.cells[id];
    if (!cell || included.has(id)) return;
    included.add(id);
    for (const plugin of registry.plugins) {
      plugin.references?.(cell).forEach(visit);
      plugin.copyReferences?.(store, cell).forEach(visit);
    }
    if (isFrameCell(cell)) [...cell.children, ...cell.groups].forEach(visit);
    if (isGroupCell(cell)) cell.members.forEach(visit);
    listedMembers(cell, registry).forEach(visit);
  };
  ids.forEach(visit);
  Object.values(store.cells).forEach((cell) => {
    if (
      isEdgeCell(cell) &&
      'cellId' in cell.source &&
      'cellId' in cell.target &&
      included.has(cell.source.cellId) &&
      included.has(cell.target.cellId) &&
      (registry.get(cell.kind)?.copyWithEndpoints !== false ||
        (ids.includes(cell.source.cellId) &&
          ids.includes(cell.target.cellId)) ||
        included.has(cell.id))
    )
      included.add(cell.id);
  });
  for (const plugin of registry.plugins)
    plugin.copy?.(store, ids, included, visit);
  const cells: Record<string, Cell> = {};
  included.forEach((id) => {
    const cell = copy(store.cells[id]);
    if (isEdgeCell(cell)) {
      if (
        registry.plugins.some(
          (plugin) =>
            plugin.filterCopy?.(cell, included, store.cells) === false,
        )
      )
        return;
      const sourceMissing =
        'cellId' in cell.source && !included.has(cell.source.cellId);
      const targetMissing =
        'cellId' in cell.target && !included.has(cell.target.cellId);
      if (
        (sourceMissing || targetMissing) &&
        registry.get(cell.kind)?.freeTerminals !== true
      )
        return;
      if (sourceMissing) cell.source = { point: freePoint(store, cell.source) };
      if (targetMissing) cell.target = { point: freePoint(store, cell.target) };
    }
    cells[id] = cell;
  });
  for (const cell of Object.values(cells))
    if (
      registry.plugins.some(
        (plugin) => plugin.filterCopy?.(cell, included, cells) === false,
      )
    )
      delete cells[cell.id];
  const descendants = new Set(
    Object.values(cells).flatMap((cell) =>
      isFrameCell(cell) ? [...cell.children, ...cell.groups] : [],
    ),
  );
  const index = indexCells(store, registry);
  const ownerById = Object.fromEntries(
    Object.keys(cells).flatMap((id) => {
      const owner = index.domainOwnerOf.get(id);
      return owner && !cells[owner] ? [[id, owner]] : [];
    }),
  );
  const frameId = ids.length ? index.parentOf.get(ids[0]) : undefined;
  return {
    cells,
    ...Object.assign(
      {},
      ...registry.plugins.map((plugin) =>
        frameId
          ? plugin.clipboardMetadata?.(store, frameId, included, new Set(ids))
          : undefined,
      ),
    ),
    ...(frameId
      ? {
          source: {
            rootId: store.rootId,
            fileId: context?.fileId,
            frameId,
            ownerById,
          },
        }
      : {}),
    ids: Object.keys(cells).filter((id) => !descendants.has(id)),
  };
};

const buildPastedCellFragment = (
  fragment: CellFragment,
  parentId: string,
  allocateId: (previous: string) => string,
  offset: Point = [20, 20],
  targetCellId?: string,
  adjust?: (
    cell: Cell,
    context: { sourceId: string; nested: boolean; offset: Point },
  ) => Cell | null,
  registry: CellRegistry = createCellRegistry(),
): { operations: CellOperation[]; idMap: ReadonlyMap<string, string> } => {
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
      let cell = copy(original);
      for (const plugin of registry.plugins)
        cell = plugin.remap?.(cell, remap) ?? cell;
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
      for (const plugin of registry.plugins)
        cell = plugin.preparePaste?.(cell, original, fragment) ?? cell;
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
  if (targetCellId)
    for (const plugin of registry.plugins)
      plugin.pasteCells?.(cells, targetCellId, allocateId);
  const depth = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) throw new Error('Clipboard frame hierarchy cycle');
    seen.add(id);
    return parents.has(id) ? 1 + depth(parents.get(id)!, seen) : 0;
  };
  const operations: CellOperation[] = cells
    .sort((a, b) => depth(a.id) - depth(b.id))
    .map((cell) => ({
      type: 'insert_cell',
      cell: isFrameCell(cell) ? { ...cell, children: [], groups: [] } : cell,
      parentId: parents.get(cell.id) ?? parentId,
    }));
  return { operations, idMap: mapping };
};

/** Finalize after every plugin has formed the copied cells and their ownership. */
const remapPastedLinks = (
  operations: CellOperation[],
  idMap: ReadonlyMap<string, string>,
  fragment: CellFragment,
  targetFrameId: string,
  registry: CellRegistry,
  targetStore?: CellStore,
  targetFileId?: string,
): CellOperation[] => {
  const originalById = new Map(
    [...idMap].map(([source, target]) => [target, source]),
  );
  const sourceOwners = new Map<string, string>();
  for (const cell of Object.values(fragment.cells))
    if (isFrameCell(cell)) {
      sourceOwners.set(cell.id, cell.id);
      for (const id of [...cell.children, ...cell.groups])
        sourceOwners.set(id, cell.id);
    }
  const inserted = new Set<string>();
  const targetOwners = new Map<string, string>();
  if (targetStore)
    for (const cell of Object.values(targetStore.cells))
      if (isFrameCell(cell)) {
        targetOwners.set(cell.id, cell.id);
        for (const id of [...cell.children, ...cell.groups])
          targetOwners.set(id, cell.id);
      }
  for (const operation of operations)
    if (operation.type === 'insert_cell') {
      inserted.add(operation.cell.id);
      targetOwners.set(
        operation.cell.id,
        isFrameCell(operation.cell) ? operation.cell.id : operation.parentId,
      );
    }
  const mapCell = (cell: Cell): Cell => {
    // Existing owners can be patched to attach copied members. Their text is
    // not copied and must never have its original links rewritten.
    if (!inserted.has(cell.id)) return cell;
    const originalId = originalById.get(cell.id);
    return registry.remapLinks(cell, {
      idMap,
      sourceFileId:
        fragment.source?.fileId ??
        fragment.source?.rootId ??
        (originalId && sourceOwners.get(originalId)) ??
        fragment.source?.frameId,
      targetFileId: targetFileId ?? targetStore?.rootId ?? targetFrameId,
      targetOwnerOf: (id) =>
        inserted.has(id)
          ? (targetFileId ?? targetStore?.rootId ?? targetFrameId)
          : targetOwners.get(id),
    });
  };
  return operations.map((operation) => {
    if (operation.type === 'insert_cell' || operation.type === 'replace_cell')
      return { ...operation, cell: mapCell(operation.cell) };
    if (operation.type === 'patch_cells')
      return {
        ...operation,
        cells: Object.fromEntries(
          Object.entries(operation.cells).map(([id, cell]) => [
            id,
            cell ? mapCell(cell) : null,
          ]),
        ),
      };
    return operation;
  });
};

/** Direct clipboard consumers and the higher-level planner share finalization. */
export const pasteCellFragment = (
  ...args: Parameters<typeof buildPastedCellFragment>
): CellOperation[] => {
  const { operations, idMap } = buildPastedCellFragment(...args);
  const [fragment, parentId, , , , , registry = createCellRegistry()] = args;
  return remapPastedLinks(operations, idMap, fragment, parentId, registry);
};

export interface CellPasteRequest {
  /** Canonical owning file, distinct from an assembled store root or nested Frame. */
  fileId?: string;
  store: CellStore;
  frameId: string;
  selectionIds: readonly string[];
  fragment: CellFragment;
  allocateId: (previous: string) => string;
  offset?: Point;
  registry?: CellRegistry;
  geometry?: ReadonlyMap<string, NodeGeometry>;
  /** Optional explicit domain target, interpreted only by the installed plugins. */
  targetCellId?: string;
  /** File open replaces a frame and does not ask for an ownership target. */
  intent?: 'paste' | 'duplicate' | 'import' | 'open';
}
export interface CellPastePlan {
  /** Complete identity mapping, including identities reused by a custom planner. */
  idMap: ReadonlyMap<string, string>;
  operations: CellOperation[];
  selection: CellSelection;
}
const fragmentScene = (fragment: CellFragment, registry: CellRegistry) => {
  const nested = new Set(
    Object.values(fragment.cells).flatMap((cell) =>
      isFrameCell(cell) ? [...cell.children, ...cell.groups] : [],
    ),
  );
  return sceneAnchorKind(
    Object.values(fragment.cells)
      .filter((cell) => !nested.has(cell.id))
      .map((cell) => cell.kind),
    registry,
  );
};
/** Plans one paste. A rejected plan does not describe a partial transaction. */
export const planCellPaste = (request: CellPasteRequest): CellPastePlan => {
  const registry = request.registry ?? createCellRegistry();
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
  assertRegisteredCellKinds(
    { rootId: request.frameId, cells: request.fragment.cells },
    registry,
  );
  const fragmentIds = new Set(Object.keys(request.fragment.cells));
  const incoming = fragmentScene(request.fragment, registry);
  const current = frameScene(request.store, request.frameId, registry);
  if (request.intent !== 'open' && incoming && incoming !== current)
    throw new Error('Cannot mix scenes in one frame');
  for (const plugin of registry.plugins) {
    const plan = plugin.planPaste?.({ ...request, registry });
    if (plan)
      return {
        ...plan,
        operations: remapPastedLinks(
          plan.operations,
          plan.idMap,
          request.fragment,
          request.frameId,
          registry,
          request.store,
          request.fileId,
        ),
      };
  }
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
    const util = registry.get(cell.kind);
    if (
      sameFrame &&
      !(
        util?.preferSelectedPasteOwner &&
        selectionIds.length &&
        request.intent === 'paste'
      )
    ) {
      owner = source.ownerById?.[cell.id];
      const target = owner ? request.store.cells[owner] : undefined;
      const index = indexCells(request.store, registry);
      const expected = registry.get(cell.kind)?.ownerKind;
      if (
        !target ||
        target.kind !== expected ||
        index.parentOf.get(target.id) !== request.frameId
      )
        throw new Error('Original paste owner is no longer available');
    } else
      owner = util?.pasteOwner?.(request.store, request.frameId, selectionIds);
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
  const { operations } = buildPastedCellFragment(
    request.fragment,
    request.frameId,
    (id) => mapping.get(id) ?? request.allocateId(id),
    request.offset ?? [20, 20],
    request.targetCellId,
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
    registry,
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
    idMap: mapping,
    operations: remapPastedLinks(
      completed,
      mapping,
      request.fragment,
      request.frameId,
      registry,
      request.store,
      request.fileId,
    ),
    selection: { focus: [request.frameId], ids },
  };
};
