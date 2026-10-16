import {
  createFrameCell,
  isEdgeCell,
  isFrameCell,
  isFrameReferenceCell,
  isGroupCell,
  stripFrameViewports,
  validateCellStore,
  type Cell,
  type CellId,
  type CellRegistry,
  type CellStore,
  type EdgeTerminal,
  type FrameCell,
  type FrameReferenceCell,
  type MindRootData,
  type Point,
} from '@sue/board-core';
import {
  organizationForCopy,
  ownedSubgraphIds,
  settleImportedOrganization,
  stampPartitionOrganization,
  type CopyOwnershipMode,
  type FrameOrganization,
} from './frame-organization';

export type {
  FrameOrganization,
  DiagramKind,
  FrameOrganizationIndex,
  OrganizeRecommendation,
} from './frame-organization';
export {
  buildOrganizationIndex,
  diagramKindOf,
  isRegularCanvas,
  isSpecializedDiagram,
  organizationChangeError,
  organizationForCopy,
  parseFrameOrganization,
  organizePreviewIsStale,
  recommendOrganization,
  referenceSourceKey,
  referenceSourcesOf,
  sameFrameContent,
  sameFrameFile,
  settleImportedOrganization,
} from './frame-organization';

/**
 * One file holds exactly one root Frame plus the non-Frame cells it directly
 * owns: ordinary nodes, edges, groups and frame-reference instances. A file
 * never owns another file's Frame through `children`.
 */
export interface FrameFileV2 {
  format: 'verd-frame';
  version: 2;
  /**
   * Optional workspace organization. Absent on legacy files, which stay
   * independent entries until the user organizes them. Never inferred from
   * the reference graph on read.
   */
  organization?: FrameOrganization;
  frame: FrameCell;
  cells: Record<CellId, Cell>;
}

export interface FrameFileDiagnostic {
  frameId?: CellId;
  cellId?: CellId;
  /** Workspace-relative path when the issue is tied to a file. */
  path?: string;
  message: string;
}

export const isFrameFileV2 = (value: unknown): value is FrameFileV2 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as FrameFileV2;
  return (
    candidate.format === 'verd-frame' &&
    candidate.version === 2 &&
    isFrameCell(candidate.frame) &&
    !!candidate.cells &&
    typeof candidate.cells === 'object' &&
    !Array.isArray(candidate.cells) &&
    !Object.hasOwn(candidate.cells, candidate.frame.id) &&
    Object.entries(candidate.cells).every(
      ([id, cell]) =>
        !!cell &&
        typeof cell === 'object' &&
        cell.id === id &&
        !isFrameCell(cell),
    )
  );
};

export const createFrameFile = (root: FrameCell): FrameFileV2 => ({
  format: 'verd-frame',
  version: 2,
  frame: root,
  cells: {},
});

/**
 * Extracts one file from an assembled store. The owned closure covers group
 * members transitively; frame children are skipped: they belong to their own
 * files and leave the record invalid until externalized.
 */
export const frameFileFor = (store: CellStore, rootId: CellId): FrameFileV2 => {
  const root = store.cells[rootId];
  if (!root || !isFrameCell(root))
    throw new Error(`File root must be a frame: ${rootId}`);
  const cells: Record<CellId, Cell> = {};
  const collect = (id: CellId) => {
    const cell = store.cells[id];
    if (!cell || isFrameCell(cell) || cells[id]) return;
    cells[id] = cell;
    if (isGroupCell(cell)) cell.members.forEach(collect);
  };
  [...root.children, ...root.groups].forEach(collect);
  return {
    format: 'verd-frame',
    version: 2,
    frame: stripFrameViewports({ rootId, cells: { [rootId]: root } }).cells[
      rootId
    ] as FrameCell,
    cells,
  };
};

/** Reference instance ids created by migration derive deterministically from the source frame. */
export const MIGRATION_REFERENCE_PREFIX = 'frame-ref:';

