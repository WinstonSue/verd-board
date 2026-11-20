import {
  isEdgeCell,
  isNodeCell,
  resolveBoardTheme,
  compositeThemeFill,
  type BoardStyleColor,
  type Cell,
  type NodeCell,
} from '@sue/board-core';
import {
  tableGrid,
  type TableCellData,
  type TableEntry,
} from '@sue/board-draw';
import {
  resolveFrameAppearance,
  frameThemeAppearance,
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
    cell.kind === 'card' ||
    cell.kind === 'table' ||
    cell.kind === 'swimlane' ||
    cell.kind === 'freehand' ||
    cell.kind === 'vector-line'
  )
    return 0;
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
  if (cell.kind === 'card')
    return frameThemeAppearance(context, 'series-1', 'container', 'opaque');
  if (!theme.adaptive || cell.kind === 'image') return undefined;
  if (isEdgeCell(cell)) {
    const source =
      'cellId' in cell.source ? store.cells[cell.source.cellId] : undefined;
    const index = drawThemeSeriesIndex(source);
    const tone = frameThemeAppearance(
      { ...context, cell: source ?? cell },
      `series-${((index ?? 0) % 6) + 1}` as BoardStyleColor,
    );
    return { ...tone, fill: 'none' };
  }
  if (!isNodeCell(cell)) return undefined;
  if (cell.kind === 'freehand' || cell.kind === 'vector-line')
    return {
      fill: 'none',
      strokeColor: frameThemeAppearance(context, 'primary').strokeColor,
    };
  if (cell.kind === 'table') {
    return frameThemeAppearance(context, 'series-1', 'container', 'opaque');
  }
  if (cell.kind === 'swimlane')
    return frameThemeAppearance(context, 'primary', 'container', 'opaque');
  if (cell.kind !== 'geometry') return undefined;
  if (shapeKind(cell) === 'text')
    return {
      fill: 'none',
      strokeColor: 'none',
      textColor: frameThemeAppearance(context, 'neutral').textColor,
    };
  return frameThemeAppearance(
    context,
    `series-${((drawThemeSeriesIndex(cell) ?? 0) % 6) + 1}` as BoardStyleColor,
  );
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
      return frameThemeAppearance(context, 'primary', 'emphasis', 'opaque');
    const tracks =
      data.direction === 'vertical' ? structure.columns : structure.rows;
    const trackId =
      data.direction === 'vertical' ? entry.columnId : entry.rowId;
    const ordinal = tracks.get(trackId) ?? 0;
    if (entry.role !== 'body')
      return frameThemeAppearance(context, 'primary', 'emphasis', 'opaque');
    const tone = frameThemeAppearance(
      context,
      `series-${(ordinal % 6) + 1}` as BoardStyleColor,
      'container',
      'opaque',
    );
    return ordinal % 2
      ? { ...tone, fill: compositeThemeFill(tone.fill! + 'bf', theme.canvas) }
      : tone;
  }
  const row = structure.rows.get(entry.rowId) ?? 0;
  if (structure.hasHeader) {
    const header =
      entry.role === 'title' ||
      entry.role === 'lane' ||
      (!!data.header && row === 0 && entry.role !== 'body');
    return frameThemeAppearance(
      context,
      'primary',
      header ? 'emphasis' : 'container',
      'opaque',
    );
  }
  return frameThemeAppearance(
    context,
    'series-1',
    row % 2 ? 'node' : 'container',
    'opaque',
  );
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

/** Semantic and legacy lanes both paint a real supporting surface. */
export function drawThemeBackground(
  context: FrameThemeAppearanceContext,
): string | undefined {
  if (!isNodeCell(context.cell) || context.cell.cellType === 'frame') return;
  const frame = context.store.cells[context.frameId];
  if (!frame || frame.cellType !== 'frame' || !('children' in frame)) return;
  const center = {
    x: context.cell.geometry.x + context.cell.geometry.width / 2,
    y: context.cell.geometry.y + context.cell.geometry.height / 2,
  };
  for (const id of [...frame.children].reverse()) {
    const lane = context.store.cells[id];
    if (
      !isNodeCell(lane) ||
      lane.kind !== 'swimlane' ||
      lane.id === context.cell.id
    )
      continue;
    const data = lane.data as TableCellData;
    const entries = tableGrid(lane as NodeCell<TableCellData>).entries;
    const trackId = Object.entries(data.laneMembers ?? {}).find(([, members]) =>
      members.includes(context.cell.id),
    )?.[0];
    const track = entries.find((entry) => entry.entry.id === trackId);
    const body = entries.find(
      (part) =>
        part.entry.role === 'body' &&
        (track
          ? data.direction === 'vertical'
            ? part.column === track.column
            : part.row === track.row
          : center.x >= part.x &&
            center.x <= part.x + part.width &&
            center.y >= part.y &&
            center.y <= part.y + part.height),
    );
    if (body) {
      const visual = resolveTableEntryAppearance(
        { ...context, cell: lane },
        body.entry,
      );
      return compositeThemeFill(
        visual.fill ?? context.theme.canvas,
        context.theme.canvas,
      );
    }
  }
  return undefined;
}
