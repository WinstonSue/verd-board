import {
  CellKind,
  createFrameCell,
  isNodeCell,
  validateCellStore,
  type Cell,
  type EdgeCell,
  type EdgeTerminal,
  type FrameSnapshot,
  type NodeCell,
  type NodeAppearance,
  type Point,
} from '@sue/board-core';
import { createInlineText } from '@sue/board-common';
import { drawCellPorts } from '@sue/board-draw';
import type { Flowchart } from './parser/flowchart.js';
import type { Sequence } from './parser/sequence.js';
import type { Class } from './parser/class.js';
import type { GraphImage } from './interfaces.js';
import type { Node } from './elementSkeleton.js';
import { removeMarkdown } from './markdown-to-text.js';

export interface FrameImportConfig {
  fontSize?: number;
}
const label = (text: string, markdown = false) =>
  (markdown ? removeMarkdown(text) : text)
    .replace(/<br\s*\/?>|\\n/g, '\n')
    .replace(/<\/?(?:sub|small|i)>/g, '')
    .replace(/\s?(?:fa|fab):[a-zA-Z0-9-]+/g, '');
const style = (
  value: string | null | undefined,
): 'solid' | 'dotted' | 'dashed' =>
  value === 'dotted' ? 'dotted' : value === 'dashed' ? 'dashed' : 'solid';