export interface ExternalizeResult {
  store: CellStore;
  /** frameId -> created reference cell id, in traversal order. */
  references: Map<CellId, CellId>;
  /**
   * Externalized frame -> the file root that owned it, including frames
   * created inside a group. This is structural context for an explicit
   * creation owner; it is not written as organization by itself.
   */
  owners: Map<CellId, CellId>;
}

const compact = <T extends object>(value: T): T => {
  Object.keys(value).forEach((key) => {
    if ((value as Record<string, unknown>)[key] === undefined)
      delete (value as Record<string, unknown>)[key];
  });
  return value;
};

const retargetTerminal = (
  terminal: EdgeTerminal,
  from: CellId,
  to: CellId,
): EdgeTerminal =>
  'cellId' in terminal && terminal.cellId === from
    ? { ...terminal, cellId: to }
    : terminal;

/** Rewrites one owned cell's references from a departed child frame to its reference instance. */
const retargetOwnedCell = (cell: Cell, from: CellId, to: CellId): Cell => {
  if (isGroupCell(cell) && cell.members.includes(from))
    return {
      ...cell,
      members: cell.members.map((id) => (id === from ? to : id)),
    };
  if (isEdgeCell(cell)) {
    const source = retargetTerminal(cell.source, from, to);
    const target = retargetTerminal(cell.target, from, to);
    if (source !== cell.source || target !== cell.target)
      return { ...cell, source, target };
    return cell;
  }
  const memberIds = (cell as { data?: { memberIds?: CellId[] } }).data
    ?.memberIds;
  if (memberIds?.includes(from))
    return {
      ...cell,
      data: {
        ...(cell as { data?: object }).data,
        memberIds: memberIds.map((id) => (id === from ? to : id)),
      },
    } as Cell;
  return cell;
};

/**
 * Converts every owned child Frame into an independent root plus a
 * frame-reference instance in the former parent. The instance inherits the
 * shell's position, size, appearance, ports, name, hidden/locked flags, aspect
 * ratio and embedded mind offsets; the promoted root drops hidden/locked and
 * ports, which are meaningless on a file root. Idempotent.
 */
export const externalizeOwnedFrames = (
  store: CellStore,
  exemptParents?: ReadonlySet<CellId>,
): ExternalizeResult => {
  const parents = new Map<CellId, CellId>();
  Object.values(store.cells).forEach((cell) => {
    if (!isFrameCell(cell) || exemptParents?.has(cell.id)) return;
    [...cell.children, ...cell.groups].forEach((childId) => {
      if (!parents.has(childId)) parents.set(childId, cell.id);
    });
  });
  const owned = Object.values(store.cells)
    .filter(isFrameCell)
    .filter((frame) => parents.has(frame.id));
  const ownedIds = new Set(owned.map((frame) => frame.id));
  const owners = new Map<CellId, CellId>();
  owned.forEach((frame) => {
    let cursor = parents.get(frame.id);
    const seen = new Set<CellId>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (!ownedIds.has(cursor)) {
        if (cursor !== WORKSPACE_ROOT_ID) owners.set(frame.id, cursor);
        break;
      }
      cursor = parents.get(cursor);
    }
  });
  if (!owned.length) return { store, references: new Map(), owners };
  const cells = { ...store.cells };
  const references = new Map<CellId, CellId>();
  owned.forEach((frame) => {
    const parentId = parents.get(frame.id)!;
    const parent = cells[parentId];
    if (!parent || !isFrameCell(parent)) return;
    const base = `${MIGRATION_REFERENCE_PREFIX}${frame.id}`;
    let refId = base;
    for (let suffix = 2; cells[refId]; suffix += 1) refId = `${base}#${suffix}`;
    const mindOffsets: Record<CellId, Point> = {};
    frame.children.forEach((childId) => {
      const child = cells[childId];
      if (!child || child.kind !== 'mind-root') return;
      const data = child.data as MindRootData | undefined;
      const offset = data?.embeddedOffset;
      if (
        !offset ||
        !Array.isArray(offset) ||
        offset.length !== 2 ||
        !offset.every(Number.isFinite)
      )
        return;
      mindOffsets[childId] = [offset[0], offset[1]];
      const rest = { ...data };
      delete rest.embeddedOffset;
      cells[childId] = {
        ...child,
        data: Object.keys(rest).length ? rest : undefined,
      };
    });
    const reference = compact<FrameReferenceCell>({
      id: refId,
      kind: 'frame-reference',
      cellType: 'node',
      name: frame.name,
      geometry: {
        x: frame.geometry.x,
        y: frame.geometry.y,
        width: frame.geometry.width,
        height: frame.geometry.height,
      },
      appearance: frame.appearance ? { ...frame.appearance } : undefined,
      ports: frame.ports?.map((port) => ({ ...port })),
      content: frame.content ? { ...frame.content } : undefined,
      data: {
        targetFrameId: frame.id,
        ...(Object.keys(mindOffsets).length ? { mindOffsets } : {}),
      },
      aspectRatio: frame.aspectRatio,
      locked: frame.locked,
      hidden: frame.hidden,
    });
    const promoted: FrameCell = { ...cells[frame.id] } as FrameCell;
    delete promoted.locked;
    delete promoted.hidden;
    delete promoted.ports;
    cells[frame.id] = promoted;
    const reordered = parent.children.map((id) =>
      id === frame.id ? refId : id,
    );
    const promotedParent: FrameCell = { ...parent, children: reordered };
    cells[parentId] = promotedParent;
    [...reordered, ...parent.groups].forEach((ownedId) => {
      const ownedCell = cells[ownedId];
      if (ownedCell)
        cells[ownedId] = retargetOwnedCell(ownedCell, frame.id, refId);
    });
    cells[refId] = reference;
    references.set(frame.id, refId);
  });
  return { store: { ...store, cells }, references, owners };
};

