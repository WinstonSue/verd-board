import type { BoardTheme, Viewport } from '@sue/board-core';

export const ARCHITECTURE_DOCUMENT_VERSION = 2 as const;

export type ArchitectureNodeKind = 'box' | 'decision' | 'store';

export interface ArchitecturePoint {
  x: number;
  y: number;
}

export interface ArchitectureNode {
  id: string;
  label: string;
  kind: ArchitectureNodeKind;
  /** 拖过之后记住的场景坐标。没有它时仍按所在层排成一行。 */
  position?: ArchitecturePoint;
}

export interface ArchitectureLayer {
  id: string;
  label: string;
  nodes: ArchitectureNode[];
}

export interface ArchitectureEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface ArchitectureDocument {
  version: typeof ARCHITECTURE_DOCUMENT_VERSION;
  layers: ArchitectureLayer[];
  edges: ArchitectureEdge[];
  viewport?: Viewport;
  theme?: BoardTheme;
}

export const isArchitectureDocument = (
  value: unknown,
): value is ArchitectureDocument => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<ArchitectureDocument>;
  return (
    candidate.version === ARCHITECTURE_DOCUMENT_VERSION &&
    Array.isArray(candidate.layers) &&
    Array.isArray(candidate.edges)
  );
};
