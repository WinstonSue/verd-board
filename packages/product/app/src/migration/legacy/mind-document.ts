import type { BoardTheme, Viewport } from '@sue/board-core';
import type { MindElement, MindRootElement } from './mind-element';

export const MIND_DOCUMENT_VERSION = 2 as const;

/** Canonical mind document. The JSON shape matches stored `mind/<documentId>` content. */
export interface MindDocument {
  version: typeof MIND_DOCUMENT_VERSION;
  /** Primary center. The whiteboard shell renders this tree. */
  root: MindElement;
  /** Additional centers. Absent on older single-center documents. */
  roots?: MindElement[];
  viewport?: Viewport;
  theme?: BoardTheme;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const stripShellFields = (element: MindElement & Record<string, unknown>) => {
  delete element['frame'];
  delete element['contentAnchor'];
  delete element['documentId'];
  delete element['previewAt'];
  delete element['detailViewport'];
  delete element['detailTheme'];
  delete element['detailRoots'];
  element.type = 'mind';
  element.children = element.children ?? [];
};

export const isMindDocument = (value: unknown): value is MindDocument => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<MindDocument>;
  const roots = candidate.roots;
  return (
    candidate.version === MIND_DOCUMENT_VERSION &&
    !!candidate.root &&
    candidate.root.type === 'mind' &&
    Array.isArray(candidate.root.children) &&
    (roots === undefined ||
      (Array.isArray(roots) &&
        roots.every(
          (center) =>
            !!center &&
            center.type === 'mind' &&
            Array.isArray(center.children),
        )))
  );
};

export const mindElementToDocument = (
  element: MindElement & { detailRoots?: MindElement[] },
  viewport?: Viewport,
  theme?: BoardTheme,
): MindDocument => {
  const root = clone(element) as MindElement & Record<string, unknown>;
  const roots = extraCenters(root['detailRoots']);
  const storedViewport =
    viewport ?? (root['detailViewport'] as Viewport | undefined);
  const storedTheme = theme ?? (root['detailTheme'] as BoardTheme | undefined);
  delete root.points;
  stripShellFields(root);
  return {
    version: MIND_DOCUMENT_VERSION,
    root,
    ...(roots.length ? { roots } : {}),
    ...(storedViewport ? { viewport: storedViewport } : {}),
    ...(storedTheme ? { theme: storedTheme } : {}),
  };
};

const extraCenters = (value: unknown): MindElement[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      (item as MindElement).type !== 'mind'
    ) {
      return [];
    }
    const center = clone(item) as MindElement & Record<string, unknown>;
    stripShellFields(center);
    if (!Array.isArray(center.points) || center.points.length === 0) {
      (center as MindRootElement).points = [[240, 0]];
    }
    return [center];
  });
};
