import type { Point } from '../interfaces/point';
import type { ArrangementBlock } from './arrangement';
import {
  graphArrangementPositions,
  type ArrangementLink,
} from './arrangement-graph';

/** Condense cycles before ranking; IDs, rather than insertion order, break ties. */
export function relationshipArrangementPositions(
  blocks: readonly ArrangementBlock[],
  links: readonly ArrangementLink[],
  nodeGap = 96,
  rankGap = 160,
): Map<string, Point> {
  const ids = blocks.map((block) => block.id).sort();
  const nodes = new Map(blocks.map((block) => [block.id, block]));
  const outgoing = new Map(ids.map((id) => [id, new Set<string>()]));
  const neighbors = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const { source, target } of links) {
    if (source === target || !nodes.has(source) || !nodes.has(target)) continue;
    outgoing.get(source)!.add(target);
    neighbors.get(source)!.add(target);
    neighbors.get(target)!.add(source);
  }
  let cursor = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const active = new Set<string>();
  const components: string[][] = [];
  const visit = (id: string) => {
    indices.set(id, cursor);
    low.set(id, cursor++);
    stack.push(id);
    active.add(id);
    for (const next of [...outgoing.get(id)!].sort()) {
      if (!indices.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id)!, low.get(next)!));
      } else if (active.has(next)) {
        low.set(id, Math.min(low.get(id)!, indices.get(next)!));
      }
    }
    if (low.get(id) !== indices.get(id)) return;
    const members: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      active.delete(member);
      members.push(member);
    } while (member !== id);
    components.push(members.sort());
  };
  ids.forEach((id) => {
    if (!indices.has(id)) visit(id);
  });
  const owner = new Map(
    components.flatMap((members, i) => members.map((id) => [id, i] as const)),
  );
  const ranks = components.map(() => 0);
  const incoming = components.map(() => new Set<number>());
  const successors = components.map(() => new Set<number>());
  for (const id of ids)
    for (const next of outgoing.get(id)!) {
      const from = owner.get(id)!,
        to = owner.get(next)!;
      if (from === to) continue;
      successors[from].add(to);
      incoming[to].add(from);
    }
  const ready = components.map((_, i) => i).filter((i) => !incoming[i].size);
  for (let at = 0; at < ready.length; at++) {
    const from = ready[at];
    for (const to of successors[from]) {
      ranks[to] = Math.max(ranks[to], ranks[from] + 1);
      incoming[to].delete(from);
      if (!incoming[to].size) ready.push(to);
    }
  }
  const seen = new Set<string>();
  const parts: {
    positions: Map<string, Point>;
    width: number;
    height: number;
  }[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const members = [id];
    seen.add(id);
    for (let at = 0; at < members.length; at++)
      for (const next of [...neighbors.get(members[at])!].sort()) {
        if (seen.has(next)) continue;
        seen.add(next);
        members.push(next);
      }
    const rows: ArrangementBlock[][] = [];
    for (const member of members.sort()) {
      const rank = ranks[owner.get(member)!];
      (rows[rank] ??= []).push(nodes.get(member)!);
    }
    const positions = graphArrangementPositions(rows, links, nodeGap, rankGap);
    parts.push({
      positions,
      width: Math.max(
        ...members.map(
          (member) =>
            positions.get(member)![0] + nodes.get(member)!.bounds.width,
        ),
      ),
      height: Math.max(
        ...members.map(
          (member) =>
            positions.get(member)![1] + nodes.get(member)!.bounds.height,
        ),
      ),
    });
  }
  const columns = Math.ceil(Math.sqrt(parts.length));
  const widths = Array.from({ length: columns }, (_, column) =>
    Math.max(
      ...parts
        .filter((_, i) => i % columns === column)
        .map((part) => part.width),
    ),
  );
  const result = new Map<string, Point>();
  let y = 0;
  for (let start = 0; start < parts.length; start += columns) {
    const row = parts.slice(start, start + columns);
    let x = 0;
    row.forEach((part, column) => {
      for (const [id, point] of part.positions)
        result.set(id, [x + point[0], y + point[1]]);
      x += widths[column] + nodeGap;
    });
    y += Math.max(...row.map((part) => part.height)) + nodeGap;
  }
  return result;
}
