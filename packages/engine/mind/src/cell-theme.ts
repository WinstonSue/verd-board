import {
  boardTextColor,
  isBoardTextDocument,
  type BoardTextNode,
} from '@sue/board-common';
import {
  resolveBoardTheme,
  resolveThemeFamily,
  compositeThemeFill,
  readableThemeStroke,
  BoardStyleColors,
  isBoardStyleColor,
  type BoardStyleColor,
  type BoardThemeStyleLevel,
  type ResolvedBoardTheme,
  resolveThemeColor,
  readableThemeText,
  type BoardAppearance,
  isFrameCell,
  isNodeCell,
  ThemeColorMode,
  type CellStore,
  type FrameCell,
  type NodeCell,
} from '@sue/board-core';
import { type MindNodeData } from '@sue/board-mind';
import { type MindColorScheme } from './public-api';

export interface MindPalette {
  branches: string[];
  rootFill: string;
  rootStroke: string;
  rootText: string;
  text: string;
  note: string;
}

const schemeNames = new Set<string>(Object.values(ThemeColorMode));

/** An explicit unknown scheme uses Classic; absence inherits the canvas. */
export const mindFrameColorScheme = (
  frame?: Pick<FrameCell, 'view'>,
): MindColorScheme => {
  const explicit = frame?.view?.mind?.colorScheme;
  if (explicit !== undefined)
    return schemeNames.has(explicit) ? explicit : ThemeColorMode.default;
  return resolveBoardTheme(frame?.view?.theme).id;
};

/**
 * A color applies as the node default only when every text leaf carries the
 * same explicit color; partially colored fragments must not promote one
 * fragment's color over the rest of the title.
 */
const uniformExplicitColor = (
  node: BoardTextNode,
  followTheme = false,
): string | undefined => {
  const colors = (current: BoardTextNode): (string | undefined)[] =>
    current.type === 'text'
      ? [
          boardTextColor(
            current.marks?.find((mark) => mark.type === 'textStyle')?.attrs,
            followTheme,
          ),
        ]
      : (current.content ?? []).flatMap(colors);
  const leaves = colors(node);
  if (!leaves.length) return undefined;
  const first = leaves[0];
  return first !== undefined && leaves.every((color) => color === first)
    ? first
    : undefined;
};

const mindPalettes = new Map<string, MindPalette>();

/** Mind uses the same six style families and emphasis ramp as every canvas. */
export const mindTheme = (
  mode?: string,
  appearance?: BoardAppearance,
): MindPalette => {
  const id =
    mode && schemeNames.has(mode)
      ? (mode as ThemeColorMode)
      : ThemeColorMode.default;
  const key = `${id}:${appearance ?? 'legacy'}`;
  const cached = mindPalettes.get(key);
  if (cached) return cached;
  const theme = resolveBoardTheme({ themeColorMode: id }, appearance);
  const root = resolveThemeFamily(theme, 'series-1', 'emphasis');
  const result: MindPalette = {
    branches: BoardStyleColors.map(
      (family) => resolveThemeFamily(theme, family, 'node').strokeColor,
    ),
    rootFill: root.fill,
    rootStroke: root.strokeColor,
    rootText: root.textColor,
    text: theme.text,
    note: theme.secondaryText,
  };
  mindPalettes.set(key, result);
  return result;
};

const frameOf = (store: CellStore, id: string): FrameCell | undefined => {
  const cell = store.cells[id];
  if (isFrameCell(cell)) return cell;
  const parent = Object.values(store.cells).find(
    (candidate): candidate is FrameCell =>
      isFrameCell(candidate) &&
      (candidate.children.includes(id) || candidate.groups.includes(id)),
  );
  return parent;
};

/** Palette identity may be overridden, while the real canvas remains the base. */
const mindBoardTheme = (
  frame: FrameCell | undefined,
  appearance?: BoardAppearance,
): ResolvedBoardTheme => {
  const canvas = resolveBoardTheme(frame?.view?.theme, appearance);
  if (mindFrameColorScheme(frame) === canvas.id) return canvas;
  return resolveBoardTheme(
    {
      themeColorMode: mindFrameColorScheme(frame) as ThemeColorMode,
      backgroundMode: 'custom',
      boardBackground: canvas.canvas,
    },
    appearance,
  );
};

const parentEdge = (store: CellStore, id: string) =>
  Object.values(store.cells).find(
    (cell) =>
      cell.cellType === 'edge' &&
      cell.kind === 'mind-branch' &&
      'cellId' in cell.target &&
      cell.target.cellId === id,
  );

/** A local family overrides inheritance; roots do not recolor every main branch. */
const mindStyleFamily = (store: CellStore, nodeId: string): BoardStyleColor => {
  let current = nodeId;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const node = store.cells[current];
    if (!isNodeCell(node)) break;
    if (isBoardStyleColor(node.appearance?.styleColor))
      return node.appearance.styleColor;
    const edge = parentEdge(store, current);
    if (!edge || edge.cellType !== 'edge' || !('cellId' in edge.source)) break;
    const parent = store.cells[edge.source.cellId];
    if (!isNodeCell(parent)) break;
    if (parent.kind === 'mind-root') {
      const siblings = Object.values(store.cells)
        .filter(
          (cell) =>
            cell.cellType === 'edge' &&
            cell.kind === 'mind-branch' &&
            'cellId' in cell.source &&
            cell.source.cellId === parent.id,
        )
        .sort((a, b) =>
          String(
            (a as { data?: { order?: string } }).data?.order ?? '',
          ).localeCompare(
            String((b as { data?: { order?: string } }).data?.order ?? ''),
          ),
        );
      const ordinal = siblings.findIndex((item) => item.id === edge.id);
      return BoardStyleColors[Math.max(ordinal, 0) % BoardStyleColors.length];
    }
    current = parent.id;
  }
  return 'series-1';
};

