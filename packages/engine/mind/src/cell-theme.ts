import {
  boardTextColor,
  isBoardTextDocument,
  type BoardTextNode,
} from '@sue/board-common';
import {
  resolveBoardTheme,
  resolveThemeColor,
  readableThemeText,
  colorContrast,
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

const palettes: Record<string, MindPalette> = {
  [ThemeColorMode.default]: {
    branches: [
      '#A287E0',
      '#6E80DB',
      '#6DC4C4',
      '#E0B75E',
      '#B1C675',
      '#77C386',
      '#C18976',
      '#E48484',
      '#E582D4',
      '#6AB1E4',
    ],
    rootFill: '#f5f5f5',
    rootStroke: '#64748b',
    rootText: '#333333',
    text: '#333333',
    note: '#475569',
  },
  [ThemeColorMode.colorful]: {
    branches: [
      '#F94239',
      '#FF8612',
      '#F3D222',
      '#B3D431',
      '#00BC7B',
      '#06ADBF',
      '#476BFF',
      '#4E49BE',
      '#8957E5',
      '#FE5DA1',
    ],
    rootFill: '#333333',
    rootStroke: '#333333',
    rootText: '#FFFFFF',
    text: '#333333',
    note: '#475569',
  },
  [ThemeColorMode.soft]: {
    branches: [
      '#6D89C1',
      '#F2BDC7',
      '#B796D9',
      '#5BA683',
      '#B3D431',
      '#F2DC6C',
      '#F7C98D',
      '#60B4D1',
      '#838F9E',
      '#C1A381',
    ],
    rootFill: '#FFFFFF',
    rootStroke: '#94a3b8',
    rootText: '#333333',
    text: '#333333',
    note: '#64748b',
  },
  [ThemeColorMode.retro]: {
    branches: [
      '#459476',
      '#9A894F',
      '#D48444',
      '#E9C358',
      '#4B9D9D',
      '#C14C41',
      '#827086',
      '#60718D',
      '#D38183',
      '#9DC19D',
    ],
    rootFill: '#153D5D',
    rootStroke: '#153D5D',
    rootText: '#FFFFFF',
    text: '#333333',
    note: '#6b6353',
  },
  [ThemeColorMode.dark]: {
    branches: [
      '#3DD1AE',
      '#F6C659',
      '#A9E072',
      '#FF877B',
      '#F693E7',
      '#5DCFFF',
      '#868AF6',
      '#4C6DC7',
      '#D97C26',
      '#268FAC',
    ],
    rootFill: '#FFFFFF',
    rootStroke: '#475569',
    rootText: '#333333',
    text: '#333333',
    note: '#cbd5e1',
  },
  [ThemeColorMode.starry]: {
    branches: [
      '#E46C57',
      '#579360',
      '#B98339',
      '#3A62D1',
      '#B883B7',
      '#42ABE5',
      '#2B9D8F',
      '#A4705E',
      '#265833',
      '#787865',
    ],
    rootFill: '#FFFFFF',
    rootStroke: '#5b7f9d',
    rootText: '#333333',
    text: '#333333',
    note: '#b8ccdc',
  },
};

const schemeNames = new Set<string>(Object.keys(palettes));

/**
 * Reads the frame's Mind color scheme. An explicit `view.mind.colorScheme`
 * wins; unknown values and absence fall back to the canvas theme, then the
 * default palette. Reading never rewrites the stored value.
 */
export const mindFrameColorScheme = (
  frame?: Pick<FrameCell, 'view'>,
): MindColorScheme => {
  const explicit = frame?.view?.mind?.colorScheme;
  if (explicit && schemeNames.has(explicit)) return explicit;
  const inherited = frame?.view?.theme?.themeColorMode;
  return inherited && schemeNames.has(inherited)
    ? (inherited as MindColorScheme)
    : ThemeColorMode.default;
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

const adaptivePalettes = new Map<string, MindPalette>();

export const mindTheme = (
  mode?: string,
  appearance?: BoardAppearance,
): MindPalette => {
  const id =
    mode && Object.hasOwn(palettes, mode) ? mode : ThemeColorMode.default;
  const original = palettes[id];
  if (!appearance) return original;
  const key = `${id}:${appearance}`;
  const cached = adaptivePalettes.get(key);
  if (cached) return cached;
  const theme = resolveBoardTheme(
    { themeColorMode: id as ThemeColorMode },
    appearance,
  );
  const branchColor = (color: string) => {
    if (colorContrast(color, theme.background) >= 3) return color;
    const target = appearance === 'dark' ? 255 : 0;
    const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    for (let amount = 0.1; amount <= 1; amount += 0.1) {
      const next =
        '#' +
        rgb
          .map((v) =>
            Math.round(v + (target - v) * amount)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('');
      if (colorContrast(next, theme.background) >= 3) return next;
    }
    return theme.text;
  };
  const result = {
    ...original,
    branches: original.branches.map(branchColor),
    rootFill: theme.surface,
    rootStroke: theme.stroke,
    rootText: theme.text,
    text: theme.text,
    note: theme.secondaryText,
  };
  adaptivePalettes.set(key, result);
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

/** Explicit fill and text color win. Missing values use the active mind scheme. */
export const mindPresentation = (
  store: CellStore,
  cell: NodeCell,
  frameId?: string,
  appearance?: BoardAppearance,
): { fill?: string; stroke?: string; color: string } => {
  const frame = frameOf(store, frameId ?? cell.id);
  const theme = mindTheme(mindFrameColorScheme(frame), appearance);
  const data = cell.data as { color?: string } | undefined;
  const text = cell.content?.text;
  const board = resolveBoardTheme(frame?.view?.theme, appearance);
  const fill = resolveThemeColor(
    cell.appearance?.fill,
    cell.appearance?.colorSources?.fill,
    cell.kind === 'mind-root' ? theme.rootFill : 'none',
    board,
  );
  const color =
    (appearance ? undefined : data?.color) ??
    (isBoardTextDocument(text)
      ? uniformExplicitColor(text.content, !!appearance)
      : undefined) ??
    (appearance
      ? readableThemeText(
          fill === 'none' || fill === 'transparent' ? board.background : fill,
          cell.kind === 'mind-root' ? theme.rootText : theme.text,
        )
      : cell.kind === 'mind-root'
        ? theme.rootText
        : theme.text);
  const strokeBackground =
    fill === 'none' || fill === 'transparent' ? board.background : fill;
  const rootStroke =
    appearance && colorContrast(theme.rootStroke, strokeBackground) < 3
      ? readableThemeText(strokeBackground, theme.rootStroke)
      : theme.rootStroke;
  return {
    fill: appearance
      ? fill
      : (cell.appearance?.fill ??
        (cell.kind === 'mind-root' ? theme.rootFill : undefined)),
    stroke: resolveThemeColor(
      cell.appearance?.strokeColor,
      cell.appearance?.colorSources?.strokeColor,
      cell.kind === 'mind-root'
        ? rootStroke
        : (mindBranchColor(store, cell.id, frameId, appearance) ??
            theme.rootStroke),
      board,
    ),
    color,
  };
};

/** Default note text color follows the same scheme resolution as titles. */
export const mindNoteColor = (
  store: CellStore,
  nodeId: string,
  frameId?: string,
  appearance?: BoardAppearance,
): string => {
  const node = store.cells[nodeId];
  const frame = frameOf(store, frameId ?? (isNodeCell(node) ? node.id : ''));
  const color = mindTheme(mindFrameColorScheme(frame), appearance).note;
  if (!appearance || !isNodeCell(node)) return color;
  const theme = resolveBoardTheme(frame?.view?.theme, appearance);
  const fill = resolveThemeColor(
    node.appearance?.fill,
    node.appearance?.colorSources?.fill,
    'none',
    theme,
  );
  return readableThemeText(
    fill === 'none' || fill === 'transparent' ? theme.background : fill,
    color,
  );
};

export const mindBranchColor = (
  store: CellStore,
  nodeId: string,
  frameId?: string,
  appearance?: BoardAppearance,
): string | undefined => {
  const node = store.cells[nodeId];
  if (!isNodeCell(node)) return undefined;
  const data = node.data as MindNodeData | undefined;
  if (
    data?.branchAppearance?.strokeColor &&
    (!appearance ||
      data.branchAppearance.colorSources?.strokeColor === 'custom')
  )
    return data.branchAppearance.strokeColor;
  if (
    node.appearance?.strokeColor &&
    data?.branchAppearance?.colorSources?.strokeColor !== 'theme' &&
    (!appearance || node.appearance.colorSources?.strokeColor === 'custom') &&
    node.kind !== 'mind-root'
  )
    return node.appearance.strokeColor;
  let current = nodeId;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const edge = Object.values(store.cells).find(
      (cell) =>
        cell.cellType === 'edge' &&
        cell.kind === 'mind-branch' &&
        'cellId' in cell.target &&
        cell.target.cellId === current,
    );
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
      const index = siblings.findIndex(
        (cell) =>
          cell.cellType === 'edge' &&
          'cellId' in cell.target &&
          cell.target.cellId === current,
      );
      const frame = frameOf(store, frameId ?? parent.id);
      const theme = mindTheme(mindFrameColorScheme(frame), appearance);
      const color =
        theme.branches[(index < 0 ? 0 : index) % theme.branches.length];
      const background = resolveBoardTheme(
        frame?.view?.theme,
        appearance,
      ).background;
      return appearance && colorContrast(color, background) < 3
        ? readableThemeText(background, color)
        : color;
    }
    const parentData = parent.data as MindNodeData | undefined;
    if (
      parentData?.branchAppearance?.strokeColor &&
      (!appearance ||
        parentData.branchAppearance.colorSources?.strokeColor === 'custom')
    )
      return parentData.branchAppearance.strokeColor;
    current = parent.id;
  }
  return undefined;
};
