import { isNodeCell, type CellStore } from '@sue/board-core';
import {
  resolveFrameAppearance,
  frameThemeAppearance,
  type FrameThemeAppearanceContext,
} from '@sue/board-react';
import {
  umlRoot,
  type UmlClassData,
  type UmlFragmentData,
  type UmlParticipantData,
  type UmlSequenceData,
} from '@sue/board-uml';

const classifiers = ['class', 'interface', 'abstract', 'enum'] as const;
const seriesCache = new WeakMap<CellStore, Map<string, Map<string, number>>>();

const umlSeries = (store: CellStore, frameId: string) => {
  let frames = seriesCache.get(store);
  if (!frames) seriesCache.set(store, (frames = new Map()));
  let indices = frames.get(frameId);
  if (!indices) {
    indices = new Map();
    const root = umlRoot(store, frameId);
    if (root?.kind === 'uml-sequence-root') {
      const participants = (root.data as UmlSequenceData).participantIds;
      participants.forEach((id, ordinal) => indices!.set(id, ordinal));
    }
    frames.set(frameId, indices);
  }
  return indices;
};

const seriesFor = (
  context: FrameThemeAppearanceContext,
  id = context.cell.id,
) => {
  const cell = context.store.cells[id];
  if (isNodeCell(cell) && cell.kind === 'uml-class')
    return Math.max(
      0,
      classifiers.indexOf((cell.data as UmlClassData).classifier),
    );
  return umlSeries(context.store, context.frameId).get(id) ?? 0;
};

const seriesTone = (
  context: FrameThemeAppearanceContext,
  level: 'node' | 'emphasis' = 'node',
  id = context.cell.id,
) =>
  frameThemeAppearance(
    { ...context, cell: context.store.cells[id] ?? context.cell },
    `series-${(seriesFor(context, id) % 6) + 1}` as import('@sue/board-core').BoardStyleColor,
    level,
  );

const fragmentRole = (context: FrameThemeAppearanceContext) => {
  const operator = (
    context.cell as import('@sue/board-core').NodeCell<UmlFragmentData>
  ).data?.operator;
  return operator === 'alt'
    ? 'tertiary'
    : operator === 'opt'
      ? 'secondary'
      : 'primary';
};

export const umlThemeAppearance = (context: FrameThemeAppearanceContext) => {
  const { cell } = context;
  if (cell.kind === 'uml-note')
    return frameThemeAppearance(context, 'annotation');
  if (cell.kind === 'uml-fragment')
    return {
      ...frameThemeAppearance(
        context,
        fragmentRole(context),
        'container',
        'opaque',
      ),
      fill: 'none',
    };
  if (cell.cellType === 'edge') {
    const id = 'cellId' in cell.source ? cell.source.cellId : undefined;
    return {
      ...(id === undefined
        ? frameThemeAppearance(context, 'neutral')
        : seriesTone(context, 'node', id)),
      fill: 'none',
    };
  }
  const tone = seriesTone(context);
  return cell.kind === 'uml-participant' &&
    isNodeCell(cell) &&
    (cell.data as UmlParticipantData).actorType === 'actor'
    ? { ...tone, fill: 'none' }
    : tone;
};

/** Every painted part applies the same Cell field sources to its own defaults. */
export function resolveUmlPartAppearance(
  context: FrameThemeAppearanceContext,
  part: 'title' | 'activation' | 'lifeline' | 'fragment-label',
) {
  if (part === 'fragment-label')
    return resolveFrameAppearance(
      context,
      frameThemeAppearance(
        context,
        fragmentRole(context),
        'emphasis',
        'opaque',
      ),
    );
  const tone = seriesTone(
    context,
    part === 'activation' || part === 'title' ? 'emphasis' : 'node',
  );
  if (part !== 'lifeline') return resolveFrameAppearance(context, tone);
  // A lifeline has no painted fill, even when its participant has a custom fill.
  // Resolve its automatic contrast against the actual canvas behind the line.
  const cell = context.cell;
  return resolveFrameAppearance(
    {
      ...context,
      cell: isNodeCell(cell)
        ? { ...cell, appearance: { ...cell.appearance, fill: 'none' } }
        : cell,
    },
    { ...tone, fill: 'none' },
  );
}
