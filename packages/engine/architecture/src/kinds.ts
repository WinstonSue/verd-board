export const ArchitectureKind = {
  architectureLayer: 'architecture-layer',
  architectureModule: 'architecture-module',
  architectureEdge: 'architecture-edge',
} as const;
export const ARCHITECTURE_NODE_KINDS = [
  ArchitectureKind.architectureLayer,
  ArchitectureKind.architectureModule,
] as const;
export const isArchitectureNodeKind = (kind: string) =>
  (ARCHITECTURE_NODE_KINDS as readonly string[]).includes(kind);
