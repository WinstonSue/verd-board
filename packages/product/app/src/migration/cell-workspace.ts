import {
  stripFrameViewports,
  createCellStore,
  createFrameCell,
  isFrameCell,
  isNodeCell,
  isEdgeCell,
  isGroupCell,
  validateCellStore,
  type Cell,
  type CellStore,
  type NodeOutline,
  type FrameCell,
  type CellRegistry,
  type FrameSnapshot,
} from '@sue/board-core';
import { architectureDocumentToStore } from './legacy/architecture-cells';
import { isArchitectureDocument } from './legacy/architecture-document';
import { workflowDocumentToStore } from './legacy/workflow-cells';
import { isWorkflowDocument } from './legacy/workflow-document';
import { workflowCellPorts } from '@sue/board-workflow';
import { mindDocumentToStore } from './legacy/mind-cells';
import { isMindDocument, mindElementToDocument } from './legacy/mind-document';
import type { MindElement } from './legacy/mind-element';
import type { LegacyBoardElement as BoardElement } from './legacy/board-element';
import { migrateLegacyTextDocument } from './legacy/text-document';
import { legacyMindToStore } from './legacy/host-mind-cells';
import { isMindDocument as isHostMindDocument } from './legacy/host-mind-document';
import {
  isCellEnvelope,
  envelopeToBoardSnapshot,
  type CellEnvelope,
} from './legacy/cell-envelope';
import {
  isWorkspaceManifest,
  loadCellWorkspace,
  saveCellWorkspace,
  MIGRATION_BACKUP_KEY,
  WORKSPACE_KEY,
  type WorkspaceSnapshot,
} from '../frames/workspace-storage';
import type { StorageAdapter } from '../storage-adapter';
import {
  normalizeArchitectureIds,
  normalizeWorkflowIds,
  normalizeMindIds,
  normalizeHostMindIds,
} from './legacy-ids';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const namespace = (scope: string, id: string) => `${scope}/${id.length}:${id}`;
const outline = (shape: unknown): NodeOutline =>
  typeof shape === 'string' && shape.length ? shape : 'rectangle';

/** Legacy swimlane spans were derived by its renderer, rather than stored. */
const nativeTableData = (
  kind: string,
  source: Record<string, unknown>,
): import('@sue/board-draw').TableCellData => {
  const data = clone(
    source,
  ) as unknown as import('@sue/board-draw').TableCellData & { shape?: string };
  const swimlane = kind === 'swimlane';
  const horizontal = data.direction
    ? data.direction === 'horizontal'
    : data.shape !== 'swimlaneVertical';
  if (swimlane) data.direction = horizontal ? 'horizontal' : 'vertical';
  data.cells = data.cells.map((entry, index) => {
    const oldText = entry.text as unknown as
      { direction?: 'horizontal' | 'vertical' } | undefined;
    const role = !swimlane
      ? entry.role
      : data.header && index === 0
        ? 'title'
        : entry.text
          ? 'lane'
          : 'body';
    return {
      ...entry,
      text: entry.text
        ? migrateLegacyTextDocument(entry.text, 'block')
        : undefined,
      textDirection:
        entry.textDirection ??
        oldText?.direction ??
        (swimlane && horizontal && entry.text ? 'vertical' : 'horizontal'),
      ...(swimlane ? { role } : {}),
      ...(swimlane && data.header && index === 0
        ? horizontal
          ? { rowspan: data.rows.length }
          : { colspan: data.columns.length }
        : {}),
    };
  });
  return data;
};

