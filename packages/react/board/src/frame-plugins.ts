import {
  createCellRegistry,
  type Cell,
  type CellOperation,
  type CellPlugin,
  type CellRegistry,
  type CellStore,
  type FrameCell,
  type FrameSnapshot,
  type NodeGeometry,
  type Point,
  type RectangleClient,
} from '@sue/board-core';
import type { ComponentType } from 'react';
import {
  remapWorkspaceLink,
  mapStandardCellLinks,
  type ActionDefinition,
  type ActionResult,
  type ActionState,
  type ActionInvocation,
} from '@sue/board-common';
import type { FrameSettingsContribution } from './frame-settings';
import type {
  FrameCanvasController,
  FrameCanvasTool,
  FrameRenderExtension,
} from './frame-canvas';
import type { FrameViewProjection } from './frame-view-projection';

export type FrameLanguage = 'zh' | 'en';
export interface FramePluginContext {
  surface?: 'editor' | 'product';
  store: CellStore;
  frameId: string;
  fileId?: string;
  occurrenceId?: string;
  mountEpoch?: object;
  appearancePath?: readonly string[];
  selectionIds: readonly string[];
  /** Captured container path; group focus can change while the selection stays empty. */
  selectionFocus?: readonly string[];
  cell?: Cell;
  language: FrameLanguage;
  disabled: boolean;
  tool?: FrameCanvasTool;
  interactionState?: 'idle' | 'editing' | 'gesture';
  controller: FrameCanvasController | null;
  dispatch(operations: CellOperation[]): Promise<unknown>;
  allocateId(): string;
  setTool?(tool: FrameCanvasTool): void;
  propertyRequests?: Readonly<Record<string, number>>;
  requestProperties?(pluginId: string, cellId: string, section: string): void;
  registry: CellRegistry;
  readonly: boolean;
  pending: boolean;
  locked: boolean;
  viewProjection: FrameViewProjection;
  clearRevealOverrides?(ids?: readonly string[]): void;
  runOperations(
    operations: readonly CellOperation[],
    after?: {
      selectionIds?: readonly string[];
      editId?: string;
      restoreView?: boolean;
      normalizePositions?: boolean;
    },
  ): Promise<ActionResult>;
  executeAction(
    id: string,
    args?: unknown,
    invocation?: ActionInvocation,
  ): Promise<ActionResult>;
  getActionState(id: string, args?: unknown): ActionState;
}
export type FrameActionContext = FramePluginContext;
export interface FrameActionHost {
  setTool?(tool: FrameCanvasTool): void;
  requestProperties?(pluginId: string, cellId: string, section: string): void;
  propertyRequests?: Readonly<Record<string, number>>;
  language?: FrameLanguage;
  actions?: readonly FrameActionDefinition[];
}
// Definitions retain argument validation at registration; this collection is heterogeneous.

