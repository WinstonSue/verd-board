import type { CellId } from '@sue/board-core';
export interface ArchitectureLayerData {
  order: string;
  memberIds: CellId[];
}

export interface ArchitectureModuleData {
  shape: 'box' | 'decision' | 'store';
  /** 拖动过后记住的坐标。没有它时仍按层排成一行。 */
  placed?: boolean;
}
