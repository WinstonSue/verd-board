import {
  portKey,
  terminalKey,
  type EdgeCell,
  type Point,
  type PortRef,
  type TerminalRef,
} from '@sue/board-core';

export const PORT_COINCIDENCE_EPSILON = 1e-6;
export type PortOwner = PortRef | TerminalRef;
export interface PortCandidate {
  key: string;
  point: Point;
  owner: PortOwner;
  boundNodeId?: string;
  boundPortId?: string;
}
export interface ResolvedPortGroup {
  key: string;
  point: Point;
  members: readonly PortCandidate[];
  owner: PortCandidate | null;
  blocked: boolean;
  selected: boolean;
}
export interface SelectedEndpointPlan {
  groups: readonly ResolvedPortGroup[];
  endpoints: readonly PortCandidate[];
  suppressedNodePortKeys: ReadonlySet<string>;
  ownedEdgeEndKeys: ReadonlySet<string>;
  hasPoint(point: Point): boolean;
}
export { portKey, terminalKey };
export const portsCoincide = (a: Point, b: Point) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]) <= PORT_COINCIDENCE_EPSILON;

export function resolvePortGroup(
  members: readonly PortCandidate[],
  state: {
    selectedIds: ReadonlySet<string>;
    nodeMode: boolean;
    hoveredId?: string | null;
    connecting?: boolean;
  },
): ResolvedPortGroup {
  const sorted = [...members].sort((a, b) => a.key.localeCompare(b.key));
  const nodes = sorted.filter((member) => member.owner.kind === 'node');
  const selectedEnds = sorted.filter(
    (member) =>
      member.owner.kind === 'edge' &&
      state.selectedIds.has(member.owner.edgeId),
  );
  const node =
    nodes.find(
      (member) =>
        member.owner.kind === 'node' &&
        state.selectedIds.has(member.owner.nodeId),
    ) ?? nodes[0];
  const blocked = !(state.nodeMode && node) && selectedEnds.length > 1;
  const hovered = state.connecting
    ? undefined
    : sorted.find(
        (member) =>
          member.owner.kind === 'edge' &&
          member.owner.edgeId === state.hoveredId,
      );
  const owner =
    state.nodeMode && node
      ? node
      : blocked
        ? null
        : (selectedEnds[0] ?? hovered ?? node ?? null);
  return {
    key:
      sorted.find((member) => member.owner.kind === 'edge')?.key ??
      sorted[0].key,
    point: owner?.point ?? sorted[0].point,
    members: sorted,
    owner,
    blocked,
    selected:
      blocked ||
      (!!owner &&
        state.selectedIds.has(
          owner.owner.kind === 'edge' ? owner.owner.edgeId : owner.owner.nodeId,
        )),
  };
}

/** Only selected edges need independent groups; ordinary ports stay virtualized. */
export function buildSelectedEndpointPlan(options: {
  edges: readonly EdgeCell[];
  selectedIds: ReadonlySet<string>;
  nodeMode: boolean;
  getPoints(edge: EdgeCell): readonly Point[];
  getNodePorts(nodeId: string): readonly PortCandidate[];
  queryNodePorts(point: Point): readonly PortCandidate[];
}): SelectedEndpointPlan {
  const buckets = new Map<
    string,
    Array<{ point: Point; members: PortCandidate[] }>
  >();
  const endpoints: PortCandidate[] = [];
  const groups: Array<{ point: Point; members: PortCandidate[] }> = [];
  const cell = (point: Point) =>
    point.map((value) => Math.floor(value / PORT_COINCIDENCE_EPSILON));
  const nearby = (point: Point) => {
    const [x, y] = cell(point);
    const result: typeof groups = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        result.push(...(buckets.get(`${x + dx},${y + dy}`) ?? []));
      }
    return result;
  };
  for (const edge of [...options.edges].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const points = options.getPoints(edge);
    if (points.length < 2) continue;
    for (const end of ['source', 'target'] as const) {
      const terminal = edge[end];
      const point = end === 'source' ? points[0] : points.at(-1)!;
      const candidate: PortCandidate = {
        key: terminalKey(edge.id, end),
        point,
        owner: { kind: 'edge', edgeId: edge.id, end },
        ...('cellId' in terminal
          ? {
              boundNodeId: terminal.cellId,
              boundPortId: terminal.portId,
            }
          : {}),
      };
      endpoints.push(candidate);
      let group = nearby(point).find((group) =>
        portsCoincide(group.point, point),
      );
      if (!group) {
        group = { point, members: [] };
        groups.push(group);
        const key = cell(point).join(',');
        const bucket = buckets.get(key) ?? [];
        bucket.push(group);
        buckets.set(key, bucket);
      }
      group.members.push(candidate);
      const ports =
        'cellId' in terminal
          ? options.getNodePorts(terminal.cellId)
          : options.queryNodePorts(point);
      for (const port of ports) {
        if (
          portsCoincide(port.point, point) &&
          !group.members.some((member) => member.key === port.key)
        )
          group.members.push(port);
      }
    }
  }
  return {
    groups: groups.map((group) => resolvePortGroup(group.members, options)),
    endpoints,
    suppressedNodePortKeys: new Set(
      groups.flatMap((group) =>
        group.members
          .filter((member) => member.owner.kind === 'node')
          .map((member) => member.key),
      ),
    ),
    ownedEdgeEndKeys: new Set(endpoints.map((endpoint) => endpoint.key)),
    hasPoint: (point) =>
      nearby(point).some((group) => portsCoincide(group.point, point)),
  };
}