/** Deterministic frame order: traversal from the store root, then remaining roots sorted by id. */
const frameOrder = (store: CellStore): CellId[] => {
  const order: CellId[] = [];
  const visit = (id: CellId) => {
    const cell = store.cells[id];
    if (!cell || !isFrameCell(cell) || order.includes(id)) return;
    order.push(id);
    [...cell.children, ...cell.groups].forEach(visit);
  };
  visit(store.rootId);
  Object.values(store.cells)
    .filter(isFrameCell)
    .map((frame) => frame.id)
    .filter((id) => !order.includes(id))
    .sort()
    .forEach((id) => order.push(id));
  return order;
};

/**
 * Splits an assembled store into one file per Frame. Owned child Frames are
 * externalized into files plus reference instances first, so the result is
 * valid v2 partitions for both canonical and legacy-shaped input.
 */
export interface PartitionOptions {
  /** Files already in the workspace. Their organization is kept by stable id. */
  existing?: ReadonlyMap<CellId, FrameFileV2>;
  /**
   * Explicit owner for specialized diagrams created by this edit.
   * Omitted for import and legacy partition, which must not auto-own.
   */
  creationOwnerId?: CellId;
}

export const partitionCellStore = (
  store: CellStore,
  options?: PartitionOptions,
): {
  files: FrameFileV2[];
  references: Map<CellId, CellId>;
  owners: Map<CellId, CellId>;
} => {
  const isWorkspace = store.rootId === WORKSPACE_ROOT_ID;
  const {
    store: flat,
    references,
    owners,
  } = externalizeOwnedFrames(
    store,
    isWorkspace ? new Set([WORKSPACE_ROOT_ID]) : undefined,
  );
  return {
    files: frameOrder(flat)
      .filter((id) => id !== WORKSPACE_ROOT_ID)
      .map((id) => stampPartitionOrganization(frameFileFor(flat, id), options)),
    references,
    owners,
  };
};

/** The dedicated empty root coordinates independent file roots. It is never saved or shown. */
export const WORKSPACE_ROOT_ID = 'workspace-root';

export interface AssembledFiles {
  cells: Record<CellId, Cell>;
  fileRoots: CellId[];
  diagnostics: FrameFileDiagnostic[];
}

/**
 * Merges file contents into one cell map. Invalid files and identity clashes
 * produce diagnostics instead of silently overwriting a conflicting entry.
 */