/** Converts transient legacy domain projections into native data fields. */
const nativeDomainStore = (input: CellStore): CellStore => {
  const store = clone(input);
  for (const cell of Object.values(store.cells)) {
    if (!isNodeCell(cell)) continue;
    if (cell.kind === 'table' || cell.kind === 'swimlane')
      cell.data = nativeTableData(
        cell.kind,
        cell.data as Record<string, unknown>,
      );
    // The transitional renderer authored vector lines using the freehand builder.
    if (
      cell.kind === 'vector-line' &&
      (cell.data as { shape?: string })?.shape === 'feltTipPen'
    )
      cell.data = { ...(cell.data as object), shape: 'straight' };
    const payload = cell.data as
      { element?: Record<string, unknown> } | undefined;
    const legacy = payload?.element;
    if (legacy) {
      const data = legacy['data'] as
        | {
            topic?: unknown;
            note?: unknown;
            noteCollapsed?: boolean;
            image?: unknown;
            emojis?: unknown;
            topicSize?: { width: number; height: number };
          }
        | undefined;
      const text = migrateLegacyTextDocument(data?.topic ?? '');
      cell.content = { label: text.plainText, text };
      cell.geometry = {
        ...cell.geometry,
        width:
          typeof legacy['manualWidth'] === 'number' && legacy['manualWidth'] > 0
            ? Math.max(40, legacy['manualWidth'] + 16)
            : (data?.topicSize?.width ??
              Math.max(120, text.plainText.length * 8 + 32)),
        height: data?.topicSize?.height ?? 40,
        outline:
          legacy['shape'] === 'round-rectangle'
            ? 'roundRectangle'
            : typeof legacy['shape'] === 'string'
              ? legacy['shape']
              : 'roundRectangle',
      };
      cell.appearance = {
        fill: legacy['fill'] as string | undefined,
        strokeColor: legacy['strokeColor'] as string | undefined,
        strokeWidth: legacy['strokeWidth'] as number | undefined,
        strokeStyle: legacy['strokeStyle'] as 'solid' | undefined,
      };
      cell.data = {
        layout: legacy['layout'],
        rightNodeCount: legacy['rightNodeCount'],
        collapsed: legacy['isCollapsed'],
        manualWidth: legacy['manualWidth'],
        note: data?.note ? migrateLegacyTextDocument(data.note) : undefined,
        noteCollapsed: data?.noteCollapsed,
        image: data?.image,
        emojis: data?.emojis,
        branchAppearance: {
          strokeColor: legacy['branchColor'] as string | undefined,
          strokeWidth: legacy['branchWidth'] as number | undefined,
        },
        branchShape: legacy['branchShape'] as 'bight' | 'polyline' | undefined,
      };
    }
    if (['mind-root', 'mind-child', 'mind-summary'].includes(cell.kind)) {
      if (cell.geometry.outline === 'round-rectangle')
        cell.geometry.outline = 'roundRectangle';
      if (!cell.geometry.outline) cell.geometry.outline = 'roundRectangle';
    }
    if (cell.kind === 'mind-root' || cell.kind === 'mind-child') {
      if (!Number.isFinite(cell.geometry.width))
        cell.geometry.width = Math.max(
          120,
          (cell.content?.label?.length ?? 0) * 8 + 32,
        );
      if (!Number.isFinite(cell.geometry.height)) cell.geometry.height = 40;
    }
    if (cell.kind.startsWith('workflow-')) {
      cell.ports = workflowCellPorts(cell.kind === 'workflow-start');
      cell.geometry.outline =
        cell.kind === 'workflow-start'
          ? 'terminal'
          : cell.kind === 'workflow-decision'
            ? 'diamond'
            : 'roundRectangle';
    }
  }
  for (const cell of Object.values(store.cells))
    if (isEdgeCell(cell) && cell.kind === 'workflow-edge') {
      for (const terminal of [cell.source, cell.target])
        if ('cellId' in terminal) {
          if (terminal.portId === 'out') terminal.portId = 'right';
          if (terminal.portId === 'in') terminal.portId = 'left';
        }
    }
  // Legacy summaries were siblings in a tree. Only their range edge is native.
  for (const cell of Object.values(store.cells))
    if (
      isEdgeCell(cell) &&
      cell.kind === 'mind-branch' &&
      'cellId' in cell.target &&
      store.cells[cell.target.cellId]?.kind === 'mind-summary'
    )
      delete store.cells[cell.id];
  for (const cell of Object.values(store.cells))
    if (isFrameCell(cell))
      cell.children = cell.children.filter((id) => !!store.cells[id]);
  return stripFrameViewports(store);
};

