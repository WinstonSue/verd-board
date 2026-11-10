import type { Anchor } from '../anchor';
import type { CellId } from '../cell/types';
import type { Point } from '../interfaces/point';

export type TerminalEnd = 'source' | 'target';

/** A logical connection; route control points are stored separately. */
export type Terminal =
  { cellId: CellId; portId?: string; anchor?: Anchor } | { point: Point };

export interface TerminalRef {
  kind: 'edge';
  edgeId: CellId;
  end: TerminalEnd;
}

export const terminalKey = (edgeId: CellId, end: TerminalEnd) =>
  JSON.stringify(['edge', edgeId, end]);