/** Preserve explicit branch paints and the existing per-field reset behavior. */
const customBranchColor = (
  store: CellStore,
  nodeId: string,
  appearance?: BoardAppearance,
): string | undefined => {
  let current = nodeId;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const node = store.cells[current];
    if (!isNodeCell(node)) break;
    const data = node.data as MindNodeData | undefined;
    if (
      data?.branchAppearance?.strokeColor &&
      (!appearance ||
        data.branchAppearance.colorSources?.strokeColor === 'custom')
    )
      return data.branchAppearance.strokeColor;
    if (
      current === nodeId &&
      node.appearance?.strokeColor &&
      data?.branchAppearance?.colorSources?.strokeColor !== 'theme' &&
      (!appearance || node.appearance.colorSources?.strokeColor === 'custom') &&
      node.kind !== 'mind-root'
    )
      return node.appearance.strokeColor;
    if (isBoardStyleColor(node.appearance?.styleColor)) break;
    const edge = parentEdge(store, current);
    if (!edge || edge.cellType !== 'edge' || !('cellId' in edge.source)) break;
    const parent = store.cells[edge.source.cellId];
    if (!isNodeCell(parent) || parent.kind === 'mind-root') break;
    current = parent.id;
  }
  return undefined;
};

/** Explicit field colors win over style families and automatic branch colors. */
export const mindPresentation = (
  store: CellStore,
  cell: NodeCell,
  frameId?: string,
  appearance?: BoardAppearance,
): {
  fill?: string;
  stroke?: string;
  color: string;
  styleFamily: BoardStyleColor;
  styleLevel: BoardThemeStyleLevel;
} => {
  const frame = frameOf(store, frameId ?? cell.id);
  const board = mindBoardTheme(frame, appearance);
  const styleFamily = mindStyleFamily(store, cell.id);
  const styleLevel = cell.kind === 'mind-root' ? 'emphasis' : 'node';
  const tone = resolveThemeFamily(
    board,
    styleFamily,
    styleLevel,
    appearance ? 'overlay' : 'opaque',
  );
  const fill = resolveThemeColor(
    cell.appearance?.fill,
    cell.appearance?.colorSources?.fill,
    cell.kind === 'mind-root' ? tone.fill : 'none',
    board,
  );
  const background = compositeThemeFill(fill, board.canvas);
  const data = cell.data as { color?: string } | undefined;
  const text = cell.content?.text;
  const color =
    (appearance ? undefined : data?.color) ??
    (isBoardTextDocument(text)
      ? uniformExplicitColor(text.content, !!appearance)
      : undefined) ??
    readableThemeText(
      background,
      cell.kind === 'mind-root' ? tone.textColor : board.text,
    );
  const customStroke = customBranchColor(store, cell.id, appearance);
  const preferredStroke = customStroke ?? tone.strokeColor;
  const automaticStroke =
    appearance && !customStroke
      ? readableThemeStroke(background, board.canvas, preferredStroke)
      : preferredStroke;
  return {
    fill: appearance
      ? fill
      : (cell.appearance?.fill ??
        (cell.kind === 'mind-root' ? tone.fill : undefined)),
    stroke: resolveThemeColor(
      cell.appearance?.strokeColor,
      cell.appearance?.colorSources?.strokeColor,
      automaticStroke,
      board,
    ),
    color,
    styleFamily,
    styleLevel,
  };
};

export const mindNoteColor = (
  store: CellStore,
  nodeId: string,
  frameId?: string,
  appearance?: BoardAppearance,
): string => {
  const node = store.cells[nodeId];
  const frame = frameOf(store, frameId ?? nodeId);
  const theme = mindBoardTheme(frame, appearance);
  if (!isNodeCell(node)) return theme.secondaryText;
  const fill =
    mindPresentation(store, node, frameId, appearance).fill ?? 'none';
  return readableThemeText(
    compositeThemeFill(fill, theme.canvas),
    theme.secondaryText,
  );
};

/** Edges follow their source, except root-to-main edges follow the main branch. */
export const mindBranchColor = (
  store: CellStore,
  nodeId: string,
  frameId?: string,
  appearance?: BoardAppearance,
): string | undefined => {
  const node = store.cells[nodeId];
  if (!isNodeCell(node)) return undefined;
  const custom = customBranchColor(store, nodeId, appearance);
  if (custom) return custom;
  const edge = parentEdge(store, nodeId);
  const parent =
    edge?.cellType === 'edge' && 'cellId' in edge.source
      ? store.cells[edge.source.cellId]
      : undefined;
  const source =
    isNodeCell(parent) && parent.kind !== 'mind-root' ? parent : node;
  const theme = mindBoardTheme(frameOf(store, frameId ?? nodeId), appearance);
  const family = mindStyleFamily(store, source.id);
  const tone = resolveThemeFamily(theme, family, 'node');
  return readableThemeStroke(theme.canvas, theme.canvas, tone.strokeColor);
};