export const assembleFrameFiles = (files: FrameFileV2[]): AssembledFiles => {
  const cells: Record<CellId, Cell> = {};
  const fileRoots: CellId[] = [];
  const diagnostics: FrameFileDiagnostic[] = [];
  files.forEach((file, index) => {
    const frameId =
      file && typeof file === 'object' ? file.frame?.id : undefined;
    if (!isFrameFileV2(file)) {
      diagnostics.push({
        frameId: typeof frameId === 'string' ? frameId : undefined,
        message: `Invalid frame file at index ${index}`,
      });
      return;
    }
    if (cells[file.frame.id]) {
      diagnostics.push({
        frameId: file.frame.id,
        message: `Duplicate frame root: ${file.frame.id}`,
      });
      return;
    }
    const clash = Object.keys(file.cells).find((id) => cells[id]);
    if (clash) {
      diagnostics.push({
        frameId: file.frame.id,
        cellId: clash,
        message: `Duplicate cell id across files: ${clash}`,
      });
      return;
    }
    fileRoots.push(file.frame.id);
    cells[file.frame.id] = file.frame;
    Object.assign(cells, file.cells);
  });
  return { cells, fileRoots, diagnostics };
};

/**
 * Merges files into the canonical store: a dedicated empty root owns every
 * file root, keeping all cells reachable and validation single-rooted.
 */
export const assembleWorkspaceStore = (
  files: FrameFileV2[],
  registry?: CellRegistry,
): { store: CellStore; diagnostics: FrameFileDiagnostic[] } => {
  const { cells, fileRoots, diagnostics } = assembleFrameFiles(files);
  const roots = fileRoots.filter((id) => {
    if (id !== WORKSPACE_ROOT_ID) return true;
    diagnostics.push({
      frameId: id,
      message: `Reserved workspace root id: ${id}`,
    });
    return false;
  });
  const root = { ...createFrameCell(WORKSPACE_ROOT_ID), children: roots };
  const store: CellStore = {
    rootId: WORKSPACE_ROOT_ID,
    cells: { ...cells, [WORKSPACE_ROOT_ID]: root },
  };
  validateCellStore(store, registry).forEach((issue) =>
    diagnostics.push({ cellId: issue.cellId, message: issue.message }),
  );
  return { store, diagnostics };
};

export interface FrameReferenceInstance {
  refId: CellId;
  fileId: CellId;
  targetId: CellId;
}

export interface FrameReferenceGraph {
  /** File root ids in input order. */
  files: CellId[];
  /** fileId -> outbound reference instances. */
  targetsOf: Map<CellId, FrameReferenceInstance[]>;
  /** targetFrameId -> inbound reference instances. */
  referencedBy: Map<CellId, FrameReferenceInstance[]>;
}

export const buildFrameReferenceGraph = (
  files: FrameFileV2[],
): FrameReferenceGraph => {
  const targetsOf = new Map<CellId, FrameReferenceInstance[]>();
  const referencedBy = new Map<CellId, FrameReferenceInstance[]>();
  files.forEach((file) => {
    const instances = Object.values(file.cells)
      .filter(isFrameReferenceCell)
      .map((ref) => ({
        refId: ref.id,
        fileId: file.frame.id,
        targetId: ref.data.targetFrameId,
      }));
    targetsOf.set(file.frame.id, instances);
    instances.forEach((instance) =>
      referencedBy.set(instance.targetId, [
        ...(referencedBy.get(instance.targetId) ?? []),
        instance,
      ]),
    );
  });
  return {
    files: files.map((file) => file.frame.id),
    targetsOf,
    referencedBy,
  };
};

/**
 * File-level dependency cycles: file A contains a reference whose target is
 * file B's root (and back, transitively). Rendering would recurse forever, so
 * commits must report them.
 */
