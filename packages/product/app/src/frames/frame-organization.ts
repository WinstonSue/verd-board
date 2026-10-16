import type { CellId } from '@sue/board-core';
import type { FrameFileDiagnostic, FrameFileV2 } from './frame-files';

/**
 * Workspace organization is an outer file field. It is not an engine
 * parent/child link, a navigation session, or workspace config.
 * Missing means a legacy file that stays an independent entry until the
 * user organizes it. `subgraph` without an owner is explicitly unorganized.
 */
export type FrameOrganization =
  { kind: 'standalone' } | { kind: 'subgraph'; ownerFrameId?: CellId };

export type DiagramKind = 'canvas' | 'mind' | 'workflow' | 'architecture';

export type OrganizationPlacement =
  | { kind: 'legacy' }
  | { kind: 'standalone' }
  | { kind: 'owned'; ownerFrameId: CellId }
  | { kind: 'unorganized'; retainedOwnerId?: CellId };

export interface FrameOrganizationView {
  fileId: CellId;
  diagram: DiagramKind;
  placement: OrganizationPlacement;
}

export interface FrameOrganizationIndex {
  byFile: Map<CellId, FrameOrganizationView>;
  /** Regular canvases that currently have at least one attached subgraph. */
  owners: CellId[];
  ownedBy: Map<CellId, CellId[]>;
  standalone: CellId[];
  /** Explicitly unorganized, or broken attachments that still keep an owner id. */
  unorganized: CellId[];
  /** Files with no organization field. They stay independent entries. */
  legacy: CellId[];
  diagnostics: FrameFileDiagnostic[];
}

const ANCHORS: Record<string, DiagramKind> = {
  'mind-root': 'mind',
  'workflow-start': 'workflow',
  'architecture-layer': 'architecture',
};

/** Diagram type comes from scene anchors already stored on the file. */
export const diagramKindOf = (file: FrameFileV2): DiagramKind => {
  for (const id of file.frame.children) {
    const kind = file.cells[id]?.kind;
    if (kind && ANCHORS[kind]) return ANCHORS[kind];
  }
  return 'canvas';
};

export const isSpecializedDiagram = (file: FrameFileV2) =>
  diagramKindOf(file) !== 'canvas';

export const isRegularCanvas = (file: FrameFileV2) =>
  diagramKindOf(file) === 'canvas';

/** Save, conflict, and history compare. Organization is part of the file. */
export const sameFrameFile = (left: FrameFileV2, right: FrameFileV2) =>
  JSON.stringify(left) === JSON.stringify(right);

/** Runtime sync compare. Camera, selection, and tools ignore organization. */
export const sameFrameContent = (left: FrameFileV2, right: FrameFileV2) =>
  JSON.stringify({ frame: left.frame, cells: left.cells }) ===
  JSON.stringify({ frame: right.frame, cells: right.cells });

export const organizationOf = (
  file: FrameFileV2,
): FrameOrganization | undefined => file.organization;

/**
 * Accepts a well-formed organization object. Anything else is invalid input:
 * the file stays readable and the caller surfaces a diagnostic without
 * rewriting the stored field.
 */
export const parseFrameOrganization = (
  value: unknown,
): { ok: true; organization?: FrameOrganization } | { ok: false } => {
  if (value === undefined) return { ok: true };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ok: false };
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'standalone')
    return { ok: true, organization: { kind: 'standalone' } };
  if (kind === 'subgraph') {
    const owner = (value as { ownerFrameId?: unknown }).ownerFrameId;
    if (owner === undefined)
      return { ok: true, organization: { kind: 'subgraph' } };
    if (typeof owner === 'string' && owner.length > 0)
      return {
        ok: true,
        organization: { kind: 'subgraph', ownerFrameId: owner },
      };
    return { ok: false };
  }
  return { ok: false };
};

const cloneOrganization = (
  organization: FrameOrganization | undefined,
): FrameOrganization | undefined =>
  organization ? { ...organization } : undefined;

/**
 * Existing ids keep the organization already stored for that id.
 * Brand-new specialized diagrams take an explicit creation owner.
 * Import and legacy partition omit `creationOwnerId`, so they never
 * auto-attach a subgraph.
 */
export const stampPartitionOrganization = (
  file: FrameFileV2,
  options?: {
    existing?: ReadonlyMap<CellId, FrameFileV2>;
    creationOwnerId?: CellId;
  },
): FrameFileV2 => {
  const existing = options?.existing?.get(file.frame.id);
  if (existing) {
    const organization = cloneOrganization(existing.organization);
    if (!organization) {
      const next = { ...file };
      delete next.organization;
      return next;
    }
    return { ...file, organization };
  }
  const ownerId = options?.creationOwnerId;
  if (ownerId && ownerId !== file.frame.id && isSpecializedDiagram(file))
    return {
      ...file,
      organization: { kind: 'subgraph', ownerFrameId: ownerId },
    };
  const next = { ...file };
  delete next.organization;
  return next;
};

