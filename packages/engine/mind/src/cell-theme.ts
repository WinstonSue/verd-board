import {
  ThemeColorMode,
  type CellStore,
  type FrameCell,
  type MindColorScheme,
  type NodeCell,
  isFrameCell,
  isNodeCell,
} from '@sue/board-core';
import { isBoardTextDocument, type BoardTextNode } from '@sue/board-common';
import type { MindNodeData } from '@sue/board-core';

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

const explicitColor = (node: BoardTextNode): string | undefined => {
  if (node.type === 'text') {
    const color = node.marks?.find((mark) => mark.type === 'textStyle')
      ?.attrs?.['color'];
    return typeof color === 'string' ? color : undefined;
  }
  return node.content?.map(explicitColor).find(Boolean);
};

/**
 * A color applies as the node default only when every text leaf carries the
 * same explicit color; partially colored fragments must not promote one
 * fragment's color over the rest of the title.
 */
const uniformExplicitColor = (node: BoardTextNode): string | undefined => {
  const colors = (current: BoardTextNode): (string | undefined)[] =>
    current.type === 'text'
      ? [
          current.marks?.find((mark) => mark.type === 'textStyle')?.attrs?.[
            'color'
          ] as string | undefined,
        ]
      : (current.content ?? []).flatMap(colors);
  const leaves = colors(node);
  if (!leaves.length) return undefined;
  const first = leaves[0];
  return first !== undefined && leaves.every((color) => color === first)
    ? first
    : undefined;
};

export const mindTheme = (mode?: string) =>
  palettes[mode ?? ThemeColorMode.default] ?? palettes[ThemeColorMode.default];

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
): { fill?: string; stroke?: string; color: string } => {
  const frame = frameOf(store, frameId ?? cell.id);
  const theme = mindTheme(mindFrameColorScheme(frame));
  const data = cell.data as { color?: string } | undefined;
  const text = cell.content?.text;
  const color =
    data?.color ??
    (isBoardTextDocument(text)
      ? uniformExplicitColor(text.content)
      : undefined) ??
    (cell.kind === 'mind-root' ? theme.rootText : theme.text);
  return {
    fill:
      cell.appearance?.fill ??
      (cell.kind === 'mind-root' ? theme.rootFill : undefined),
    stroke:
      cell.appearance?.strokeColor ??
      (cell.kind === 'mind-root'
        ? theme.rootStroke
        : mindBranchColor(store, cell.id, frameId)),
    color,
  };
};

/** Default note text color follows the same scheme resolution as titles. */
export const mindNoteColor = (
  store: CellStore,
  nodeId: string,
  frameId?: string,
): string => {
  const node = store.cells[nodeId];
  const frame = frameOf(store, frameId ?? (isNodeCell(node) ? node.id : ''));
  return mindTheme(mindFrameColorScheme(frame)).note;
};

export const mindBranchColor = (
  store: CellStore,
  nodeId: string,
  frameId?: string,
): string | undefined => {
  const node = store.cells[nodeId];
  if (!isNodeCell(node)) return undefined;
  const data = node.data as MindNodeData | undefined;
  if (data?.branchAppearance?.strokeColor)
    return data.branchAppearance.strokeColor;
  if (node.appearance?.strokeColor && node.kind !== 'mind-root')
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
      const theme = mindTheme(
        mindFrameColorScheme(frameOf(store, frameId ?? parent.id)),
      );
      return theme.branches[(index < 0 ? 0 : index) % theme.branches.length];
    }
    const parentData = parent.data as MindNodeData | undefined;
    if (parentData?.branchAppearance?.strokeColor)
      return parentData.branchAppearance.strokeColor;
    current = parent.id;
  }
  return undefined;
};
