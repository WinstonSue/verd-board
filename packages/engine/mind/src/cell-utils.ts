import {
  CellKind,
  NodeUtil,
  EdgeUtil,
  isEdgeCell,
  isNodeCell,
  type Cell,
  type CellStore,
  type CellRegistry,
  type EdgeCell,
  type NodeCell,
  type MindRootData,
  type MindChildData,
  type NodeGeometry,
  type CellCapabilities,
  type FrameMount,
  type CellMoveContext,
} from '@sue/board-core';
import { addMindChild, createMindChildCell } from './cell-commands';
import {
  GlobalLayout,
  ConnectingPosition,
  MindLayoutType,
  isHorizontalLayout,
  isHorizontalLogicLayout,
  isIndentedLayout,
  type OriginNode,
} from '@sue/board-layouts';
import {
  mindCellMetrics,
  validMindMaxWidth,
  type MindMetricsOptions,
} from './cell-metrics';
import { moveMindChild } from './cell-drag';

const branches = (store: CellStore) =>
  Object.values(store.cells).filter(
    (cell): cell is EdgeCell<{ order: string }> =>
      isEdgeCell(cell) && cell.kind === CellKind.mindBranch,
  );
export const mindChildIds = (store: CellStore, parentId: string): string[] =>
  branches(store)
    .filter(
      (edge) => 'cellId' in edge.source && edge.source.cellId === parentId,
    )
    .sort((a, b) => (a.data?.order ?? '').localeCompare(b.data?.order ?? ''))
    .flatMap((edge) => ('cellId' in edge.target ? [edge.target.cellId] : []));
