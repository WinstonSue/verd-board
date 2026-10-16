import type { Point } from '../interfaces/point';

interface LayoutNode {
  id: string;
  bounds: { width: number; height: number };
}
export interface ArrangementLink {
  source: string;
  target: string;
}
interface Vertex {
  id: string;
  key: string;
  rank: number;
  width: number;
  height: number;
  real: boolean;
  before: Vertex[];
  after: Vertex[];
  peers: Vertex[];
  center: number;
}

const compare = (a: Vertex, b: Vertex) => a.key.localeCompare(b.key);
const positions = (rows: Vertex[][]) =>
  new Map(rows.flatMap((row) => row.map((node, i) => [node, i] as const)));

/** Count strict inversions; edges sharing either endpoint never cross. */
const crossingCount = (rows: Vertex[][], order: Map<Vertex, number>) => {
  let count = 0;
  for (let rank = 0; rank < rows.length - 1; rank++) {
    const tree = new Array<number>(rows[rank + 1].length + 1).fill(0);
    let seen = 0;
    for (const node of rows[rank]) {
      for (const neighbor of node.after) {
        let prefix = 0;
        for (let i = order.get(neighbor)! + 1; i > 0; i -= i & -i)
          prefix += tree[i];
        count += seen - prefix;
      }
      for (const neighbor of node.after) {
        for (let i = order.get(neighbor)! + 1; i < tree.length; i += i & -i)
          tree[i]++;
        seen++;
      }
    }
  }
  return count;
};

const orderingScore = (rows: Vertex[][]): [number, number] => {
  const order = positions(rows);
  const normalized = (node: Vertex) =>
    (order.get(node)! + 0.5) / rows[node.rank].length;
  let span = 0;
  for (const row of rows)
    for (const node of row)
      for (const neighbor of [...node.after, ...node.peers])
        span += Math.abs(normalized(node) - normalized(neighbor));
  return [crossingCount(rows, order), span];
};
const improves = (a: [number, number], b: [number, number]) =>
  a[0] < b[0] || (a[0] === b[0] && a[1] < b[1] - 1e-9);

function reduceCrossings(rows: Vertex[][]) {
  let best = rows.map((row) => [...row]);
  let score = orderingScore(rows);
  for (let pass = 0; pass < 8; pass++) {
    for (const forward of [true, false]) {
      const ranks = rows.map((_, rank) => rank);
      if (!forward) ranks.reverse();
      for (const rank of ranks) {
        const order = positions(rows);
        const barycenter = (node: Vertex) => {
          const neighbors = forward ? node.before : node.after;
          return neighbors.length
            ? neighbors.reduce(
                (sum, neighbor) => sum + order.get(neighbor)!,
                0,
              ) / neighbors.length
            : order.get(node)!;
        };
        rows[rank].sort(
          (a, b) => barycenter(a) - barycenter(b) || compare(a, b),
        );
        // A barycenter sweep can miss improvements when degrees differ.
        // Adjacent swaps evaluate both neighboring ranks together.
        for (let sweep = 0; sweep < 4; sweep++) {
          let changed = false;
          const neighborOrder = positions(rows);
          for (let i = 0; i < rows[rank].length - 1; i++) {
            const a = rows[rank][i],
              b = rows[rank][i + 1];
            let delta = 0;
            for (const side of ['before', 'after'] as const)
              for (const left of a[side])
                for (const right of b[side])
                  delta += Math.sign(
                    neighborOrder.get(right)! - neighborOrder.get(left)!,
                  );
            if (delta < 0) {
              rows[rank][i] = b;
              rows[rank][i + 1] = a;
              changed = true;
            }
          }
          if (!changed) break;
        }
      }
      const next = orderingScore(rows);
      if (improves(next, score)) {
        score = next;
        best = rows.map((row) => [...row]);
      }
    }
  }
  return best;
}

