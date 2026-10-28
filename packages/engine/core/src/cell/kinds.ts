import type { CellRegistry } from './index';
export const CellKind = {
  frame: 'frame',
  frameReference: 'frame-reference',
  documentReference: 'document-reference',
  documentFrame: 'document-frame',
  group: 'group',
} as const;
export type CellKindName = (typeof CellKind)[keyof typeof CellKind];
export const sceneAnchorKind = (
  kinds: readonly string[],
  registry: CellRegistry,
) =>
  kinds.find((kind) =>
    registry.scenes.some((scene) => scene.anchorKinds.includes(kind)),
  );
