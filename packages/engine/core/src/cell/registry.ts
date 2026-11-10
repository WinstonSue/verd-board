import type {
  CellFragment,
  CellPastePlan,
  CellPasteRequest,
} from './clipboard';
import type { CellUtil } from './index';
import type { Cell, CellStore, EdgeCell } from './types';
import {
  DocumentFrameUtil,
  DocumentReferenceUtil,
  FrameReferenceUtil,
  FrameUtil,
  GroupUtil,
} from './util';

/** A scene is discovered from registered anchors, never from a kind naming convention. */
export interface CellScene {
  geometry?: import('./geometry-policy').SceneGeometryPolicy;
  id: string;
  anchorKinds: readonly string[];
  kinds: readonly string[];
  allowGroups?: boolean;
  sharedKinds?: readonly string[];
  laneMemberKinds?: readonly string[];
  consecutiveGroups?: boolean;
  preserveAnchor?: boolean;
  preserveAllAnchors?: boolean;
  arrangeable?: boolean;
  /** Soft endpoint preferences. Explicit ports/anchors always take precedence. */
  routing?(
    store: CellStore,
    edge: EdgeCell,
    geometry?: ReadonlyMap<string, import('./types').NodeGeometry>,
  ):
    | Partial<
        Record<'source' | 'target', import('../geometry/side').GeometrySide>
      >
    | undefined;
  layouts?: readonly {
    id: string;
    edgeKind: string;
    rows(
      store: CellStore,
      blocks: import('./arrangement').ArrangementBlock[],
      registry: CellRegistry,
    ): import('./arrangement').ArrangementBlock[][];
  }[];
}
export interface CellPlugin {
  id: string;
  install(registry: CellRegistry): void;
  scenes?: readonly CellScene[];
  validate?(store: CellStore, cell: Cell): string | undefined;
  normalize?(before: CellStore, candidate: CellStore): CellStore;
  validateTransaction?(
    before: CellStore,
    candidate: CellStore,
  ): string | undefined;
  deletionClosure?(store: CellStore, cell: Cell): readonly string[];
  references?(cell: Cell): readonly string[];
  copyReferences?(store: CellStore, cell: Cell): readonly string[];
  remap?(cell: Cell, remap: (id: string) => string): Cell;
  /** Map only this plugin's explicit link-bearing fields. Standard text slots are handled once by the registry. */
  mapLinks?(cell: Cell, rewriteHref: (href: string) => string): Cell;
  copy?(
    store: CellStore,
    selected: readonly string[],
    included: Set<string>,
    visit: (id: string) => void,
  ): void;
  filterCopy?(
    cell: Cell,
    included: ReadonlySet<string>,
    cells: Readonly<Record<string, Cell>>,
  ): boolean;
  clipboardMetadata?(
    store: CellStore,
    frameId: string,
    included: ReadonlySet<string>,
    selected: ReadonlySet<string>,
  ): Record<string, unknown>;
  preparePaste?(cell: Cell, original: Cell, fragment: CellFragment): Cell;
  pasteCells?(
    cells: Cell[],
    targetId: string,
    allocateId: (id: string) => string,
  ): void;
  planPaste?(request: CellPasteRequest): CellPastePlan | undefined;
}
/** Identity-only context. Core does not know a link protocol or rich-text schema. */
export interface CellLinkRemapContext {
  idMap: ReadonlyMap<string, string>;
  sourceFileId?: string;
  targetFileId?: string;
  targetOwnerOf?(cellId: string): string | undefined;
}
export interface CellLinkMapping {
  rewriteHref(href: string, context: CellLinkRemapContext): string;
  mapStandard(cell: Cell, rewriteHref: (href: string) => string): Cell;
}
export interface CellRegistry {
  readonly plugins: readonly CellPlugin[];
  readonly scenes: readonly CellScene[];
  register(util: CellUtil): void;
  get(kind: string): CellUtil | undefined;
  validate(store: CellStore, cell: Cell): string | undefined;
  validateEdge(store: CellStore, cell: EdgeCell): string | undefined;
  remapLinks(cell: Cell, context: CellLinkRemapContext): Cell;
  kinds(): readonly string[];
  seal(): void;
}
export class UnregisteredCellKindsError extends Error {
  readonly code = 'UNREGISTERED_CELL_KINDS';
  constructor(readonly kinds: readonly string[]) {
    super(`Missing cell plugins for kinds: ${kinds.join(', ')}`);
    this.name = 'UnregisteredCellKindsError';
  }
}
/** Call before any import normalization. Rejection leaves the original data untouched. */
export function assertRegisteredCellKinds(
  store: CellStore,
  registry: CellRegistry,
): void {
  const kinds = [
    ...new Set(Object.values(store.cells).map((cell) => cell.kind)),
  ].filter((kind) => !registry.get(kind));
  if (kinds.length) throw new UnregisteredCellKindsError(kinds.sort());
}

export const createCellRegistry = (
  options: {
    plugins?: readonly CellPlugin[];
    links?: CellLinkMapping;
  } = {},
): CellRegistry => {
  const utils = new Map<string, CellUtil>();
  const plugins = Object.freeze([...(options.plugins ?? [])]);
  const ids = new Set<string>();
  for (const plugin of plugins) {
    if (!plugin.id || ids.has(plugin.id))
      throw new Error(`Duplicate cell plugin id: ${plugin.id}`);
    ids.add(plugin.id);
  }
  const scenes = Object.freeze(
    plugins.flatMap((plugin) => [...(plugin.scenes ?? [])]),
  );
  if (new Set(scenes.map((scene) => scene.id)).size !== scenes.length)
    throw new Error('Duplicate scene id');
  let sealed = false;
  const registry: CellRegistry = {
    plugins,
    scenes,
    register(util) {
      if (sealed)
        throw new Error(
          'Cell registry is sealed; runtime plugin installation is unsupported',
        );
      if (utils.has(util.kind))
        throw new Error(`Conflicting cell kind: ${util.kind}`);
      utils.set(util.kind, util);
    },
    get: (kind) => utils.get(kind),
    kinds: () => [...utils.keys()],
    validate: (store, cell) =>
      utils.get(cell.kind)?.validate?.(store, cell) ??
      plugins.map((plugin) => plugin.validate?.(store, cell)).find(Boolean),
    validateEdge: (store, edge) =>
      utils.get(edge.kind)?.validateEdge?.(store, edge),
    remapLinks(cell, context) {
      if (!options.links) return cell;
      const rewriteHref = (href: string) =>
        options.links!.rewriteHref(href, context);
      let mapped = options.links.mapStandard(cell, rewriteHref);
      for (const plugin of plugins)
        mapped = plugin.mapLinks?.(mapped, rewriteHref) ?? mapped;
      return mapped;
    },
    seal() {
      sealed = true;
    },
  };
  [
    new FrameUtil(),
    new FrameReferenceUtil(),
    new DocumentReferenceUtil(),
    new DocumentFrameUtil(),
    new GroupUtil(),
  ].forEach((util) => registry.register(util));
  for (const plugin of plugins) plugin.install(registry);
  return registry;
};