/** Project desired centers onto the minimum-gap constraints using isotonic regression. */
function alignRow(row: Vertex[], forward: boolean, nodeSep: number) {
  const offsets: number[] = [];
  const groups: { start: number; end: number; sum: number; weight: number }[] =
    [];
  for (let i = 0; i < row.length; i++) {
    const node = row[i];
    offsets[i] = i
      ? offsets[i - 1] + (row[i - 1].width + node.width) / 2 + nodeSep
      : 0;
    const neighbors = forward ? node.before : node.after;
    const weight = Math.max(1, neighbors.length);
    const desired = neighbors.length
      ? neighbors.reduce((sum, neighbor) => sum + neighbor.center, 0) / weight
      : node.center;
    groups.push({
      start: i,
      end: i,
      sum: (desired - offsets[i]) * weight,
      weight,
    });
    while (groups.length > 1) {
      const right = groups.at(-1)!,
        left = groups.at(-2)!;
      if (left.sum / left.weight <= right.sum / right.weight) break;
      left.end = right.end;
      left.sum += right.sum;
      left.weight += right.weight;
      groups.pop();
    }
  }
  for (const group of groups)
    for (let i = group.start; i <= group.end; i++)
      row[i].center = group.sum / group.weight + offsets[i];
}

/** Stable authored layout only. Virtual vertices reserve a lane for skipped ranks. */
export function graphArrangementPositions(
  inputRows: readonly (readonly LayoutNode[])[],
  links: readonly ArrangementLink[],
  nodeSep = 48,
  rankSep = 96,
): Map<string, Point> {
  let rows: Vertex[][] = inputRows.map((row, rank) =>
    row.map((node) => ({
      id: node.id,
      key: `node:${node.id}`,
      rank,
      width: node.bounds.width,
      height: node.bounds.height,
      real: true,
      before: [],
      after: [],
      peers: [],
      center: 0,
    })),
  );
  const nodes = new Map(
    rows.flatMap((row) => row.map((node) => [node.id, node])),
  );
  const pairs = new Set<string>();
  for (const link of [...links].sort(
    (a, b) =>
      a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
  )) {
    let source = nodes.get(link.source),
      target = nodes.get(link.target);
    if (!source || !target || source === target) continue;
    const pair = JSON.stringify([source.id, target.id].sort());
    if (pairs.has(pair)) continue;
    pairs.add(pair);
    if (source.rank === target.rank) {
      source.peers.push(target);
      target.peers.push(source);
      continue;
    }
    if (source.rank > target.rank) [source, target] = [target, source];
    let previous = source;
    for (let rank = source.rank + 1; rank <= target.rank; rank++) {
      const next: Vertex =
        rank === target.rank
          ? target
          : {
              id: '',
              key: `edge:${JSON.stringify([source.id, target.id, rank])}`,
              rank,
              width: 0,
              height: 0,
              real: false,
              before: [],
              after: [],
              peers: [],
              center: 0,
            };
      if (!next.real) rows[rank].push(next);
      previous.after.push(next);
      next.before.push(previous);
      previous = next;
    }
  }
  rows.forEach((row) => row.sort(compare));
  rows = reduceCrossings(rows);
  for (const row of rows) {
    const width =
      row.reduce((sum, node) => sum + node.width, 0) +
      Math.max(0, row.length - 1) * nodeSep;
    let cursor = -width / 2;
    for (const node of row) {
      node.center = cursor + node.width / 2;
      cursor += node.width + nodeSep;
    }
  }
  for (let pass = 0; pass < 4; pass++) {
    rows.forEach((row) => alignRow(row, true, nodeSep));
    [...rows].reverse().forEach((row) => alignRow(row, false, nodeSep));
  }
  const left = Math.min(
    ...[...nodes.values()].map((node) => node.center - node.width / 2),
  );
  const result = new Map<string, Point>();
  let y = 0;
  for (const row of rows) {
    const height = Math.max(0, ...row.map((node) => node.height));
    for (const node of row)
      if (node.real)
        result.set(node.id, [
          Math.round(node.center - node.width / 2 - left),
          y + Math.round((height - node.height) / 2),
        ]);
    y += height + rankSep;
  }
  return result;
}