export type FrameActionDefinition = ActionDefinition<FrameActionContext, any>;
export interface FrameToolContribution {
  id: string;
  actionId: string;
  label?: string | Record<FrameLanguage, string>;
  shortcut?: string;
}
/** Pure per-kind interaction policy. Mutable editor state belongs to React instances. */
export interface FrameCellUI {
  topic?: boolean;
  pasteTarget?: boolean;
  pointerMove?: boolean;
  embeddedPan?: boolean;
  resizeHandles?: boolean;
  defaultFontSize?: number;
  defaultTextAlignment?: 'left' | 'center';
  edgeKind?: string;
  edgeData?: unknown;
  branch?: boolean;
  editEdge?: boolean;
  editEdgeLabel?: boolean;
  editableMarker?: boolean;
  expandShortcut?: boolean;
}
export interface FrameProjection {
  geometry: Map<string, NodeGeometry>;
  offsets: Map<string, Point>;
}
export interface FrameUIPlugin {
  id: string;
  engine: CellPlugin;
  extensions?(registry: CellRegistry): readonly FrameRenderExtension[];
  cells?: Readonly<Record<string, FrameCellUI>>;
  tools?: readonly FrameToolContribution[];
  Toolbar?: ComponentType<FramePluginContext>;
  actions?: readonly FrameActionDefinition[];
  prepareReveal?(store: CellStore, targetId: string): readonly string[];
  pasteImage?(context: {
    registry: CellRegistry;
    store: CellStore;
    frameId: string;
    hit?: Cell;
    at: Point;
    image: { url: string; width: number; height: number };
    allocateId(): string;
  }): CellOperation[] | undefined;
  pasteText?(context: {
    registry: CellRegistry;
    store: CellStore;
    frameId: string;
    hit?: Cell;
    at: Point;
    text: string;
    allocateId(): string;
  }): CellOperation[] | undefined;
  propertyPanels?: readonly FrameSettingsContribution[];
  settingsPanels?: readonly FrameSettingsContribution[];
  Properties?: ComponentType<FramePluginContext>;
  Settings?: ComponentType<FramePluginContext>;
  messages?: Partial<Record<FrameLanguage, Readonly<Record<string, string>>>>;
  projectEmbedded?(
    store: CellStore,
    frame: FrameCell,
    geometry: Map<string, NodeGeometry>,
    bounds: RectangleClient,
    offsets?: ReadonlyMap<string, Point>,
  ): FrameProjection;
  fitLayoutBounds?(store: CellStore, frameId: string): boolean;
  referenceOffsets?(cell: Cell): Record<string, Point> | undefined;
  updateOffset?(cell: Cell, rootId: string, offset: Point): Cell;
}
export interface FramePluginSet {
  readonly plugins: readonly FrameUIPlugin[];
  readonly registry: CellRegistry;
  readonly extensions: readonly FrameRenderExtension[];
  readonly tools: readonly FrameToolContribution[];
}
export function createFramePluginSet(
  plugins: readonly FrameUIPlugin[],
): FramePluginSet {
  const installed = Object.freeze([...plugins]);
  if (new Set(installed.map((plugin) => plugin.id)).size !== installed.length)
    throw new Error('Duplicate frame UI plugin id');
  const panelIds = installed.flatMap((plugin) =>
    [...(plugin.propertyPanels ?? []), ...(plugin.settingsPanels ?? [])].map(
      (panel) => panel.id,
    ),
  );
  if (new Set(panelIds).size !== panelIds.length)
    throw new Error('Conflicting frame settings panel id');
  const registry = createCellRegistry({
    plugins: installed.map((plugin) => plugin.engine),
    links: {
      rewriteHref: remapWorkspaceLink,
      mapStandard: mapStandardCellLinks,
    },
  });
  const tools = Object.freeze(
    installed.flatMap((plugin) => [...(plugin.tools ?? [])]),
  );
  if (new Set(tools.map((tool) => tool.id)).size !== tools.length)
    throw new Error('Conflicting frame tool id');
  const extensions = Object.freeze(
    installed.flatMap(
      (plugin) =>
        [
          ...(plugin.extensions?.(registry) ?? []),
          { plugin },
        ] as FrameRenderExtension[],
    ),
  );
  registry.seal();
  return Object.freeze({ plugins: installed, registry, extensions, tools });
}
export const frameCellUI = (
  extensions: readonly FrameRenderExtension[] | undefined,
  kind: string,
): FrameCellUI =>
  extensions?.find((extension) => extension.plugin?.cells?.[kind])?.plugin
    ?.cells?.[kind] ?? {};
export function projectEmbeddedContent(
  extensions: readonly FrameRenderExtension[] | undefined,
  store: CellStore,
  frame: FrameCell,
  base: Map<string, NodeGeometry>,
  bounds: RectangleClient,
  overrides?: ReadonlyMap<string, Point>,
): FrameProjection {
  let geometry = base;
  const offsets = new Map<string, Point>();
  for (const extension of extensions ?? []) {
    const projection = extension.plugin?.projectEmbedded?.(
      store,
      frame,
      geometry,
      bounds,
      overrides,
    );
    if (projection) {
      geometry = projection.geometry;
      projection.offsets.forEach((offset, id) => offsets.set(id, offset));
    }
  }
  return { geometry, offsets };
}
export function referenceContentOffsets(
  extensions: readonly FrameRenderExtension[] | undefined,
  cell: Cell,
): Record<string, Point> | undefined {
  const values = (extensions ?? []).flatMap((extension) => {
    const value = extension.plugin?.referenceOffsets?.(cell);
    return value ? [value] : [];
  });
  return values.length === 0
    ? undefined
    : values.length === 1
      ? values[0]
      : Object.assign({}, ...values);
}
export function updateContentOffset(
  extensions: readonly FrameRenderExtension[] | undefined,
  cell: Cell,
  rootId: string,
  offset: Point,
): Cell {
  return (extensions ?? []).reduce(
    (current, extension) =>
      extension.plugin?.updateOffset?.(current, rootId, offset) ?? current,
    cell,
  );
}
export interface FrameImporter {
  id: string;
  label: string;
  accept: string;
  import(
    source: string,
    context: { registry: CellRegistry },
  ): Promise<FrameSnapshot>;
}
export interface FrameExporter {
  id: string;
  label: string;
  export(
    value: FrameSnapshot,
    context: { registry: CellRegistry; frameId: string },
  ): Promise<Blob | string>;
}