export abstract class MindNodeUtil extends NodeUtil {
  override capabilities(
    store: CellStore,
    cell: Cell,
    mount: FrameMount,
  ): CellCapabilities {
    return { ...super.capabilities(store, cell, mount), resize: false };
  }
  override resize(): import('@sue/board-core').CellOperation[] {
    return [];
  }
  override rotate(
    _store: CellStore,
    cell: Cell,
    geometry: NodeGeometry,
  ): import('@sue/board-core').CellOperation[] {
    return isNodeCell(cell)
      ? [
          {
            type: 'replace_cell',
            cell: {
              ...cell,
              geometry: { ...cell.geometry, rotation: geometry.rotation },
            },
          },
        ]
      : [];
  }
}
export class MindRootNodeUtil extends MindNodeUtil {
  readonly kind = CellKind.mindRoot;
  override keyboard(
    store: CellStore,
    cell: Cell,
    key: string,
    allocateId: () => string,
  ) {
    return key === 'Tab'
      ? addMindChild(
          store,
          cell.id,
          createMindChildCell(allocateId()),
          allocateId(),
        )
      : undefined;
  }
  override validate(store: CellStore, cell: Cell): string | undefined {
    const maxWidth = (cell as NodeCell<MindRootData>).data?.maxNodeWidth;
    if (maxWidth !== undefined && !validMindMaxWidth(maxWidth))
      return 'Invalid Mind maximum width';
    if (
      branches(store).some(
        (edge) => 'cellId' in edge.target && edge.target.cellId === cell.id,
      )
    )
      return 'Mind roots cannot have incoming branches';
    return undefined;
  }
}
export class MindChildNodeUtil extends MindNodeUtil {
  readonly kind = CellKind.mindChild;
  override keyboard(
    store: CellStore,
    cell: Cell,
    key: string,
    allocateId: () => string,
  ) {
    if (key === 'Tab')
      return addMindChild(
        store,
        cell.id,
        createMindChildCell(allocateId()),
        allocateId(),
      );
    if (key === 'Enter') {
      const incoming = branches(store).find(
        (edge) => 'cellId' in edge.target && edge.target.cellId === cell.id,
      );
      if (incoming && 'cellId' in incoming.source)
        return addMindChild(
          store,
          incoming.source.cellId,
          createMindChildCell(allocateId()),
          allocateId(),
          mindChildIds(store, incoming.source.cellId).indexOf(cell.id) + 1,
          cell.id,
        );
    }
    if (key === 'Space' || key === '/')
      return [
        {
          type: 'replace_cell' as const,
          cell: {
            ...cell,
            data: {
              ...(cell as NodeCell<MindChildData>).data,
              collapsed: !(cell as NodeCell<MindChildData>).data?.collapsed,
            },
          },
        },
      ];
    return undefined;
  }
  override move(
    store: CellStore,
    cell: Cell,
    geometry: NodeGeometry,
    targetId?: string,
    context?: CellMoveContext,
  ) {
    return moveMindChild(store, cell, geometry, targetId, context);
  }
  override capabilities(
    store: CellStore,
    cell: Cell,
    mount: FrameMount,
  ): CellCapabilities {
    return { ...super.capabilities(store, cell, mount), move: false };
  }
  override validate(store: CellStore, cell: Cell): string | undefined {
    if (
      branches(store).filter(
        (edge) => 'cellId' in edge.target && edge.target.cellId === cell.id,
      ).length !== 1
    )
      return 'Mind child must have exactly one branch parent';
    return undefined;
  }
}
export class MindSummaryNodeUtil extends MindNodeUtil {
  readonly kind = CellKind.mindSummary;
  override capabilities(
    store: CellStore,
    cell: Cell,
    mount: FrameMount,
  ): CellCapabilities {
    return {
      ...super.capabilities(store, cell, mount),
      move: false,
      connect: false,
    };
  }
  override validate(store: CellStore, cell: Cell): string | undefined {
    const edges = Object.values(store.cells).filter(
      (edge) =>
        isEdgeCell(edge) &&
        edge.kind === CellKind.mindSummaryEdge &&
        'cellId' in edge.target &&
        edge.target.cellId === cell.id,
    );
    return edges.length === 1
      ? undefined
      : 'Mind summary must have exactly one range edge';
  }
}
export class MindBranchEdgeUtil extends EdgeUtil {
  readonly kind = CellKind.mindBranch;
  override validateEdge(store: CellStore, edge: EdgeCell): string | undefined {
    if (!('cellId' in edge.source) || !('cellId' in edge.target))
      return 'Mind branches require node endpoints';
    const sourceId = edge.source.cellId,
      targetId = edge.target.cellId;
    if (
      ![CellKind.mindRoot, CellKind.mindChild].includes(
        store.cells[sourceId]?.kind as never,
      ) ||
      store.cells[targetId]?.kind !== CellKind.mindChild
    )
      return 'Invalid mind branch endpoints';
    const seen = new Set<string>();
    let current: string | undefined = sourceId;
    const edges = branches(store);
    while (current) {
      if (current === targetId || seen.has(current)) return 'Mind branch cycle';
      seen.add(current);
      const parent = edges.find(
        (candidate) =>
          'cellId' in candidate.target && candidate.target.cellId === current,
      );
      current =
        parent && 'cellId' in parent.source ? parent.source.cellId : undefined;
    }
    const order = (edge.data as { order?: string })?.order;
    if (
      typeof order !== 'string' ||
      edges.some(
        (other) =>
          other.id !== edge.id &&
          'cellId' in other.source &&
          other.source.cellId === sourceId &&
          other.data?.order === order,
      )
    )
      return 'Mind sibling order must be unique';
    return undefined;
  }
}
export class MindSummaryEdgeUtil extends EdgeUtil {
  readonly kind = CellKind.mindSummaryEdge;
  override validateEdge(store: CellStore, edge: EdgeCell): string | undefined {
    if (
      !('cellId' in edge.target) ||
      store.cells[edge.target.cellId]?.kind !== CellKind.mindSummary
    )
      return 'Summary target must be a summary node';
    const range = edge.data as
      { startSiblingId: string; endSiblingId: string } | undefined;
    if (!range) return 'Missing summary range';
    if (
      !('cellId' in edge.source) ||
      edge.source.cellId !== range.startSiblingId
    )
      return 'Summary source must match its first sibling';
    const edges = branches(store);
    const first = edges.find(
      (candidate) =>
        'cellId' in candidate.target &&
        candidate.target.cellId === range.startSiblingId,
    );
    const last = edges.find(
      (candidate) =>
        'cellId' in candidate.target &&
        candidate.target.cellId === range.endSiblingId,
    );
    if (
      !first ||
      !last ||
      !('cellId' in first.source) ||
      !('cellId' in last.source) ||
      first.source.cellId !== last.source.cellId
    )
      return 'Summary range must cover siblings';
    const siblings = mindChildIds(store, first.source.cellId);
    if (
      siblings.indexOf(range.startSiblingId) >
      siblings.indexOf(range.endSiblingId)
    )
      return 'Reversed summary range';
    return undefined;
  }
}
export const registerMindCells = (registry: CellRegistry) => {
  [
    new MindRootNodeUtil(),
    new MindChildNodeUtil(),
    new MindSummaryNodeUtil(),
    new MindBranchEdgeUtil(),
    new MindSummaryEdgeUtil(),
  ].forEach((util) => registry.register(util));
};
interface CellLayoutNode extends OriginNode {
  id: string;
  children: CellLayoutNode[];
  outline?: string;
}
const BASE = 4;
const layoutGaps = (origin: CellLayoutNode, parent?: { layout?: string }) => {
  const layout = (parent?.layout ||
    origin.layout ||
    MindLayoutType.right) as MindLayoutType;
  const root = !parent;
  const main = root ? BASE * 12 : BASE * 3;
  const second = root ? BASE * 12 : BASE * 8.5;
  if (isIndentedLayout(layout))
    return { horizontal: BASE * 6, vertical: BASE * 3.5 };
  if (!isHorizontalLayout(layout))
    return { horizontal: main, vertical: second };
  return { horizontal: second, vertical: main };
};
/** Layout trees are ephemeral: relationships in the saved store remain edges. */
export const layoutMindCells = (
  store: CellStore,
  frameId: string,
  options: MindMetricsOptions = {},
): Map<string, NodeGeometry> => {
  const result = new Map<string, NodeGeometry>();
  const frame = store.cells[frameId];
  if (frame?.cellType !== 'frame') return result;
  const childrenByParent = new Map<string, string[]>();
  for (const edge of branches(store).sort((a, b) =>
    (a.data?.order ?? '').localeCompare(b.data?.order ?? ''),
  )) {
    if (!('cellId' in edge.source) || !('cellId' in edge.target)) continue;
    const children = childrenByParent.get(edge.source.cellId) ?? [];
    children.push(edge.target.cellId);
    childrenByParent.set(edge.source.cellId, children);
  }
  const summariesByStart = new Map<
    string,
    EdgeCell<{ startSiblingId: string; endSiblingId: string }>[]
  >();
  for (const cell of Object.values(store.cells)) {
    if (
      !isEdgeCell(cell) ||
      cell.kind !== CellKind.mindSummaryEdge ||
      !cell.data
    )
      continue;
    const edge = cell as EdgeCell<{
      startSiblingId: string;
      endSiblingId: string;
    }>;
    const start = edge.data!.startSiblingId;
    const summaries = summariesByStart.get(start) ?? [];
    summaries.push(edge);
    summariesByStart.set(start, summaries);
  }
  const summaryOrder = new Map(
    Object.keys(store.cells).map((id, at) => [id, at]),
  );
  const metrics = new Map<string, ReturnType<typeof mindCellMetrics>>();
  let effectiveOptions = options;
  const size = (id: string) => {
    let value = metrics.get(id);
    if (!value)
      metrics.set(
        id,
        (value = mindCellMetrics(
          store.cells[id] as NodeCell,
          effectiveOptions,
        )),
      );
    return value;
  };
  const build = (id: string): CellLayoutNode => {
    const cell = store.cells[id] as NodeCell<MindRootData & MindChildData>;
    const children = cell.data?.collapsed
      ? []
      : (childrenByParent.get(id) ?? []).map(build);
    const rightNodeCount =
      cell.data?.rightNodeCount ?? Math.ceil(children.length / 2);
    const childIds = new Set(children.map((child) => child.id));
    const summaries = [...childIds]
      .flatMap((id) => summariesByStart.get(id) ?? [])
      .sort((a, b) => summaryOrder.get(a.id)! - summaryOrder.get(b.id)!);
    summaries.forEach((edge) => {
      if (!('cellId' in edge.target)) return;
      const range = edge.data!;
      children.push({
        ...build(edge.target.cellId),
        start: children.findIndex((child) => child.id === range.startSiblingId),
        end: children.findIndex((child) => child.id === range.endSiblingId),
      } as CellLayoutNode);
    });
    return {
      id,
      children,
      isCollapsed: cell.data?.collapsed,
      layout: cell.data?.layout,
      outline:
        typeof cell.geometry.outline === 'object'
          ? cell.geometry.outline.kind
          : cell.geometry.outline,
      rightNodeCount,
    };
  };
  (frame as import('@sue/board-core').FrameCell).children.forEach((id) => {
    const center = store.cells[id];
    if (!isNodeCell(center) || center.kind !== CellKind.mindRoot) return;
    effectiveOptions = {
      ...options,
      maxNodeWidth: validMindMaxWidth(
        (center.data as MindRootData)?.maxNodeWidth,
      )
        ? (center.data as MindRootData).maxNodeWidth
        : options.maxNodeWidth,
    };
    const tree = build(id);
    const layout = GlobalLayout.layout(
      tree,
      {
        getWidth: (origin) => size((origin as CellLayoutNode).id).width,
        getHeight: (origin) => size((origin as CellLayoutNode).id).height,
        getHorizontalGap: (origin, parent) =>
          layoutGaps(origin as CellLayoutNode, parent).horizontal,
        getVerticalGap: (origin, parent) =>
          layoutGaps(origin as CellLayoutNode, parent).vertical,
        getVerticalConnectingPosition: (origin, parent) =>
          (origin as CellLayoutNode).outline === 'underline' &&
          parent &&
          isHorizontalLogicLayout(
            (parent.layout as MindLayoutType) || MindLayoutType.right,
          )
            ? ConnectingPosition.bottom
            : ConnectingPosition.middle,
        getExtendHeight: () => 0,
        getIndentedCrossLevelGap: () => BASE,
      },
      (tree.layout ?? MindLayoutType.right) as MindLayoutType,
    );
    const dx = center.geometry.x - layout.x - layout.hGap,
      dy = center.geometry.y - layout.y - layout.vGap;
    layout.eachNode((item) => {
      const nodeId = (item.origin as CellLayoutNode).id;
      const original = store.cells[nodeId] as NodeCell;
      result.set(nodeId, {
        ...original.geometry,
        x: item.x + item.hGap + dx,
        y: item.y + item.vGap + dy,
        width: size(nodeId).width,
        height: size(nodeId).height,
      });
    });
  });
  return result;
};
