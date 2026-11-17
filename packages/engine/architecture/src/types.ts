import type { CellId } from '@sue/board-core';
export interface ArchitectureEdgeData {
  /** Missing in historical diagrams; never infer semantics from their line style. */
  relation?: 'dependency' | 'flow';
  sourceMarker?: string;
  targetMarker?: string;
}
export interface ArchitectureLayerData {
  order: string;
  memberIds: CellId[];
  /** Extra room reserved by explicit layout; omitted in legacy documents. */
  layoutPaddingTop?: number;
}

export interface ArchitectureModuleData {
  shape: 'box' | 'decision' | 'store';
  /** 拖动过后记住的坐标。没有它时仍按层排成一行。 */
  placed?: boolean;
}