export type CopyOwnershipMode = 'retarget' | 'keep-owner' | 'assign-owner';

/**
 * Ownership of a duplicated file. The root follows the operation; a
 * dependency whose owner was not copied becomes unorganized. Ownership is
 * never walked backward to pull a parent canvas into the copy.
 */
export const organizationForCopy = (
  original: FrameFileV2,
  idMap: ReadonlyMap<CellId, CellId>,
  options: {
    mode: CopyOwnershipMode;
    isRoot: boolean;
    assignOwnerId?: CellId;
  },
): FrameOrganization | undefined => {
  const org = original.organization;
  if (options.isRoot && options.mode === 'assign-owner') {
    if (isSpecializedDiagram(original) && options.assignOwnerId)
      return { kind: 'subgraph', ownerFrameId: options.assignOwnerId };
    if (org?.kind === 'standalone' || isRegularCanvas(original))
      return { kind: 'standalone' };
    return undefined;
  }
  if (options.isRoot && options.mode === 'keep-owner') {
    if (org?.kind === 'subgraph')
      return org.ownerFrameId
        ? { kind: 'subgraph', ownerFrameId: org.ownerFrameId }
        : { kind: 'subgraph' };
    if (org?.kind === 'standalone') return { kind: 'standalone' };
    return undefined;
  }
  if (!org) return undefined;
  if (org.kind === 'standalone') return { kind: 'standalone' };
  const owner = org.ownerFrameId;
  if (owner && idMap.has(owner))
    return { kind: 'subgraph', ownerFrameId: idMap.get(owner)! };
  return { kind: 'subgraph' };
};

/**
 * An imported subgraph keeps its owner only when that owner file is in the
 * package. A matching id in the destination workspace is not an owner.
 */
export const settleImportedOrganization = (
  files: FrameFileV2[],
): FrameFileV2[] => {
  const present = new Set(files.map((file) => file.frame.id));
  return files.map((file) => {
    const org = file.organization;
    if (!org || org.kind !== 'subgraph') return file;
    if (org.ownerFrameId && present.has(org.ownerFrameId)) return file;
    return { ...file, organization: { kind: 'subgraph' } };
  });
};

const retained = (ownerFrameId: CellId | undefined) =>
  ownerFrameId ? { retainedOwnerId: ownerFrameId } : {};

/**
 * Navigation placement. Invalid organization is reported and not rewritten.
 * Specialized diagrams with a broken attachment show as unorganized and keep
 * the original owner id when one was stored. Regular canvases stay independent.
 */
export const buildOrganizationIndex = (
  files: FrameFileV2[],
): FrameOrganizationIndex => {
  const byId = new Map(files.map((file) => [file.frame.id, file]));
  const diagnostics: FrameFileDiagnostic[] = [];
  const byFile = new Map<CellId, FrameOrganizationView>();
  const note = (file: FrameFileV2, message: string) =>
    diagnostics.push({ frameId: file.frame.id, message });

  files.forEach((file) => {
    const diagram = diagramKindOf(file);
    const parsed = parseFrameOrganization(file.organization);
    let placement: OrganizationPlacement;
    if (!parsed.ok) {
      note(file, 'Invalid organization was kept unread and not rewritten');
      placement = isSpecializedDiagram(file)
        ? { kind: 'unorganized' }
        : { kind: 'legacy' };
    } else if (!parsed.organization) {
      placement = { kind: 'legacy' };
    } else if (parsed.organization.kind === 'standalone') {
      placement = { kind: 'standalone' };
    } else if (!isSpecializedDiagram(file)) {
      note(file, 'A regular canvas cannot be a subgraph');
      placement = { kind: 'legacy' };
    } else {
      const ownerId = parsed.organization.ownerFrameId;
      const owner = ownerId ? byId.get(ownerId) : undefined;
      if (!ownerId) placement = { kind: 'unorganized' };
      else if (ownerId === file.frame.id) {
        note(file, 'A chart cannot own itself');
        placement = { kind: 'unorganized' };
      } else if (!owner) {
        placement = { kind: 'unorganized', ...retained(ownerId) };
      } else if (
        !isRegularCanvas(owner) ||
        owner.organization?.kind === 'subgraph'
      ) {
        note(
          file,
          'Subgraphs can only belong to a regular canvas, one level deep',
        );
        placement = { kind: 'unorganized', ...retained(ownerId) };
      } else placement = { kind: 'owned', ownerFrameId: ownerId };
    }
    byFile.set(file.frame.id, { fileId: file.frame.id, diagram, placement });
  });

  const ownedBy = new Map<CellId, CellId[]>();
  const standalone: CellId[] = [];
  const unorganized: CellId[] = [];
  const legacy: CellId[] = [];
  byFile.forEach((view) => {
    if (view.placement.kind === 'owned') {
      const list = ownedBy.get(view.placement.ownerFrameId) ?? [];
      list.push(view.fileId);
      ownedBy.set(view.placement.ownerFrameId, list);
    } else if (view.placement.kind === 'standalone')
      standalone.push(view.fileId);
    else if (view.placement.kind === 'unorganized')
      unorganized.push(view.fileId);
    else legacy.push(view.fileId);
  });
  ownedBy.forEach((ids) => ids.sort());
  return {
    byFile,
    owners: [...ownedBy.keys()].sort(),
    ownedBy,
    standalone: standalone.sort(),
    unorganized: unorganized.sort(),
    legacy: legacy.sort(),
    diagnostics,
  };
};

