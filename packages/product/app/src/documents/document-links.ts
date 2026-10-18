export type DocumentLink =
  | { kind: 'file'; fileId: string; anchor: string | null }
  | { kind: 'external'; url: string };

const hasControlCharacters = (value: string): boolean => {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};

const decode = (value: string): string | null => {
  try {
    const decoded = decodeURIComponent(value);
    return hasControlCharacters(decoded) ? null : decoded;
  } catch {
    return null;
  }
};

/** Workspace identities are opaque: a link never becomes a filesystem path. */
export const createDocumentLink = (fileId: string, anchor?: string | null) =>
  `verd://file/${encodeURIComponent(fileId)}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;

/** Resolves only workspace identities, same-document fragments and HTTP(S). */
export const parseDocumentLink = (
  href: string,
  sourceFileId?: string,
): DocumentLink | null => {
  if (!href || href.trim() !== href || hasControlCharacters(href)) return null;

  if (href.startsWith('#')) {
    if (!sourceFileId) return null;
    const anchor = decode(href.slice(1));
    return anchor === null
      ? null
      : { kind: 'file', fileId: sourceFileId, anchor: anchor || null };
  }

  const internal = /^verd:\/\/file\/([^/?#]+)(?:#(.*))?$/i.exec(href);
  if (internal) {
    const fileId = decode(internal[1]);
    const anchor = decode(internal[2] ?? '');
    return fileId && anchor !== null
      ? { kind: 'file', fileId, anchor: anchor || null }
      : null;
  }

  try {
    const url = new URL(href);
    if (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.hostname &&
      !url.username &&
      !url.password
    )
      return { kind: 'external', url: url.href };
  } catch {
    // Malformed and relative URLs have no navigation target.
  }
  return null;
};
