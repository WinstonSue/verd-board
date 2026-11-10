import type { EdgeLabelLayout, Point } from '@sue/board-core';
import {
  isEdgeCell,
  planDomainGraphLayout,
  resolveCellArrangementScope,
  type Cell,
  type CellPlugin,
  type EdgeCell,
} from '@sue/board-core';
import { layoutUmlCells, layoutUmlSequence } from './layout';
import { registerUmlCells } from './cell-utils';
import {
  normalizeUmlRelations,
  planUmlPaste,
  remapUmlCell,
  umlClipboardSequence,
  umlReferences,
  type UmlClipboardSequence,
} from './relations';
declare module '@sue/board-core' {
  interface CellFragment {
    umlSequence?: UmlClipboardSequence;
  }
}
function messageLabelLayout(
  edge: EdgeCell,
  index: number,
  points: readonly Point[],
): EdgeLabelLayout | undefined {
  const label = edge.labels?.[index];
  if (edge.kind === 'uml-message' && points.length >= 2) {
    const width = Math.max(
      140,
      Math.min(
        400,
        points[0][0] === points.at(-1)![0]
          ? 200
          : Math.abs(points.at(-1)![0] - points[0][0]) - 32,
      ),
    );
    const lines = (label?.text ?? '')
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
              ) / width,
            ),
          ),
        0,
      );
    const height = lines * 20 + 12;
    const point: Point = [(points[0][0] + points[1][0]) / 2, points[0][1]];
    return {
      point,
      bounds: {
        x: point[0] - width / 2,
        y: point[1] - height - 8,
        width,
        height,
      },
    };
  }
  return undefined;
}
export const createUmlPlugin = (): CellPlugin => ({
  id: 'uml',
  scenes: [
    {
      id: 'uml-class',
      geometry: {
        version: 1,
        nodeLayout: 'domain',
        edgeRouting: 'orthogonal',
        project: layoutUmlCells,
        planLayout(context) {
          const scope = resolveCellArrangementScope(
            context.store,
            context.selection,
          );
          return planDomainGraphLayout(context, {
            ids: scope.ids,
            links: Object.values(context.store.cells).flatMap((e) =>
              isEdgeCell(e) &&
              e.kind === 'uml-relation' &&
              ['generalization', 'realization'].includes(
                (e.data as { relation?: string })?.relation ?? '',
              ) &&
              'cellId' in e.source &&
              'cellId' in e.target
                ? [{ source: e.target.cellId, target: e.source.cellId }]
                : [],
            ),
          });
        },
      },
      sharedKinds: ['swimlane'],
      laneMemberKinds: ['uml-class'],
      anchorKinds: ['uml-class-root'],
      kinds: ['uml-class-root', 'uml-class', 'uml-relation'],
      allowGroups: true,
      consecutiveGroups: false,
      preserveAnchor: true,
    },
    {
      arrangeable: false,
      id: 'uml-sequence',
      geometry: {
        version: 1,
        nodeLayout: 'domain',
        edgeRouting: 'domain',
        defaultStyle: 'sequence',
        validate: (context) =>
          ['sequence', 'domain'].includes(context.style)
            ? []
            : [
                {
                  code: 'geometry.domain-managed',
                  message:
                    'Sequence geometry is derived from participant and event order.',
                  frameId: context.frameId,
                  sceneId: 'uml-sequence',
                  cellIds: context.selection.ids,
                },
              ],
        project: (store, frameId) => layoutUmlSequence(store, frameId).geometry,
        planLayout: () => [],
      },
      anchorKinds: ['uml-sequence-root'],
      kinds: [
        'uml-sequence-root',
        'uml-participant',
        'uml-message',
        'uml-note',
        'uml-fragment',
      ],
      allowGroups: false,
      preserveAnchor: true,
    },
  ],
  normalize: normalizeUmlRelations,
  remap: remapUmlCell,
  references: umlReferences,
  copyReferences(_store, cell) {
    return cell.kind.startsWith('uml-') && isEdgeCell(cell)
      ? [cell.source, cell.target].flatMap((terminal) =>
          'cellId' in terminal ? [terminal.cellId] : [],
        )
      : [];
  },
  clipboardMetadata: (store, frameId, included, selected) => ({
    umlSequence: umlClipboardSequence(store, frameId, included, selected),
  }),
  planPaste: planUmlPaste,
  install(registry) {
    registerUmlCells({
      ...registry,
      register(util) {
        Object.assign(util, {
          fitText: false,
          routable: util.kind !== 'uml-message',
          canConnect: (node: Cell) => node.kind === 'uml-class',
          labelLayout:
            util.kind === 'uml-message' ? messageLabelLayout : undefined,
          translateable:
            util.kind === 'uml-class' || util.kind === 'uml-relation',
          copyWithEndpoints: util.kind !== 'uml-message',
          groupable: util.kind === 'uml-class' || util.kind === 'uml-relation',
        });
        registry.register(util);
      },
    });
  },
});