const remapStore = (
  input: CellStore,
  scope: string,
  rootId: string,
): CellStore => {
  const store = nativeDomainStore(input);
  const ids = new Map(
    Object.keys(store.cells).map((id) => [
      id,
      id === store.rootId ? rootId : namespace(scope, id),
    ]),
  );
  const remap = (id: string) => ids.get(id) ?? namespace(scope, id);
  const cells: Record<string, Cell> = {};
  for (const original of Object.values(store.cells)) {
    const cell = clone(original);
    cell.id = remap(cell.id);
    if (isFrameCell(cell)) {
      cell.children = cell.children.map(remap);
      cell.groups = cell.groups.map(remap);
    }
    if (isGroupCell(cell)) cell.members = cell.members.map(remap);
    if (isEdgeCell(cell)) {
      if ('cellId' in cell.source)
        cell.source.cellId = remap(cell.source.cellId);
      if ('cellId' in cell.target)
        cell.target.cellId = remap(cell.target.cellId);
    }
    const data = (
      cell as {
        data?: {
          memberIds?: string[];
          startSiblingId?: string;
          endSiblingId?: string;
        };
      }
    ).data;
    if (data?.memberIds) data.memberIds = data.memberIds.map(remap);
    if (data?.startSiblingId) data.startSiblingId = remap(data.startSiblingId);
    if (data?.endSiblingId) data.endSiblingId = remap(data.endSiblingId);
    cells[cell.id] = cell;
  }
  return { rootId, cells };
};

const domainStore = (
  kind: 'mind' | 'architecture' | 'workflow',
  value: unknown,
): CellStore => {
  if (isCellEnvelope(value)) return nativeDomainStore(value.store);
  if (kind === 'mind') {
    if (isMindDocument(value))
      return mindDocumentToStore(normalizeMindIds(value));
    if (isHostMindDocument(value))
      return legacyMindToStore(normalizeHostMindIds(value));
  }
  if (kind === 'architecture' && isArchitectureDocument(value))
    return architectureDocumentToStore(
      value.layers.length
        ? normalizeArchitectureIds(value)
        : {
            ...value,
            layers: [{ id: 'migrated-layer', label: '', nodes: [] }],
          },
    );
  if (kind === 'workflow' && isWorkflowDocument(value))
    return workflowDocumentToStore(normalizeWorkflowIds(value));
  throw new Error(`Invalid legacy ${kind} document`);
};