export const findFrameReferenceCycles = (
  graph: FrameReferenceGraph,
): CellId[][] => {
  const fileSet = new Set(graph.files);
  const edges = new Map<CellId, CellId[]>();
  graph.targetsOf.forEach((instances, fileId) =>
    edges.set(fileId, [
      ...new Set(
        instances
          .map((instance) => instance.targetId)
          .filter((target) => fileSet.has(target)),
      ),
    ]),
  );
  const cycles: CellId[][] = [];
  const state = new Map<CellId, 'visiting' | 'done'>();
  const stack: CellId[] = [];
  const visit = (id: CellId) => {
    state.set(id, 'visiting');
    stack.push(id);
    (edges.get(id) ?? []).forEach((next) => {
      if (state.get(next) === 'visiting')
        cycles.push([...stack.slice(stack.indexOf(next)), next]);
      else if (!state.has(next)) visit(next);
    });
    stack.pop();
    state.set(id, 'done');
  };
  graph.files.forEach((id) => {
    if (!state.has(id)) visit(id);
  });
  return cycles;
};

/**
 * Per-file structure plus cross-file identity and reference integrity.
 * Unresolved reference targets are legal; targets resolving to a non-root
 * cell and dependency cycles are not.
 */
/**
 * Reference dependencies plus subgraphs owned by visited files.
 * Ownership is not walked backward, so a parent canvas is not pulled in.
 */
export const frameClosure = (
  files: FrameFileV2[],
  rootId: CellId,
): CellId[] => {
  const byId = new Map(files.map((file) => [file.frame.id, file]));
  const order: CellId[] = [];
  const visit = (id: CellId) => {
    if (order.includes(id) || !byId.has(id)) return;
    order.push(id);
    const file = byId.get(id)!;
    Object.values(file.cells)
      .filter(isFrameReferenceCell)
      .forEach((ref) => visit(ref.data.targetFrameId));
    ownedSubgraphIds(files, id).forEach(visit);
  };
  visit(rootId);
  return order;
};

/**
 * Remaps every cell-id-bearing position in one file according to `idMap`.
 * Reference targets and ids outside the map keep their original value — that
 * is exactly what makes ordinary copies share and independent copies break.
 */
const remapFrameFileIds = (
  file: FrameFileV2,
  idMap: ReadonlyMap<CellId, CellId>,
): FrameFileV2 => {
  const remap = (id: CellId) => idMap.get(id) ?? id;
  const remapTerminal = (terminal: EdgeTerminal): EdgeTerminal =>
    'cellId' in terminal
      ? { ...terminal, cellId: remap(terminal.cellId) }
      : terminal;
  const cells: Record<CellId, Cell> = {};
  Object.values(file.cells).forEach((original) => {
    let cell = { ...original, id: remap(original.id) } as Cell;
    if (isFrameCell(cell)) {
      cell = {
        ...cell,
        children: cell.children.map(remap),
        groups: cell.groups.map(remap),
      };
    } else if (isGroupCell(cell)) {
      cell = { ...cell, members: cell.members.map(remap) };
    } else if (isEdgeCell(cell)) {
      cell = {
        ...cell,
        source: remapTerminal(cell.source),
        target: remapTerminal(cell.target),
      };
    } else if (isFrameReferenceCell(cell)) {
      const data = cell.data;
      const mindOffsets = data.mindOffsets
        ? Object.fromEntries(
            Object.entries(data.mindOffsets).map(([id, point]) => [
              remap(id),
              point,
            ]),
          )
        : undefined;
      cell = {
        ...cell,
        data: {
          ...data,
          targetFrameId: remap(data.targetFrameId),
          ...(mindOffsets ? { mindOffsets } : {}),
        },
      };
    }
    const data = (cell as { data?: Record<string, unknown> }).data;
    if (data && typeof data === 'object') {
      const next = { ...data };
      let touched = false;
      ['memberIds'].forEach((key) => {
        const value = next[key];
        if (Array.isArray(value)) {
          next[key] = value.map((id) =>
            typeof id === 'string' ? remap(id) : id,
          );
          touched = true;
        }
      });
      ['startSiblingId', 'endSiblingId'].forEach((key) => {
        if (typeof next[key] === 'string') {
          next[key] = remap(next[key] as CellId);
          touched = true;
        }
      });
      if (touched) cell = { ...cell, data: next } as Cell;
    }
    cells[cell.id] = cell;
  });
  const frame = {
    ...file.frame,
    id: remap(file.frame.id),
    children: file.frame.children.map(remap),
    groups: file.frame.groups.map(remap),
  };
  const organization = file.organization
    ? file.organization.kind === 'subgraph' && file.organization.ownerFrameId
      ? {
          kind: 'subgraph' as const,
          ownerFrameId:
            idMap.get(file.organization.ownerFrameId) ??
            file.organization.ownerFrameId,
        }
      : file.organization
    : undefined;
  return organization
    ? { ...file, frame, cells, organization }
    : { ...file, frame, cells };
};

