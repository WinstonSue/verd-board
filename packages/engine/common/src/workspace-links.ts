/** Workspace identities are opaque; links never contain filesystem paths. */
export type WorkspaceTarget =
  | { kind: 'file'; fileId: string }
  | { kind: 'heading'; fileId: string; slug: string }
  | { kind: 'cell'; fileId: string; cellId: string };

const valid = (value: string) =>
  !!value &&
  ![...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const decode = (value: string): string | null => {
  try {
    const decoded = decodeURIComponent(value);
    return decoded && !valid(decoded) ? null : decoded;
  } catch {
    return null;
  }
};

export function createWorkspaceLink(target: WorkspaceTarget): string {
  if (!valid(target.fileId)) throw new Error('Invalid workspace file identity');
  const anchor =
    target.kind === 'cell'
      ? `cell:${target.cellId}`
      : target.kind === 'heading'
        ? target.slug
        : '';
  if (
    target.kind !== 'file' &&
    !valid(target.kind === 'cell' ? target.cellId : target.slug)
  )
    throw new Error('Invalid workspace link target');
  return `verd://file/${encodeURIComponent(target.fileId)}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
}

export function parseWorkspaceLink(
  href: string,
  sourceFileId?: string,
): WorkspaceTarget | null {
  if (!href || href.trim() !== href || !valid(href)) return null;
  let fileId: string | null, fragment: string | null;
  if (href.startsWith('#')) {
    fileId = sourceFileId && valid(sourceFileId) ? sourceFileId : null;
    fragment = decode(href.slice(1));
  } else {
    const match = /^verd:\/\/file\/([^/?#]+)(?:#(.*))?$/i.exec(href);
    if (!match) return null;
    fileId = decode(match[1]);
    fragment = decode(match[2] ?? '');
  }
  if (!fileId || fragment === null) return null;
  if (!fragment) return { kind: 'file', fileId };
  if (fragment.startsWith('cell:')) {
    const cellId = fragment.slice(5);
    return valid(cellId) ? { kind: 'cell', fileId, cellId } : null;
  }
  return { kind: 'heading', fileId, slug: fragment };
}

export interface WorkspaceLinkRemapContext {
  idMap: ReadonlyMap<string, string>;
  sourceFileId?: string;
  targetFileId?: string;
  targetOwnerOf?(cellId: string): string | undefined;
}
export function remapWorkspaceLink(
  href: string,
  context: WorkspaceLinkRemapContext,
): string {
  const target = parseWorkspaceLink(href, context.sourceFileId);
  if (!target) return href;
  let next: WorkspaceTarget;
  if (target.kind === 'cell') {
    // A copied link to a target outside the copied fragment still points at
    // the original target, even when its containing file was duplicated.
    if (!context.idMap.has(target.cellId))
      return href.startsWith('#') &&
        context.sourceFileId &&
        (context.targetFileId
          ? context.targetFileId !== context.sourceFileId
          : context.idMap.has(context.sourceFileId))
        ? createWorkspaceLink(target)
        : href;
    const cellId = context.idMap.get(target.cellId) ?? target.cellId;
    next = {
      ...target,
      cellId,
      fileId: context.idMap.has(target.cellId)
        ? (context.targetOwnerOf?.(cellId) ??
          context.idMap.get(target.fileId) ??
          target.fileId)
        : (context.idMap.get(target.fileId) ?? target.fileId),
    };
  } else
    next = {
      ...target,
      fileId: context.idMap.get(target.fileId) ?? target.fileId,
    };
  if (
    (!href.startsWith('#') ||
      !context.sourceFileId ||
      !(context.targetFileId
        ? context.targetFileId !== context.sourceFileId
        : context.idMap.has(context.sourceFileId))) &&
    next.fileId === target.fileId &&
    (target.kind !== 'cell' ||
      (next.kind === 'cell' && next.cellId === target.cellId))
  )
    return href;
  return createWorkspaceLink(next);
}

/** External navigation stays separate from workspace target parsing. */
export function parseExternalLink(href: string): string | null {
  if (!href || href.trim() !== href || !valid(href)) return null;
  try {
    const url = new URL(href);
    return ['http:', 'https:'].includes(url.protocol) &&
      url.hostname &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