const repairSnapshot = (
  current: WorkspaceSnapshot,
  backup: WorkspaceSnapshot,
): WorkspaceSnapshot => {
  const next = clone(current);
  for (const [id, cell] of Object.entries(next.store.cells)) {
    const source = backup.store.cells[id];
    if (!source) continue;
    if (isNodeCell(cell) && isNodeCell(source) && source.appearance) {
      const appearance = { ...source.appearance };
      for (const [key, value] of Object.entries(cell.appearance ?? {}))
        if (value !== undefined)
          (appearance as Record<string, unknown>)[key] = value;
      cell.appearance = appearance;
    }
    if (isFrameCell(cell) && isFrameCell(source)) {
      if (cell.aspectRatio === undefined && source.aspectRatio !== undefined)
        cell.aspectRatio = source.aspectRatio;
      const view = { ...cell.view };
      if (view.theme === undefined && source.view?.theme !== undefined)
        view.theme = clone(source.view.theme);
      cell.view = view;
    }
    if (
      isGroupCell(cell) &&
      isGroupCell(source) &&
      cell.members.length < 2 &&
      source.members.length >= 2 &&
      source.members.every((member) => next.store.cells[member])
    )
      cell.members = [...source.members];
  }
  for (const cell of Object.values({ ...next.store.cells })) {
    if (
      !isNodeCell(cell) ||
      isFrameCell(cell) ||
      cell.kind !== 'group' ||
      cell.geometry.width !== 0 ||
      cell.geometry.height !== 0
    )
      continue;
    delete next.store.cells[cell.id];
    for (const frame of Object.values(next.store.cells))
      if (isFrameCell(frame)) {
        frame.children = frame.children.filter((id) => id !== cell.id);
        frame.groups = frame.groups.filter((id) => id !== cell.id);
      }
  }
  return next;
};
const decodeBackup = async (
  backup: Record<string, unknown>,
  registry?: CellRegistry,
) => {
  const values = new Map(Object.entries(clone(backup)));
  values.delete(MIGRATION_BACKUP_KEY);
  const memory: StorageAdapter = {
    listKeys: async () => [...values.keys()],
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, clone(value));
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
  return migrateLegacyCellWorkspace(memory, registry);
};
const upgradeWorkspaceV1 = async (
  adapter: StorageAdapter,
  registry?: CellRegistry,
): Promise<WorkspaceSnapshot> => {
  let loaded: WorkspaceSnapshot | undefined;
  let loadError: Error | undefined;
  try {
    loaded = (await loadCellWorkspace(adapter, registry)) ?? undefined;
  } catch (error) {
    loadError = error instanceof Error ? error : new Error(String(error));
  }
  const backup = await adapter.getItem(MIGRATION_BACKUP_KEY);
  let decoded: WorkspaceSnapshot | undefined;
  if (backup && typeof backup === 'object' && !Array.isArray(backup)) {
    try {
      decoded = await decodeBackup(backup as Record<string, unknown>, registry);
    } catch {
      decoded = undefined;
    }
  }
  const candidates = [
    ...(loaded && decoded ? [repairSnapshot(loaded, decoded)] : []),
    ...(loaded ? [loaded] : []),
    ...(decoded ? [decoded] : []),
  ];
  let lastError = loadError;
  for (const candidate of candidates) {
    try {
      await saveCellWorkspace(adapter, candidate, registry);
      return candidate;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw new Error(
    `${lastError?.message ?? 'Workspace cannot be repaired'}. Reset the test workspace to continue.`,
  );
};
/** IDs are deterministic per source and per container, so shared documents become independent copies. */
export const migrateLegacyCellWorkspace = async (
  adapter: StorageAdapter,
  cellRegistry?: CellRegistry,
): Promise<WorkspaceSnapshot> => {
  const existing = await adapter.getItem(WORKSPACE_KEY);
  if (isWorkspaceManifest(existing)) {
    if (existing.version === 2)
      return (await loadCellWorkspace(adapter, cellRegistry))!;
    return upgradeWorkspaceV1(adapter, cellRegistry);
  }
  const keys = new Set([
    WORKSPACE_KEY,
    'main_mind_content',
    'main_workflow_registry',
    'main_workflow_content',
    ...((await adapter.listKeys?.()) ?? []),
  ]);
  const source: Record<string, unknown> = {};
  for (const key of keys)
    if (!key.startsWith('frames/') && key !== MIGRATION_BACKUP_KEY) {
      const value = await adapter.getItem(key);
      if (value !== null && value !== undefined) source[key] = clone(value);
    }
  const nativeEnvelope =
    isCellEnvelope(existing) &&
    !Object.values(existing.store.cells).some(
      (cell) =>
        (cell as { data?: { boardElement?: unknown } }).data?.boardElement,
    );
  let store = nativeEnvelope
    ? nativeDomainStore(existing.store)
    : createCellStore(createFrameCell('board-root'));
  let root = store.cells[store.rootId] as FrameCell;
  if (nativeEnvelope && isCellEnvelope(existing) && isFrameCell(root)) {
    const view = { ...root.view };
    if (
      !Object.prototype.hasOwnProperty.call(root.view ?? {}, 'theme') &&
      Object.prototype.hasOwnProperty.call(existing, 'theme')
    )
      view.theme = existing.theme;
    root.view = view;
    store.cells[root.id] = root;
  }
  const detachedFrameIds: string[] = nativeEnvelope
    ? Object.values(store.cells)
        .filter(isFrameCell)
        .filter(
          (frame) =>
            frame.id !== store.rootId &&
            !Object.values(store.cells).some(
              (parent) =>
                isFrameCell(parent) && parent.children.includes(frame.id),
            ),
        )
        .map((frame) => frame.id)
    : [];
  const usedSources = new Set<string>();
  let boardValue = nativeEnvelope
    ? null
    : isCellEnvelope(existing)
      ? envelopeToBoardSnapshot(existing)
      : existing;
  if (
    boardValue &&
    typeof boardValue === 'object' &&
    !Array.isArray((boardValue as { children?: unknown }).children) &&
    Array.isArray((boardValue as { elements?: unknown }).elements)
  )
    boardValue = {
      ...boardValue,
      children: (boardValue as { elements: BoardElement[] }).elements,
    };
  if (
    boardValue &&
    (typeof boardValue !== 'object' ||
      !Array.isArray((boardValue as { children?: unknown }).children))
  )
    throw new Error('Invalid legacy whiteboard');
  const elements =
    (boardValue as { children?: BoardElement[] } | null)?.children ?? [];
  if (boardValue && typeof boardValue === 'object') {
    const carried = boardValue as {
      theme?: NonNullable<FrameCell['view']>['theme'];
    };
    const view = { ...root.view };
    if (
      !Object.prototype.hasOwnProperty.call(root.view ?? {}, 'theme') &&
      Object.prototype.hasOwnProperty.call(carried, 'theme')
    )
      view.theme = carried.theme;
    if (view.theme !== undefined) root.view = view;
  }
  const registry = source['main_workflow_registry'] as
    { documents?: Record<string, unknown> } | undefined;
  if (registry && !registry.documents)
    throw new Error('Invalid workflow registry');
  const ids = new Map<string, string>();
  const groups = new Map<string, string[]>();
  const allIds = new Set<string>(Object.keys(store.cells));
  const allocate = (scope: string, preferred: string) => {
    let id = namespace(scope, preferred),
      suffix = 0;
    while (allIds.has(id)) id = `${namespace(scope, preferred)}-${++suffix}`;
    allIds.add(id);
    return id;
  };
  const attachDomain = (
    kind: 'mind' | 'architecture' | 'workflow',
    value: unknown,
    frameId: string,
    scope: string,
    shell?: BoardElement,
  ) => {
    const converted = remapStore(domainStore(kind, value), scope, frameId);
    const frame = converted.cells[frameId] as FrameCell;
    const originalRoot = (
      isCellEnvelope(value) ? value.store.cells[value.store.rootId] : undefined
    ) as FrameCell | undefined;
    const points = shell?.points ?? [
      [0, 0],
      [960, 640],
    ];
    frame.geometry = {
      x: points[0]?.[0] ?? 0,
      y: points[0]?.[1] ?? 0,
      width: Math.abs(
        (points[1]?.[0] ?? (points[0]?.[0] ?? 0) + 960) - (points[0]?.[0] ?? 0),
      ),
      height: Math.abs(
        (points[1]?.[1] ?? (points[0]?.[1] ?? 0) + 640) - (points[0]?.[1] ?? 0),
      ),
    };
    const carry = value as {
      theme?: FrameCell['view'] extends infer V
        ? V extends { theme?: infer T }
          ? T
          : never
        : never;
    };
    const base = originalRoot?.view;
    const theme =
      base && Object.prototype.hasOwnProperty.call(base, 'theme')
        ? base.theme
        : (carry.theme as FrameCell['view'] extends { theme?: infer T }
            ? T
            : never);
    if (theme !== undefined)
      frame.view = {
        ...(theme !== undefined ? { theme } : {}),
      };
    if (shell) {
      const shellFrame = shell['frame'] as
        | {
            appearance?: FrameCell['appearance'];
            aspectRatio?: FrameCell['aspectRatio'];
          }
        | undefined;
      const appearance = shellFrame?.appearance;
      const pick = <T>(
        preferred: T | undefined,
        hasPreferred: boolean,
        fallback: T | undefined,
      ) => (hasPreferred ? preferred : fallback);
      frame.appearance = {
        fill: pick(
          appearance?.fill,
          !!appearance &&
            Object.prototype.hasOwnProperty.call(appearance, 'fill'),
          shell['backgroundColor'] ?? shell['fill'],
        ),
        strokeColor: pick(
          appearance?.strokeColor,
          !!appearance &&
            Object.prototype.hasOwnProperty.call(appearance, 'strokeColor'),
          shell['borderColor'] ?? shell['strokeColor'],
        ),
        strokeWidth: pick(
          appearance?.strokeWidth,
          !!appearance &&
            Object.prototype.hasOwnProperty.call(appearance, 'strokeWidth'),
          shell['borderWidth'] ?? shell['strokeWidth'],
        ),
        strokeStyle: pick(
          appearance?.strokeStyle,
          !!appearance &&
            Object.prototype.hasOwnProperty.call(appearance, 'strokeStyle'),
          shell['borderStyle'] ?? shell['strokeStyle'],
        ),
        shadow: pick(
          appearance?.shadow,
          !!appearance &&
            Object.prototype.hasOwnProperty.call(appearance, 'shadow'),
          shell['shadow'],
        ),
        opacity: pick(
          appearance?.opacity,
          !!appearance &&
            Object.prototype.hasOwnProperty.call(appearance, 'opacity'),
          shell['opacity'],
        ),
      };
      frame.aspectRatio =
        shellFrame &&
        Object.prototype.hasOwnProperty.call(shellFrame, 'aspectRatio')
          ? shellFrame.aspectRatio
          : shell['aspectRatio'];
      frame.locked = shell['locked'];
      frame.hidden = shell['hidden'];
    }
    for (const id of Object.keys(converted.cells)) {
      if (store.cells[id])
        throw new Error(`Conflicting migrated cell id: ${id}`);
      allIds.add(id);
    }
    store = { ...store, cells: { ...store.cells, ...converted.cells } };
    if (shell) root.children.push(frameId);
    else detachedFrameIds.push(frameId);
  };
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    if (!element || typeof element !== 'object')
      throw new Error('Invalid whiteboard element');
    const id = allocate('board', element.id ?? String(index));
    if (element.id && !ids.has(element.id)) ids.set(element.id, id);
    if (
      ['mind', 'architecture', 'workflow', 'workflow-component'].includes(
        element.type ?? '',
      )
    ) {
      const kind =
        element.type === 'workflow-component'
          ? 'workflow'
          : (element.type as 'mind' | 'architecture' | 'workflow');
      const documentId = element['documentId'] as string | undefined;
      const sourceKey =
        kind === 'workflow'
          ? `registry:${documentId ?? 'main'}`
          : `${kind}/${documentId ?? ''}`;
      const inline =
        kind === 'mind' &&
        Array.isArray(element.children) &&
        (element.children.length || element['data'])
          ? mindElementToDocument(element as MindElement)
          : undefined;
      const content =
        inline ??
        (kind === 'workflow'
          ? (registry?.documents?.[documentId ?? 'main'] ??
            source['main_workflow_content'])
          : source[sourceKey]);
      if (!content)
        throw new Error(`Missing legacy frame content: ${sourceKey}`);
      attachDomain(kind, content, id, `container-${index}`, element);
      usedSources.add(sourceKey);
      if (element.groupId)
        groups.set(element.groupId, [
          ...(groups.get(element.groupId) ?? []),
          id,
        ]);
      continue;
    }
    if (element.type === 'group') continue;
    const points = element.points ?? [[0, 0]],
      xs = points.map((point) => point[0]),
      ys = points.map((point) => point[1]);
    const x = Math.min(...xs),
      y = Math.min(...ys),
      width = Math.max(...xs) - x,
      height = Math.max(...ys) - y;
    let cell: Cell;
    if (element.type === 'arrow-line') {
      cell = {
        id,
        kind: 'arrow',
        cellType: 'edge',
        source: { point: points[0] },
        target: { point: points.at(-1)! },
        route:
          element['shape'] === 'elbow'
            ? { mode: 'orthogonal', points }
            : element['shape'] === 'curve'
              ? { mode: 'curve', points }
              : { mode: 'straight', points },
        labels: (
          element['texts'] as { text: unknown; position?: number }[] | undefined
        )?.map((label) => ({
          text: migrateLegacyTextDocument(label.text).plainText,
          position: label.position,
          richText: migrateLegacyTextDocument(label.text),
        })),
        appearance: {
          strokeColor: element['strokeColor'],
          strokeWidth: element['strokeWidth'],
          strokeStyle: element['strokeStyle'],
          opacity: element['opacity'],
          shadow: element['shadow'],
        },
        locked: element['locked'],
        hidden: element['hidden'],
        data: {
          sourceMarker: element['source']?.marker,
          targetMarker: element['target']?.marker,
        },
      };
    } else {
      const {
        id: legacyId,
        type,
        points: legacyPoints,
        children,
        groupId,
        angle,
        fill,
        strokeColor,
        strokeWidth,
        strokeStyle,
        opacity,
        text,
        locked,
        hidden,
        ...data
      } = clone(element);
      cell = {
        id,
        kind: type ?? 'geometry',
        cellType: 'node',
        geometry: {
          x,
          y,
          width,
          height,
          rotation: angle,
          outline: outline(element['shape']),
        },
        appearance: { fill, strokeColor, strokeWidth, strokeStyle, opacity },
        locked,
        hidden,
        content: text
          ? {
              text: migrateLegacyTextDocument(text),
              label: migrateLegacyTextDocument(text).plainText,
            }
          : undefined,
        data:
          type === 'table' || type === 'swimlane'
            ? nativeTableData(type, data)
            : data,
      };
      if (type === 'freehand' || type === 'vector-line')
        (cell.data as Record<string, unknown>)['points'] = points.map(
          (point) => [point[0] - x, point[1] - y],
        );
    }
    store.cells[id] = cell;
    root.children.push(id);
    if (element.groupId)
      groups.set(element.groupId, [...(groups.get(element.groupId) ?? []), id]);
  }
  // Resolve bound arrow ids only after all whiteboard ids have been allocated.
  elements.forEach((element) => {
    const cell = store.cells[ids.get(element.id) ?? ''];
    if (!isEdgeCell(cell) || cell.kind !== 'arrow') return;
    if (element['source']?.boundId && ids.has(element['source'].boundId))
      cell.source = {
        cellId: ids.get(element['source'].boundId)!,
        ...(element['source'].connection
          ? { anchor: element['source'].connection }
          : {}),
      };
    if (element['target']?.boundId && ids.has(element['target'].boundId))
      cell.target = {
        cellId: ids.get(element['target'].boundId)!,
        ...(element['target'].connection
          ? { anchor: element['target'].connection }
          : {}),
      };
  });
  groups.forEach((members, groupId) => {
    if (members.length < 2) return;
    const id = allocate('group', groupId);
    store.cells[id] = { id, kind: 'group', cellType: 'group', members };
    root.groups.push(id);
    const first = Math.min(
      ...members.map((member) => root.children.indexOf(member)),
    );
    root.children = root.children.filter((child) => !members.includes(child));
    root.children.splice(first, 0, ...members);
  });
  for (const [key, value] of Object.entries(source)) {
    const match = /^(mind|architecture)\/(.+)$/.exec(key);
    if (match && !usedSources.has(key))
      attachDomain(
        match[1] as 'mind' | 'architecture',
        value,
        allocate('detached', key),
        key,
      );
  }
  for (const [documentId, value] of Object.entries(registry?.documents ?? {}))
    if (!usedSources.has(`registry:${documentId}`))
      attachDomain(
        'workflow',
        value,
        allocate('detached', `workflow-${documentId}`),
        `workflow-${documentId}`,
      );
  if (
    !registry &&
    source['main_workflow_content'] &&
    !usedSources.has('registry:main')
  )
    attachDomain(
      'workflow',
      source['main_workflow_content'],
      allocate('detached', 'main_workflow_content'),
      'main_workflow_content',
    );
  if (source['main_mind_content'])
    attachDomain(
      'mind',
      source['main_mind_content'],
      allocate('detached', 'main_mind_content'),
      'main_mind_content',
    );
  store.cells[root.id] = root;
  const errors = validateCellStore(store, cellRegistry);
  if (errors.length)
    throw new Error(errors.map((error) => error.message).join('; '));
  const snapshot = { store: stripFrameViewports(store), detachedFrameIds };
  // Backup is saved before any replacement of the old root record.
  if (!(await adapter.getItem(MIGRATION_BACKUP_KEY)))
    await adapter.setItem(MIGRATION_BACKUP_KEY, source);
  await saveCellWorkspace(adapter, snapshot, cellRegistry);
  return snapshot;
};

/** Parse a file into a snapshot without writing the user's storage. */
export const parseLegacyFrameDocument = async (
  definition: string,
  registry?: CellRegistry,
): Promise<FrameSnapshot> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(definition);
  } catch {
    throw new Error('Invalid file');
  }
  if (isFrameSnapshotValue(parsed)) {
    const issues = validateCellStore(parsed.store, registry);
    if (issues.length)
      throw new Error(issues.map((issue) => issue.message).join('; '));
    return parsed;
  }
  if (isMindDocument(parsed) || isHostMindDocument(parsed))
    return { store: domainStore('mind', parsed) };
  if (isWorkflowDocument(parsed))
    return { store: domainStore('workflow', parsed) };
  if (isArchitectureDocument(parsed))
    return { store: domainStore('architecture', parsed) };
  if (isCellEnvelope(parsed))
    return { store: nativeDomainStore((parsed as CellEnvelope).store) };
  const record = parsed as { elements?: unknown } | null;
  if (!record || typeof record !== 'object' || !('elements' in record))
    throw new Error('Unsupported file');
  const memory = new Map<string, unknown>();
  const adapter: StorageAdapter = {
    listKeys: async () => [...memory.keys()],
    getItem: async (key) => memory.get(key),
    setItem: async (key, value) => {
      memory.set(key, value);
    },
    removeItem: async (key) => {
      memory.delete(key);
    },
  };
  await adapter.setItem(WORKSPACE_KEY, parsed);
  const snapshot = await migrateLegacyCellWorkspace(adapter, registry);
  return { store: snapshot.store };
};

const isFrameSnapshotValue = (value: unknown): value is FrameSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const store = (value as FrameSnapshot).store;
  return (
    !!store &&
    typeof store.rootId === 'string' &&
    isFrameCell(store.cells?.[store.rootId])
  );
};