/** Commands that would make an illegal owner or subgraph are rejected. */
export const organizationChangeError = (
  file: FrameFileV2,
  organization: FrameOrganization,
  files: ReadonlyMap<CellId, FrameFileV2>,
): string | null => {
  if (organization.kind === 'standalone') return null;
  if (isRegularCanvas(file)) return 'A regular canvas cannot become a subgraph';
  const ownerId = organization.ownerFrameId;
  if (!ownerId) return null;
  if (ownerId === file.frame.id) return 'A chart cannot own itself';
  const owner = files.get(ownerId);
  if (!owner) return 'Owner canvas does not exist';
  if (!isRegularCanvas(owner) || owner.organization?.kind === 'subgraph')
    return 'Only a regular canvas can own a subgraph';
  return null;
};

export interface ReferenceSourceGroup {
  fileId: CellId;
  refIds: CellId[];
}

/** Reference shells grouped by the canvas that contains them. */
export const referenceSourcesOf = (
  files: FrameFileV2[],
  targetId: CellId,
): ReferenceSourceGroup[] => {
  const groups = new Map<CellId, CellId[]>();
  files.forEach((file) => {
    Object.values(file.cells).forEach((cell) => {
      if (
        cell.kind === 'frame-reference' &&
        (cell as { data?: { targetFrameId?: CellId } }).data?.targetFrameId ===
          targetId
      ) {
        const list = groups.get(file.frame.id) ?? [];
        list.push(cell.id);
        groups.set(file.frame.id, list);
      }
    });
  });
  return [...groups.entries()]
    .map(([fileId, refIds]) => ({ fileId, refIds }))
    .sort((a, b) => a.fileId.localeCompare(b.fileId));
};

export interface OrganizeRecommendation {
  fileId: CellId;
  organization: FrameOrganization;
  reason: 'sole-source' | 'multiple-sources' | 'no-references';
}

/**
 * Only specialized diagrams that still have no organization field.
 * Charts the user already organized are not re-inferred.
 */
export const recommendOrganization = (
  files: FrameFileV2[],
): OrganizeRecommendation[] => {
  const index = buildOrganizationIndex(files);
  return files
    .filter(
      (file) => isSpecializedDiagram(file) && file.organization === undefined,
    )
    .map((file) => {
      const sources = referenceSourcesOf(files, file.frame.id).filter(
        (source) => {
          const owner = files.find((item) => item.frame.id === source.fileId);
          return (
            !!owner &&
            isRegularCanvas(owner) &&
            index.byFile.get(owner.frame.id)?.placement.kind !== 'unorganized'
          );
        },
      );
      if (sources.length === 1)
        return {
          fileId: file.frame.id,
          organization: {
            kind: 'subgraph' as const,
            ownerFrameId: sources[0].fileId,
          },
          reason: 'sole-source' as const,
        };
      return {
        fileId: file.frame.id,
        organization: { kind: 'standalone' as const },
        reason: sources.length
          ? ('multiple-sources' as const)
          : ('no-references' as const),
      };
    });
};

export const referenceSourceKey = (ids: readonly string[]) =>
  [...ids].sort().join('\0');

/**
 * An organize row is stale when the file gained an organization field or its
 * reference sources no longer match the preview basis. The caller's previous
 * choice must be replaced by a fresh recommendation.
 */
export const organizePreviewIsStale = (
  basisSources: readonly string[],
  currentSources: readonly string[],
  hasOrganization: boolean,
): boolean =>
  hasOrganization ||
  referenceSourceKey(basisSources) !== referenceSourceKey(currentSources);

/** Owned subgraph ids, not walking through references and not walking upward. */
export const ownedSubgraphIds = (
  files: FrameFileV2[],
  ownerId: CellId,
): CellId[] => buildOrganizationIndex(files).ownedBy.get(ownerId) ?? [];
