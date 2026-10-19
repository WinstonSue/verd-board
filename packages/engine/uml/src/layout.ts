import {
  edgeLabelLayout,
  isFrameCell,
  isNodeCell,
  umlRoot,
  type CellStore,
  type NodeCell,
  type EdgeCell,
  type NodeGeometry,
  type Point,
  type UmlClassData,
  type UmlSequenceData,
  type UmlFragmentData,
  type UmlNoteData,
  type UmlMessageData,
  type UmlRelationData,
  type UmlEvent,
} from '@sue/board-core';
import { umlRelationMarkers } from './model';
export interface UmlActivationBounds {
  participantId: string;
  startId: string;
  endId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface UmlSequenceLayout {
  geometry: Map<string, NodeGeometry>;
  edges: Map<string, EdgeCell>;
  rows: Map<string, number>;
  activations: UmlActivationBounds[];
  branches: Map<string, { y: number; height: number; guard: string }>;
}
const sequenceCache = new WeakMap<CellStore, Map<string, UmlSequenceLayout>>();
export function layoutUmlSequence(
  store: CellStore,
  frameId: string,
): UmlSequenceLayout {
  let frames = sequenceCache.get(store);
  if (!frames) {
    frames = new Map();
    sequenceCache.set(store, frames);
  }
  let layout = frames.get(frameId);
  if (!layout) {
    layout = computeUmlSequence(store, frameId);
    frames.set(frameId, layout);
  }
  return layout;
}
function computeUmlSequence(
  store: CellStore,
  frameId: string,
): UmlSequenceLayout {
  const geometry = new Map<string, NodeGeometry>(),
    edges = new Map<string, EdgeCell>(),
    rows = new Map<string, number>();
  const activations: UmlActivationBounds[] = [],
    branches = new Map<string, { y: number; height: number; guard: string }>();
  const root = umlRoot(store, frameId);
  if (root?.kind !== 'uml-sequence-root')
    return { geometry, edges, rows, activations, branches };
  const ids = (root.data as UmlSequenceData).participantIds;
  const centers = new Map(ids.map((id, i) => [id, 160 + i * 240]));
  const stacks = new Map<string, { id: string; y: number }[]>();
  let y = 150;
  let lastMessage:
    | { source: string; target: string; sourceY: number; targetY: number }
    | undefined;
  const walk = (events: UmlEvent[], depth = 0) => {
    for (const event of events) {
      if (event.type !== 'cell') {
        const attachedY =
          lastMessage &&
          (event.type === 'activate'
            ? lastMessage.target === event.participantId
            : lastMessage.source === event.participantId ||
              lastMessage.target === event.participantId)
            ? event.type === 'activate' ||
              lastMessage.source === lastMessage.target
              ? lastMessage.targetY
              : lastMessage.source === event.participantId
                ? lastMessage.sourceY
                : lastMessage.targetY
            : undefined;
        const eventY = attachedY ?? y;
        rows.set(event.id, eventY);
        const stack = stacks.get(event.participantId) ?? [];
        stacks.set(event.participantId, stack);
        if (event.type === 'activate') stack.push({ id: event.id, y: eventY });
        else {
          const start = stack.pop();
          if (start)
            activations.push({
              participantId: event.participantId,
              startId: start.id,
              endId: event.id,
              x: (centers.get(event.participantId) ?? 0) - 7 + stack.length * 7,
              y: start.y,
              width: 14,
              height: Math.max(24, eventY - start.y),
            });
        }
        if (attachedY === undefined) y += 22;
        continue;
      }
      const cell = store.cells[event.cellId];
      if (!cell) continue;
      rows.set(cell.id, y);
      if (cell.kind === 'uml-message') {
        const edge = cell as EdgeCell<UmlMessageData>;
        if (!('cellId' in edge.source) || !('cellId' in edge.target)) continue;
        const sx = centers.get(edge.source.cellId) ?? 0,
          tx = centers.get(edge.target.cellId) ?? 0;
        const self = sx === tx;
        const text = edge.labels?.[0]?.text ?? '';
        const labelWidth = Math.max(
          140,
          Math.min(400, self ? 200 : Math.abs(tx - sx) - 32),
        );
        const lines = text
          .split('\n')
          .reduce(
            (sum, line) =>
              sum +
              Math.max(
                1,
                Math.ceil(
                  [...line].reduce(
                    (n, c) => n + (c.charCodeAt(0) > 255 ? 16 : 8),
                    0,
                  ) / labelWidth,
                ),
              ),
            0,
          );
        const labelHeight = lines * 20 + 12;
        y += Math.max(0, labelHeight - 36);
        rows.set(cell.id, y);
        const rowHeight = 60;
        const points: Point[] = self
          ? [
              [sx, y],
              [sx + 60, y],
              [sx + 60, y + 28],
              [sx, y + 28],
            ]
          : [
              [sx, y],
              [tx, y],
            ];
        edges.set(cell.id, {
          ...edge,
          route: { mode: 'fixed', points },
          source: { cellId: edge.source.cellId, anchor: [0.5, 0] },
          target: { cellId: edge.target.cellId, anchor: [0.5, 0] },
          appearance: {
            ...edge.appearance,
            strokeStyle:
              edge.data?.messageKind === 'return' ? 'dashed' : 'solid',
          },
          data: {
            ...edge.data!,
            targetMarker:
              edge.data?.messageKind === 'sync' ? 'solid-triangle' : 'arrow',
            sourceMarker: 'none',
          },
        });
        lastMessage = {
          source: edge.source.cellId,
          target: edge.target.cellId,
          sourceY: points[0][1],
          targetY: points.at(-1)![1],
        };
        y += rowHeight + (self ? 28 : 0);
      } else if (cell.kind === 'uml-note') {
        lastMessage = undefined;
        const note = cell as NodeCell<UmlNoteData>;
        const xs = note.data!.participantIds.map((id) => centers.get(id) ?? 0);
        const min = Math.min(...xs),
          max = Math.max(...xs);
        const height = Math.max(
          52,
          Math.ceil((note.content?.label?.length ?? 0) / 24) * 22 + 20,
        );
        const width = Math.max(180, max - min + 120),
          x =
            note.data!.position === 'left'
              ? min - width - 24
              : note.data!.position === 'right'
                ? max + 24
                : (min + max - width) / 2;
        geometry.set(cell.id, {
          ...note.geometry,
          x,
          y,
          width,
          height,
          derived: true,
        });
        y += height + 60;
      } else if (cell.kind === 'uml-fragment') {
        lastMessage = undefined;
        const fragment = cell as NodeCell<UmlFragmentData>;
        const top = y;
        y += 40;
        for (const operand of fragment.data!.operands) {
          const start = y;
          y += 68;
          walk(operand.events, depth + 1);
          y += 18;
          branches.set(operand.id, {
            y: start,
            height: y - start,
            guard: operand.guard,
          });
        }
        let left = 40 + depth * 12;
        let right = left + Math.max(300, ids.length * 240 + 20 - depth * 24);
        for (const bounds of geometry.values())
          if (bounds.y >= top && bounds.y + bounds.height <= y) {
            left = Math.min(left, bounds.x - 16);
            right = Math.max(right, bounds.x + bounds.width + 16);
          }
        for (const edge of edges.values())
          if (
            'points' in edge.route &&
            edge.route.points?.length &&
            edge.route.points[0][1] >= top &&
            edge.route.points[0][1] <= y
          ) {
            const label = edgeLabelLayout(edge, 0, edge.route.points).bounds;
            left = Math.min(
              left,
              label.x - 16,
              ...edge.route.points.map((p) => p[0] - 16),
            );
            right = Math.max(
              right,
              label.x + label.width + 16,
              ...edge.route.points.map((p) => p[0] + 16),
            );
          }
        geometry.set(cell.id, {
          ...fragment.geometry,
          x: left,
          y: top,
          width: right - left,
          height: y - top,
          derived: true,
        });
        y += 60;
        lastMessage = undefined;
      }
    }
  };
  walk((root.data as UmlSequenceData).events);
  for (const id of ids) {
    const cell = store.cells[id];
    if (isNodeCell(cell))
      geometry.set(id, {
        ...cell.geometry,
        x: centers.get(id)! - 75,
        y: 40,
        width: 150,
        height: Math.max(180, y + 20 - 40),
        derived: true,
      });
  }
  // The same anchors are consumed by paint, hit testing, labels and export.
  for (const [id, edge] of edges) {
    const points = 'points' in edge.route ? edge.route.points! : [];
    if ('cellId' in edge.source && 'cellId' in edge.target) {
      const source = geometry.get(edge.source.cellId)!,
        target = geometry.get(edge.target.cellId)!;
      edges.set(id, {
        ...edge,
        source: {
          ...edge.source,
          anchor: [0.5, (points[0][1] - source.y) / source.height],
        },
        target: {
          ...edge.target,
          anchor: [0.5, (points.at(-1)![1] - target.y) / target.height],
        },
      });
    }
  }
  return { geometry, edges, rows, activations, branches };
}
export function layoutUmlCells(
  store: CellStore,
  frameId: string,
): Map<string, NodeGeometry> {
  const result = layoutUmlSequence(store, frameId).geometry;
  const frame = store.cells[frameId];
  if (isFrameCell(frame))
    for (const id of frame.children) {
      const cell = store.cells[id];
      if (isNodeCell(cell) && cell.kind === 'uml-class') {
        const data = cell.data as UmlClassData;
        result.set(id, {
          ...cell.geometry,
          height: umlClassMetrics(cell as NodeCell<UmlClassData>).height,
        });
      }
    }
  return result;
}
export function layoutUmlEdges(
  store: CellStore,
  frameId: string,
): Map<string, EdgeCell> {
  const result = layoutUmlSequence(store, frameId).edges;
  const frame = store.cells[frameId];
  if (isFrameCell(frame))
    for (const id of frame.children) {
      const cell = store.cells[id];
      if (cell?.kind === 'uml-relation') {
        const edge = cell as EdgeCell<UmlRelationData>;
        result.set(id, {
          ...edge,
          appearance: {
            ...edge.appearance,
            strokeStyle: ['dependency', 'realization'].includes(
              edge.data!.relation,
            )
              ? 'dashed'
              : 'solid',
          },
          data: {
            ...edge.data!,
            ...umlRelationMarkers(edge.data!.relation),
            ...(edge.data!.relation === 'association' && edge.data!.navigable
              ? { targetMarker: 'arrow' }
              : {}),
          },
          labels: [
            edge.labels?.[0] ?? { text: '' },
            ...(edge.data?.sourceMultiplicity
              ? [{ text: edge.data.sourceMultiplicity, position: 0.12 }]
              : []),
            ...(edge.data?.targetMultiplicity
              ? [{ text: edge.data.targetMultiplicity, position: 0.88 }]
              : []),
          ],
        });
      }
    }
  return result;
}

export function umlClassMetrics(cell: NodeCell<UmlClassData>) {
  let y = 54;
  const rows = (values: string[]) =>
    values.map((text) => {
      const width = Math.max(30, cell.geometry.width - 20);
      const height = Math.max(
        24,
        Math.ceil(
          [...text].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 14 : 8), 0) /
            width,
        ) * 24,
      );
      const row = { text, y, height };
      y += height;
      return row;
    });
  const attributes = rows(cell.data!.attributes);
  if (!attributes.length) y += 24;
  const divider = y;
  const methods = rows(cell.data!.methods);
  if (!methods.length) y += 24;
  return { attributes, methods, divider, height: y };
}
