import type { CellId, Point } from '@sue/board-core';
export interface WorkflowStartData {
  graphMode: 'dag' | 'process';
  origin: Point;
  memberIds: CellId[];
}
