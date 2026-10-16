import {
  isFrameCell,
  isNodeCell,
  type BoardTheme,
  type CellStore,
  type Viewport,
} from '@sue/board-core';
import type {
  LegacyBoardElement as BoardElement,
  LegacyBoardSnapshot as BoardSnapshot,
} from './board-element';

export const CELL_FORMAT = 'verd-cells' as const;

export interface CellEnvelope {
  format: typeof CELL_FORMAT;
  version: 1;
  store: CellStore;
  viewport?: Viewport;
  theme?: BoardTheme;
}

export const isCellEnvelope = (value: unknown): value is CellEnvelope => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<CellEnvelope>;
  return (
    candidate.format === CELL_FORMAT &&
    candidate.version === 1 &&
    !!candidate.store &&
    typeof candidate.store === 'object' &&
    typeof candidate.store.rootId === 'string' &&
    !!candidate.store.cells
  );
};

export const envelopeToBoardSnapshot = (
  envelope: CellEnvelope,
): BoardSnapshot => {
  const frame = envelope.store.cells[envelope.store.rootId];
  const order = frame && isFrameCell(frame) ? frame.children : [];
  const children = order.flatMap((id) => {
    const cell = envelope.store.cells[id];
    if (!cell || cell.cellType === 'frame') {
      return [];
    }
    const payload = (cell as { data?: { boardElement?: BoardElement } }).data
      ?.boardElement;
    if (payload) {
      return [payload];
    }
    if (isNodeCell(cell)) {
      return [
        {
          id: cell.id,
          type: cell.kind,
          points: [[cell.geometry.x, cell.geometry.y]],
        } as BoardElement,
      ];
    }
    return [];
  });
  return {
    children,
    ...(envelope.viewport ? { viewport: envelope.viewport } : {}),
    ...(envelope.theme ? { theme: envelope.theme } : {}),
  };
};
