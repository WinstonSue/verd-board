import {
  isEdgeCell,
  isNodeCell,
  resolveBoardTheme,
  resolveThemeRole,
  resolveThemeSeries,
  type Cell,
  type NodeCell,
} from '@sue/board-core';
import type { TableCellData, TableEntry } from '@sue/board-draw';
import {
  resolveFrameAppearance,
  type FrameRenderContext,
  type FrameThemeAppearance,
  type FrameThemeAppearanceContext,
  type ResolvedFrameCellAppearance,
} from '@sue/board-react';

const shapeKind = (cell: NodeCell) =>
  typeof cell.geometry.outline === 'object'
    ? cell.geometry.outline.kind
    : (cell.geometry.outline ?? 'rectangle');

const tableStructures = new WeakMap<
  TableCellData,
  {
    rows: ReadonlyMap<string, number>;
    columns: ReadonlyMap<string, number>;
    hasHeader: boolean;
  }
>();
const tableStructure = (data: TableCellData) => {
  let structure = tableStructures.get(data);
  if (!structure) {
    structure = {
      rows: new Map(data.rows.map((track, index) => [track.id, index])),
      columns: new Map(data.columns.map((track, index) => [track.id, index])),
      hasHeader:
        !!data.header ||
        data.cells.some(
          (entry) => entry.role === 'title' || entry.role === 'lane',
        ),
    };
    tableStructures.set(data, structure);
  }
  return structure;
};

/** Shape families are structural; names, contents and positions never choose a color. */
export function drawThemeSeriesIndex(
  cell: Cell | undefined,
): number | undefined {
  if (!isNodeCell(cell)) return undefined;
  if (
    cell.kind === 'swimlane' ||
    cell.kind === 'freehand' ||
    cell.kind === 'vector-line'
  )
    return 0;
  if (cell.kind === 'table') {
    const data = cell.data as TableCellData | undefined;
    return data && tableStructure(data).hasHeader ? 0 : undefined;
  }
  if (cell.kind !== 'geometry') return undefined;
  const shape = shapeKind(cell);
  if (shape === 'text') return undefined;
  if (['ellipse', 'circle', 'connector', 'useCase'].includes(shape)) return 1;
  if (['diamond', 'decision', 'branchMerge'].includes(shape)) return 2;
  if (
    ['store', 'storedData', 'database', 'hardDisk', 'internalStorage'].includes(
      shape,
    )
  )
    return 3;
  return 0;
}

export function drawThemeAppearance(
  context: FrameThemeAppearanceContext,
): FrameThemeAppearance | undefined {
  const { cell, store, theme } = context;
  if (!theme.adaptive || cell.kind === 'image') return undefined;
  if (isEdgeCell(cell)) {
    const index =
      'cellId' in cell.source
        ? drawThemeSeriesIndex(store.cells[cell.source.cellId])
        : undefined;
    const tone =
      index === undefined
        ? resolveThemeRole(theme, 'neutral')
        : resolveThemeSeries(theme, index);
    return { strokeColor: tone.strokeColor };
  }
  if (!isNodeCell(cell)) return undefined;
  if (cell.kind === 'freehand' || cell.kind === 'vector-line')
    return {
      fill: 'none',
      strokeColor: resolveThemeRole(theme, 'primary').strokeColor,
    };
  if (cell.kind === 'table') {
    const data = cell.data as TableCellData | undefined;
    return resolveThemeRole(
      theme,
      data && tableStructure(data).hasHeader ? 'primary' : 'neutral',
      'subtle',
    );
  }
  if (cell.kind === 'swimlane') return resolveThemeSeries(theme, 0, 'subtle');
  if (cell.kind !== 'geometry') return undefined;
  if (shapeKind(cell) === 'text')
    return {
      fill: 'none',
      strokeColor: 'none',
      textColor: resolveThemeRole(theme, 'neutral').textColor,
    };
  return resolveThemeSeries(theme, drawThemeSeriesIndex(cell) ?? 0);
}

/** Standalone leaves use the same pure resolver as the surrounding Frame scene. */
export function resolveDrawAppearance(
  context: FrameRenderContext,
): ResolvedFrameCellAppearance {
  if (context.resolvedAppearance) return context.resolvedAppearance;
  const themeContext = {
    cell: context.cell,
    store: context.store,
    frameId: context.frameId,
    theme: context.theme ?? resolveBoardTheme(),
  };
  return resolveFrameAppearance(
    themeContext,
    drawThemeAppearance(themeContext),
  );
}

export function tableEntryThemeAppearance(
  context: FrameThemeAppearanceContext,
  entry: TableEntry,
): FrameThemeAppearance | undefined {
  const { cell, theme } = context;
  if (!theme.adaptive || !isNodeCell(cell)) return undefined;
  const data = cell.data as TableCellData;
  const structure = tableStructure(data);
  if (cell.kind === 'swimlane') {
    if (entry.role === 'title')
      return resolveThemeRole(theme, 'primary', 'strong');
    const tracks =
      data.direction === 'vertical' ? structure.columns : structure.rows;
    const trackId =
      data.direction === 'vertical' ? entry.columnId : entry.rowId;
    const ordinal = tracks.get(trackId) ?? 0;
    return resolveThemeSeries(
      theme,
      ordinal,
      entry.role === 'body' ? 'subtle' : 'normal',
    );
  }
  const row = structure.rows.get(entry.rowId) ?? 0;
  if (structure.hasHeader) {
    const header =
      entry.role === 'title' ||
      entry.role === 'lane' ||
      (!!data.header && row === 0 && entry.role !== 'body');
    return resolveThemeRole(theme, 'primary', header ? 'normal' : 'subtle');
  }
  return resolveThemeRole(theme, 'neutral', row % 2 ? 'normal' : 'subtle');
}

/** An entry override wins over the table field, without persisting derived tones. */
export function resolveTableEntryAppearance(
  context: FrameThemeAppearanceContext,
  entry: TableEntry,
): ResolvedFrameCellAppearance {
  const cell = context.cell as NodeCell<TableCellData>;
  const entryFill =
    (!context.theme.adaptive && typeof entry.fill === 'string') ||
    (entry.fillSource === 'custom' && typeof entry.fill === 'string') ||
    entry.fill === 'none' ||
    entry.fill === 'transparent';
  const appearance = entryFill
    ? {
        ...cell.appearance,
        fill: entry.fill,
        colorSources: {
          ...cell.appearance?.colorSources,
          fill: entry.fillSource ?? 'theme',
        },
      }
    : cell.appearance;
  return resolveFrameAppearance(
    { ...context, cell: { ...cell, appearance } },
    tableEntryThemeAppearance(context, entry),
  );
}
