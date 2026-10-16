import type { BoardTheme, Viewport } from '@sue/board-core';

export const MIND_DOCUMENT_VERSION = 1 as const;

/**
 * @deprecated Host-owned tree kept for the legacy `main_mind_content` store.
 * The standard document is `MindDocument` from `@sue/board-mind`.
 */
export interface LegacyMindHostNode {
  id: string;
  label: string;
  children: LegacyMindHostNode[];
}

/** @deprecated Legacy host tree. The standard document lives in `@sue/board-mind`. */
export interface LegacyMindHostDocument {
  version: typeof MIND_DOCUMENT_VERSION;
  roots: LegacyMindHostNode[];
  viewport?: Viewport;
  theme?: BoardTheme;
}

/** @deprecated Import `MindDocument` from `@sue/board-mind`. */
export type MindDocument = LegacyMindHostDocument;

const isHostNode = (value: unknown): value is LegacyMindHostNode => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as LegacyMindHostNode;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.label === 'string' &&
    Array.isArray(candidate.children) &&
    candidate.children.every(isHostNode)
  );
};

export const isMindDocument = (value: unknown): value is MindDocument => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<MindDocument>;
  return (
    candidate.version === MIND_DOCUMENT_VERSION &&
    Array.isArray(candidate.roots) &&
    candidate.roots.every(isHostNode)
  );
};
