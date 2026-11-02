import {
  isNodeCell,
  resolveThemeRole,
  resolveThemeSeries,
  type CellStore,
} from '@sue/board-core';
import {
  resolveFrameAppearance,
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
  const { cell, theme } = context;
  if (cell.kind === 'uml-note') return resolveThemeRole(theme, 'annotation');
  if (cell.kind === 'uml-fragment')
    return { ...resolveThemeRole(theme, fragmentRole(context)), fill: 'none' };
  if (cell.cellType === 'edge') {
    const id = 'cellId' in cell.source ? cell.source.cellId : undefined;
    return {
      strokeColor:
        id === undefined
          ? resolveThemeRole(theme, 'neutral').strokeColor
          : resolveThemeSeries(theme, seriesFor(context, id)).strokeColor,
    };
  }
  const tone = resolveThemeSeries(
    theme,
    seriesFor(context),
    cell.kind === 'uml-class' ? 'subtle' : 'normal',
  );
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
      resolveThemeRole(context.theme, fragmentRole(context), 'subtle'),
    );
  const tone = resolveThemeSeries(
    context.theme,
    seriesFor(context),
    part === 'activation' ? 'strong' : 'normal',
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
