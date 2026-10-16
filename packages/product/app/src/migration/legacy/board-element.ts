import type { Point, BoardTheme, Viewport } from '@sue/board-core';

/** Historical, heterogeneous JSON records. Used only while decoding old storage. */
export interface LegacyBoardElement {
  [key: string]: any;
  id: string;
  type?: string;
  children?: LegacyBoardElement[];
  points?: Point[];
  groupId?: string;
  angle?: number;
}
export interface LegacyBoardSnapshot {
  children: LegacyBoardElement[];
  viewport?: Viewport;
  theme?: BoardTheme;
}
