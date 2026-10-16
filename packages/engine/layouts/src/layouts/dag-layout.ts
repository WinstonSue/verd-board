export type Point = [number, number];

export type DagLayoutDirection = 'LR' | 'RL' | 'TB' | 'BT';

export interface DagLayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface DagLayoutEdge {
  source: string;
  target: string;
}

export interface DagLayoutOptions {
  direction?: DagLayoutDirection;
  nodeSep?: number;
  rankSep?: number;
}

export interface DagLayoutResult {
  positions: Record<string, Point>;
  width: number;
  height: number;
}

const DEFAULT_NODE_SEP = 48;
const DEFAULT_RANK_SEP = 96;

const longestPathRanks = (
  nodes: readonly DagLayoutNode[],
  edges: readonly DagLayoutEdge[],
) => {
  const ids = [...nodes.map((node) => node.id)].sort();
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  ids.forEach((id) => {
    incoming.set(id, []);
    outgoing.set(id, []);
  });
  const sortedEdges = [...edges].sort((a, b) => {
    const source = a.source.localeCompare(b.source);
    return source !== 0 ? source : a.target.localeCompare(b.target);
  });
  sortedEdges.forEach((edge) => {
    if (!incoming.has(edge.target) || !outgoing.has(edge.source)) {
      return;
    }
    incoming.get(edge.target)!.push(edge.source);
    outgoing.get(edge.source)!.push(edge.target);
  });

  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (id: string): number => {
    if (rank.has(id)) {
      return rank.get(id)!;
    }
    if (visiting.has(id)) {
      return 0;
    }
    visiting.add(id);
    const parents = incoming.get(id) ?? [];
    const value =
      parents.length === 0 ? 0 : Math.max(...parents.map(visit)) + 1;
    visiting.delete(id);
    rank.set(id, value);
    return value;
  };
  ids.forEach(visit);
  return { ids, rank, incoming, outgoing };
};

export const layoutDag = (
  nodes: readonly DagLayoutNode[],
  edges: readonly DagLayoutEdge[],
  options: DagLayoutOptions = {},
): DagLayoutResult => {
  const direction = options.direction ?? 'LR';
  const nodeSep = options.nodeSep ?? DEFAULT_NODE_SEP;
  const rankSep = options.rankSep ?? DEFAULT_RANK_SEP;
  const { ids, rank } = longestPathRanks(nodes, edges);
  const sizeById = new Map(nodes.map((node) => [node.id, node]));
  const ranks = new Map<number, string[]>();
  ids.forEach((id) => {
    const current = rank.get(id) ?? 0;
    const list = ranks.get(current) ?? [];
    list.push(id);
    ranks.set(current, list);
  });
  const orderedRanks = [...ranks.keys()].sort((a, b) => a - b);
  orderedRanks.forEach((value) => {
    ranks.get(value)!.sort((a, b) => a.localeCompare(b));
  });

  const positions: Record<string, Point> = {};
  let maxWidth = 0;
  let maxHeight = 0;
  let major = 0;

  orderedRanks.forEach((rankValue) => {
    const column = ranks.get(rankValue)!;
    let cursor = 0;
    column.forEach((id) => {
      const node = sizeById.get(id);
      const width = node?.width ?? 160;
      const height = node?.height ?? 72;
      const minor = cursor;
      let x = major;
      let y = minor;
      if (direction === 'TB') {
        x = minor;
        y = major;
      } else if (direction === 'RL') {
        x = -major - width;
        y = minor;
      } else if (direction === 'BT') {
        x = minor;
        y = -major - height;
      }
      positions[id] = [x, y];
      cursor +=
        (direction === 'LR' || direction === 'RL' ? height : width) + nodeSep;
      maxWidth = Math.max(maxWidth, x + width);
      maxHeight = Math.max(maxHeight, y + height);
    });
    major +=
      Math.max(
        ...column.map((id) => {
          const node = sizeById.get(id)!;
          return direction === 'LR' || direction === 'RL'
            ? node.width
            : node.height;
        }),
      ) + rankSep;
  });

  if (ids.length && (direction === 'RL' || direction === 'BT')) {
    const minX = Math.min(...Object.values(positions).map((point) => point[0]));
    const minY = Math.min(...Object.values(positions).map((point) => point[1]));
    Object.keys(positions).forEach((id) => {
      positions[id] = [positions[id][0] - minX, positions[id][1] - minY];
    });
    maxWidth = Math.max(
      ...ids.map((id) => positions[id][0] + sizeById.get(id)!.width),
    );
    maxHeight = Math.max(
      ...ids.map((id) => positions[id][1] + sizeById.get(id)!.height),
    );
  }

  return { positions, width: maxWidth, height: maxHeight };
};