/**
 * Independent copy: duplicates a file and its full dependency closure with
 * fresh identities. Internal references repoint at the copies; references to
 * files outside the closure keep pointing at the originals.
 */
export const duplicateFrameClosure = (
  files: FrameFileV2[],
  rootId: CellId,
  createId: () => string,
  ownership: {
    mode?: CopyOwnershipMode;
    /** Canvas that should own the new root when copying a reference into it. */
    assignOwnerId?: CellId;
  } = {},
): { files: FrameFileV2[]; rootId: CellId } => {
  const order = frameClosure(files, rootId);
  const byId = new Map(files.map((file) => [file.frame.id, file]));
  const idMap = new Map<CellId, CellId>();
  const allocate = () => {
    let id = createId();
    while (idMap.has(id)) id = createId();
    return id;
  };
  order.forEach((fileId) => {
    const file = byId.get(fileId)!;
    idMap.set(fileId, allocate());
    Object.keys(file.cells).forEach((id) => idMap.set(id, allocate()));
  });
  const mode = ownership.mode ?? 'retarget';
  return {
    files: order.map((fileId) => {
      const original = byId.get(fileId)!;
      const mapped = remapFrameFileIds(original, idMap);
      const organization = organizationForCopy(original, idMap, {
        mode,
        isRoot: fileId === rootId,
        assignOwnerId: ownership.assignOwnerId,
      });
      if (!organization) {
        const next = { ...mapped };
        delete next.organization;
        return next;
      }
      return { ...mapped, organization };
    }),
    rootId: idMap.get(rootId)!,
  };
};

/**
 * Import: remaps only ids that collide with `collide` (existing workspace
 * ids), keeping stable foreign identities where possible. References to
 * targets outside the import set keep their ids — they resolve if such a file
 * exists in the destination, and otherwise stay unresolved placeholders.
 */
export const remapImportedFiles = (
  files: FrameFileV2[],
  collide: (id: CellId) => boolean,
  createId: () => string,
): FrameFileV2[] => {
  const idMap = new Map<CellId, CellId>();
  const claimed = new Set(
    files.flatMap((file) => [file.frame.id, ...Object.keys(file.cells)]),
  );
  const allocate = () => {
    let id = createId();
    while (collide(id) || claimed.has(id)) id = createId();
    claimed.add(id);
    return id;
  };
  files.forEach((file) => {
    [file.frame.id, ...Object.keys(file.cells)].forEach((id) => {
      if (collide(id)) idMap.set(id, allocate());
    });
  });
  return settleImportedOrganization(
    files.map((file) => remapFrameFileIds(file, idMap)),
  );
};

/** Portable single-file or closure export. `rootFileId` is optional for old bundles. */
export interface FrameExportBundle {
  format: 'verd-canvas-bundle';
  version: 1;
  files: FrameFileV2[];
  rootFileId?: CellId;
}

export const frameExportBundle = (
  files: FrameFileV2[],
  rootFileId?: CellId,
): FrameExportBundle => ({
  format: 'verd-canvas-bundle',
  version: 1,
  files,
  ...(rootFileId ? { rootFileId } : {}),
});

/** Old bundles have no root id; the first file is the entry. */
export const frameExportRootId = (
  value: unknown,
  files: FrameFileV2[],
): CellId | undefined => {
  const bundle = value as FrameExportBundle;
  if (
    bundle &&
    typeof bundle === 'object' &&
    typeof bundle.rootFileId === 'string' &&
    files.some((file) => file.frame.id === bundle.rootFileId)
  )
    return bundle.rootFileId;
  return files[0]?.frame.id;
};

