import {
  BaseCellUtil,
  groupLeafMembers,
  indexCells,
  isGroupCell,
  isNodeCell,
  nodeShapeGeometry,
  selectionAllows,
  type CellStore,
  type CellRegistry,
  type NodeCell,
  type NodeGeometry,
  type CellOperation,
} from '@sue/board-core';
import {
  createInlineText,
  isBoardTextDocument,
  type BoardTextDocument,
} from '@sue/board-common';
import { measureBoardText } from '@sue/board-react-text';

const supported = new Set([
  'geometry',
  'workflow-start',
  'workflow-task',
  'workflow-decision',
  'architecture-module',
]);
export function fitContentCandidates(
  store: CellStore,
  frameId: string,
  ids: readonly string[],
  registry: CellRegistry,
): NodeCell[] {
  const parents = indexCells(store).parentOf;
  const candidates = new Set(
    ids.flatMap((id) =>
      isGroupCell(store.cells[id]) ? groupLeafMembers(store, id) : [id],
    ),
  );
  return [...candidates].flatMap((id) => {
    const cell = store.cells[id];
    if (
      !isNodeCell(cell) ||
      !supported.has(cell.kind) ||
      cell.hidden ||
      parents.get(id) !== frameId ||
      !selectionAllows(store, [id], registry, 'resize', frameId)
    )
      return [];
    const plain = isBoardTextDocument(cell.content?.text)
      ? cell.content.text.plainText
      : cell.content?.label;
    return plain?.trim() ? [cell] : [];
  });
}

type Measure = (
  text: BoardTextDocument,
  width: number,
  fontSize: number,
) => { width: number; height: number } | undefined;
/** Shape text regions and the native renderer's 8px/4px padding determine the fit. */
export function fitNodeContent(
  cell: NodeCell,
  measure: Measure = measureBoardText,
): NodeGeometry {
  const text = isBoardTextDocument(cell.content?.text)
    ? cell.content.text
    : createInlineText(cell.content?.label ?? '');
  const fontSize = (cell.data as { fontSize?: number })?.fontSize ?? 16;
  const fallback = (width: number) => {
    const lines = text.plainText.split('\n');
    const lengths = lines.map((line) =>
      [...line].reduce(
        (sum, char) => sum + (char.codePointAt(0)! > 255 ? 1 : 0.6) * fontSize,
        0,
      ),
    );
    return {
      width: Math.max(1, ...lengths),
      height: Math.ceil(
        lengths.reduce(
          (sum, length) => sum + Math.max(1, Math.ceil(length / width)),
          0,
        ) *
          fontSize *
          1.3,
      ),
    };
  };
  const natural = measure(text, Infinity, fontSize) ?? fallback(Infinity);
  const shape = nodeShapeGeometry(cell.geometry.outline);
  const cap = Math.max(1, cell.geometry.width);
  let geometry = {
    ...cell.geometry,
    width: cap,
    height: Math.max(24, cell.geometry.height),
  };
  // Text bounds may depend on both axes (for example diamonds and ellipses).
  // Resolve their inset ratios together, rounding outwards to avoid clipping.
  for (let attempt = 0; attempt < 16; attempt++) {
    const bounds = shape?.textBounds?.(geometry) ?? geometry;
    const widthRatio = bounds.width / geometry.width || 1;
    const heightRatio = bounds.height / geometry.height || 1;
    const width = Math.min(
      cap,
      Math.max(Math.min(24, cap), Math.ceil((natural.width + 16) / widthRatio)),
    );
    const nextBounds = shape?.textBounds?.({ ...geometry, width }) ?? {
      ...geometry,
      width,
    };
    const available = Math.max(1, nextBounds.width - 16);
    const content = measure(text, available, fontSize) ?? fallback(available);
    const height = Math.max(24, Math.ceil((content.height + 8) / heightRatio));
    if (geometry.width === width && geometry.height === height) break;
    geometry = { ...geometry, width, height };
  }
  return geometry;
}
export function fitContentOperations(
  store: CellStore,
  frameId: string,
  ids: readonly string[],
  registry: CellRegistry,
  measure?: Measure,
): CellOperation[] {
  return fitContentCandidates(store, frameId, ids, registry).flatMap((cell) => {
    const geometry = fitNodeContent(cell, measure);
    if (
      geometry.width === cell.geometry.width &&
      geometry.height === cell.geometry.height
    )
      return [];
    const util = registry.get(cell.kind);
    return util instanceof BaseCellUtil
      ? util.resize(store, cell, geometry)
      : [{ type: 'replace_cell', cell: { ...cell, geometry } }];
  });
}