/** Mermaid's parsed geometry is written directly into the common Cell runtime. */
export const graphToFrameSnapshot = (
  graph: Flowchart | Sequence | Class | GraphImage,
  config: FrameImportConfig = {},
): FrameSnapshot => {
  const frame = createFrameCell('mermaid:frame');
  const cells: Record<string, Cell> = { [frame.id]: frame };
  const origins = new Map<string, string>();
  const groups = new Map<string, string[]>();
  let sequence = 0;
  const unique = (category: string, key?: string) => {
    const prefix = `mermaid:${category}:${encodeURIComponent(key ?? String(++sequence))}`;
    let id = prefix,
      suffix = 0;
    while (cells[id]) id = `${prefix}:${++suffix}`;
    return id;
  };
  const add = <T extends Cell>(
    cell: T,
    origin?: string,
    groupId?: string,
  ): T => {
    cells[cell.id] = cell;
    frame.children.push(cell.id);
    if (origin) origins.set(origin, cell.id);
    if (groupId) groups.set(groupId, [...(groups.get(groupId) ?? []), cell.id]);
    return cell;
  };
  const node = (
    key: string | undefined,
    x: number,
    y: number,
    width: number,
    height: number,
    outline: string,
    text: string,
    appearance: NodeAppearance = {},
    groupId?: string,
  ): NodeCell =>
    add(
      {
        id: unique('node', key),
        kind: CellKind.geometry,
        cellType: 'node',
        geometry: {
          x,
          y,
          width: Math.max(1, width),
          height: Math.max(1, height),
          outline,
        },
        appearance: {
          fill: outline === 'text' ? 'none' : '#ECECFF',
          strokeColor: outline === 'text' ? 'none' : '#9370DB',
          strokeWidth: 1,
          ...appearance,
        },
        ports: drawCellPorts(),
        content: { label: text, text: createInlineText(text) },
        data: { fontSize: config.fontSize ?? 20 },
      },
      key,
      groupId,
    );
  const terminal = (point: Point, origin?: string): EdgeTerminal => {
    const id = origin && origins.get(origin),
      cell = id ? cells[id] : undefined;
    if (!isNodeCell(cell)) return { point };
    const g = cell.geometry;
    const sides = [
      {
        side: 'left' as const,
        distance: Math.abs(point[0] - g.x),
        offset: (point[1] - g.y) / g.height,
      },
      {
        side: 'right' as const,
        distance: Math.abs(point[0] - g.x - g.width),
        offset: (point[1] - g.y) / g.height,
      },
      {
        side: 'top' as const,
        distance: Math.abs(point[1] - g.y),
        offset: (point[0] - g.x) / g.width,
      },
      {
        side: 'bottom' as const,
        distance: Math.abs(point[1] - g.y - g.height),
        offset: (point[0] - g.x) / g.width,
      },
    ].sort((a, b) => a.distance - b.distance);
    const hit = sides[0],
      portId = `binding:${++sequence}`;
    cell.ports!.push({
      id: portId,
      side: hit.side,
      direction: 'both',
      offset: Math.max(0, Math.min(1, hit.offset)),
    });
    return { cellId: cell.id, portId };
  };
  const arrow = (
    points: Point[],
    options: {
      key?: string;
      sourceId?: string;
      targetId?: string;
      sourceMarker?: string | null;
      targetMarker?: string | null;
      text?: string;
      strokeColor?: string | null;
      strokeWidth?: number | null;
      strokeStyle?: string | null;
      groupId?: string;
    },
  ) => {
    if (points.length < 2) throw new Error('Mermaid edge is missing geometry');
    return add<EdgeCell>(
      {
        id: unique('edge', options.key),
        kind: CellKind.arrow,
        cellType: 'edge',
        source: terminal(points[0], options.sourceId),
        target: terminal(points.at(-1)!, options.targetId),
        route: { mode: 'fixed', points },
        labels: options.text
          ? [{ text: label(options.text), position: 0.5 }]
          : [],
        appearance: {
          strokeColor: options.strokeColor || '#334155',
          strokeWidth: options.strokeWidth || 1,
          strokeStyle: style(options.strokeStyle),
        },
        data: {
          sourceMarker: options.sourceMarker ?? 'none',
          targetMarker: options.targetMarker ?? 'none',
        },
      },
      options.key,
      options.groupId,
    );
  };
  const skeleton = (element: Node) => {
    switch (element.type) {
      case 'rectangle':
      case 'ellipse':
        return node(
          element.id,
          element.x,
          element.y,
          element.width || 100,
          element.height || 30,
          element.type,
          label(element.label?.text ?? ''),
          {
            fill:
              element.bgColor ??
              (element.subtype === 'activation' ? '#e9ecef' : '#ECECFF'),
            strokeColor: element.strokeColor,
            strokeWidth: element.strokeWidth ?? 1,
            strokeStyle: style(element.strokeStyle),
          },
          element.groupId,
        );
      case 'text':
        return node(
          element.id,
          element.x,
          element.y,
          element.width || 100,
          element.height || 20,
          'text',
          label(element.text),
          {},
          element.groupId,
        );
      case 'line':
        return arrow(
          [
            [element.startX, element.startY],
            [element.endX, element.endY],
          ],
          {
            key: element.id,
            strokeColor: element.strokeColor,
            strokeWidth: element.strokeWidth,
            strokeStyle: element.strokeStyle,
            groupId: element.groupId,
          },
        );
      case 'arrow': {
        const points: Point[] = element.points?.length
          ? element.points.map(([x, y]) => [
              x + element.startX,
              y + element.startY,
            ])
          : [
              [element.startX, element.startY],
              [element.endX, element.endY],
            ];
        return arrow(points, {
          key: element.id,
          sourceId: element.start?.id,
          targetId: element.end?.id,
          sourceMarker: element.startArrowhead,
          targetMarker: element.endArrowhead,
          text: element.label?.text ?? '',
          strokeColor: element.strokeColor,
          strokeWidth: element.strokeWidth,
          strokeStyle: element.strokeStyle,
          groupId: element.groupId,
        });
      }
    }
  };
  const surround = (ids: string[], text: string, fill?: string) => {
    const nodes = ids.map((id) => cells[id]).filter(isNodeCell);
    if (!nodes.length) return;
    const x = Math.min(...nodes.map((n) => n.geometry.x)) - 30,
      y = Math.min(...nodes.map((n) => n.geometry.y)) - 30;
    const right =
      Math.max(...nodes.map((n) => n.geometry.x + n.geometry.width)) + 30;
    const bottom =
      Math.max(...nodes.map((n) => n.geometry.y + n.geometry.height)) + 30;
    const container = node(
      undefined,
      x,
      y,
      right - x,
      bottom - y,
      'rectangle',
      '',
      { fill: fill || 'none', strokeWidth: 1 },
    );
    const title = node(undefined, x, y, right - x, 28, 'text', text);
    frame.children.splice(frame.children.indexOf(container.id), 1);
    frame.children.splice(frame.children.indexOf(title.id), 1);
    frame.children.unshift(container.id, title.id);
    return [container.id, title.id];
  };
  if (graph.type === 'graphImage')
    add({
      id: unique('image'),
      kind: CellKind.image,
      cellType: 'node',
      geometry: { x: 0, y: 0, width: graph.width, height: graph.height },
      data: { url: graph.dataURL },
    });
  else if (graph.type === 'flowchart') {
    const parents = new Map<string, string>();
    for (const sub of graph.subGraphs)
      for (const id of sub.nodeIds) parents.set(id, sub.id);
    const outerGroup = (id: string) => {
      let parent = parents.get(id),
        result = parent;
      const seen = new Set<string>();
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        result = parent;
        parent = parents.get(parent);
      }
      return result;
    };
    for (const sub of [...graph.subGraphs].reverse()) {
      const groupId = outerGroup(sub.id) ?? sub.id;
      node(
        sub.id,
        sub.x,
        sub.y,
        sub.width,
        sub.height,
        'rectangle',
        '',
        { fill: '#ffffde', strokeColor: '#aaaa33' },
        groupId,
      );
      node(
        `${sub.id}:title`,
        sub.x,
        sub.y,
        sub.width,
        28,
        'text',
        label(sub.text, sub.labelType === 'markdown'),
        {},
        groupId,
      );
    }
    for (const vertex of Object.values(graph.vertices)) {
      if (!vertex) continue;
      const outline =
        (
          {
            round: 'roundRectangle',
            stadium: 'terminal',
            doublecircle: 'ellipse',
            circle: 'ellipse',
            diamond: 'diamond',
          } as Record<string, string>
        )[vertex.type] ?? 'rectangle';
      const s = vertex.containerStyle;
      const appearance: NodeAppearance = {
        fill: s.fill ?? '#ECECFF',
        strokeColor: s.stroke ?? '#9370DB',
        strokeWidth: parseFloat(s['stroke-width'] ?? '1'),
        strokeStyle: s['stroke-dasharray'] ? 'dashed' : 'solid',
      };
      const n = node(
        vertex.id,
        vertex.x,
        vertex.y,
        vertex.width,
        vertex.height,
        outline,
        vertex.type === 'doublecircle'
          ? ''
          : label(vertex.text, vertex.labelType === 'markdown'),
        appearance,
        outerGroup(vertex.id),
      );
      n.data = {
        fontSize: config.fontSize ?? 20,
        color: vertex.labelStyle.color,
        link: vertex.link,
      };
      if (vertex.type === 'doublecircle')
        node(
          `${vertex.id}:inner`,
          vertex.x + 5,
          vertex.y + 5,
          Math.max(1, vertex.width - 10),
          Math.max(1, vertex.height - 10),
          'ellipse',
          label(vertex.text),
          appearance,
          outerGroup(vertex.id),
        );
    }
    for (const edge of graph.edges) {
      const points: Point[] =
        edge.reflectionPoints.length >= 2
          ? edge.reflectionPoints.map((p) => [p.x, p.y])
          : [
              [edge.startX, edge.startY],
              [edge.endX, edge.endY],
            ];
      const double = edge.type.startsWith('double_'),
        open = edge.type === 'arrow_open';
      arrow(points, {
        key: edge.id,
        sourceId: edge.start,
        targetId: edge.end,
        text: label(edge.text, edge.labelType === 'markdown'),
        sourceMarker: double ? 'arrow' : 'none',
        targetMarker: open ? 'none' : 'arrow',
        strokeStyle: edge.stroke,
        groupId:
          outerGroup(edge.start) === outerGroup(edge.end)
            ? outerGroup(edge.start)
            : undefined,
      });
    }
  } else {
    const activations: Node[] = [];
    for (const group of graph.nodes)
      for (const element of group) {
        if (element.type === 'rectangle' && element.subtype === 'activation')
          activations.push(element);
        else skeleton(element);
      }
    for (const line of graph.lines) skeleton(line);
    for (const element of graph.arrows) {
      skeleton(element);
      if (element.sequenceNumber) skeleton(element.sequenceNumber);
    }
    for (const element of activations) skeleton(element);
    if (graph.type === 'sequence') {
      if (graph.loops)
        for (const element of [
          ...graph.loops.lines,
          ...graph.loops.texts,
          ...graph.loops.nodes,
        ])
          skeleton(element);
      for (const group of graph.groups) {
        const ids = [...origins]
          .filter(([key]) =>
            group.actorKeys.some((actor) => key.startsWith(`${actor}-`)),
          )
          .map(([, id]) => id);
        surround(ids, group.name, group.fill);
      }
    } else {
      for (const text of graph.text) skeleton(text);
      for (const namespace of Object.values(graph.namespaces)) {
        const ids = Object.keys(namespace.classes)
          .map((key) => origins.get(key))
          .filter((id): id is string => !!id);
        surround(ids, namespace.id);
      }
    }
  }
  // Frame groups have one owner and a contiguous drawing range. Nested Mermaid
  // subgraphs share the outer group while their visual containers remain intact.
  const used = new Set<string>();
  for (const [key, members] of groups) {
    const ids = frame.children.filter(
      (id) => members.includes(id) && !used.has(id),
    );
    if (ids.length < 2) continue;
    const at = Math.min(...ids.map((id) => frame.children.indexOf(id)));
    frame.children = frame.children.filter((id) => !ids.includes(id));
    frame.children.splice(at, 0, ...ids);
    ids.forEach((id) => used.add(id));
    const id = unique('group', key);
    cells[id] = { id, kind: CellKind.group, cellType: 'group', members: ids };
    frame.groups.push(id);
  }
  const snapshot = { store: { rootId: frame.id, cells } };
  const errors = validateCellStore(snapshot.store);
  if (errors.length)
    throw new Error(
      errors.map((error) => `${error.cellId}: ${error.message}`).join('; '),
    );
  return snapshot;
};