/** Accepts a bundle or a bare FrameFileV2 document. */
export const parseFrameExport = (value: unknown): FrameFileV2[] | null => {
  if (isFrameFileV2(value)) return [value];
  const bundle = value as FrameExportBundle;
  if (
    bundle &&
    typeof bundle === 'object' &&
    bundle.format === 'verd-canvas-bundle' &&
    bundle.version === 1 &&
    Array.isArray(bundle.files)
  )
    return bundle.files;
  return null;
};

export const validateFrameFiles = (
  files: FrameFileV2[],
  registry?: CellRegistry,
): FrameFileDiagnostic[] => {
  const diagnostics: FrameFileDiagnostic[] = [];
  const claimed = new Map<CellId, CellId>();
  const valid: FrameFileV2[] = [];
  files.forEach((file, index) => {
    const frameId =
      file && typeof file === 'object' ? file.frame?.id : undefined;
    if (!isFrameFileV2(file)) {
      diagnostics.push({
        frameId: typeof frameId === 'string' ? frameId : undefined,
        message: `Invalid frame file at index ${index}`,
      });
      return;
    }
    if (valid.some((seen) => seen.frame.id === file.frame.id)) {
      diagnostics.push({
        frameId: file.frame.id,
        message: `Duplicate frame root: ${file.frame.id}`,
      });
      return;
    }
    valid.push(file);
    const store: CellStore = {
      rootId: file.frame.id,
      cells: { [file.frame.id]: file.frame, ...file.cells },
    };
    validateCellStore(store, registry).forEach((issue) =>
      diagnostics.push({
        frameId: file.frame.id,
        cellId: issue.cellId,
        message: issue.message,
      }),
    );
    [file.frame.id, ...Object.keys(file.cells)].forEach((id) => {
      const owner = claimed.get(id);
      if (owner !== undefined && owner !== file.frame.id)
        diagnostics.push({
          frameId: file.frame.id,
          cellId: id,
          message: `Duplicate cell id across files: ${id}`,
        });
      else claimed.set(id, file.frame.id);
    });
  });
  const roots = new Set(valid.map((file) => file.frame.id));
  const graph = buildFrameReferenceGraph(valid);
  graph.targetsOf.forEach((instances, fileId) =>
    instances.forEach((instance) => {
      if (claimed.has(instance.targetId) && !roots.has(instance.targetId))
        diagnostics.push({
          frameId: fileId,
          cellId: instance.refId,
          message: `Frame reference target is not a file root: ${instance.targetId}`,
        });
    }),
  );
  findFrameReferenceCycles(graph).forEach((cycle) =>
    diagnostics.push({
      frameId: cycle[0],
      message: `Frame reference cycle: ${cycle.join(' -> ')}`,
    }),
  );
  return diagnostics;
};

/** Recoverable reason to refuse a one-shot reference insert. Null means it may be committed. */
export const assessReferencePlace = (
  files: FrameFileV2[],
  ownerId: CellId,
  targetId: CellId,
): string | null => {
  const owner = files.find((file) => file.frame.id === ownerId);
  if (!owner || !files.some((file) => file.frame.id === targetId))
    return '引用目标已不存在';
  const probeId = '__place_probe__';
  const probe: FrameFileV2 = {
    ...owner,
    frame: { ...owner.frame, children: [...owner.frame.children, probeId] },
    cells: {
      ...owner.cells,
      [probeId]: {
        id: probeId,
        kind: 'frame-reference',
        cellType: 'node',
        geometry: { x: 0, y: 0, width: 10, height: 10 },
        data: { targetFrameId: targetId },
      },
    },
  };
  const issue = validateFrameFiles(
    files.map((file) => (file.frame.id === ownerId ? probe : file)),
  ).find((item) => item.message.startsWith('Frame reference cycle'));
  return issue?.message ?? null;
};
